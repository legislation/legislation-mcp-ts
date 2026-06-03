#!/usr/bin/env node

/**
 * Ingest the powers-and-duties dataset into Aurora Serverless v2 Postgres
 * via the RDS Data API.
 *
 * Reads CSV files matching `duties_*.csv` from DUTIES_CSV_DIR (default: ./duties),
 * pre-aggregates rows per file by `dutyTempId` (the source emits one row per
 * actor alias for the ~2.3% of duties with multi-alias actor terms; we fold
 * those into a JSON `actor_aliases` array on a single row), and inserts
 * BATCH_SIZE rows per BatchExecuteStatement call.
 *
 * Resumability: per-file completion flag in `bootstrap_progress`. On restart,
 * already-completed files are skipped; partially-loaded files are reprocessed
 * from scratch (ON CONFLICT DO NOTHING makes that idempotent — catches
 * conflicts on either duty_id or duty_uri, both of which have unique
 * constraints in the schema).
 *
 * Required env:
 *   DUTIES_DB_CLUSTER_ARN  Aurora cluster ARN
 *   DUTIES_DB_SECRET_ARN   Cluster master-credentials secret ARN
 *   DUTIES_DB_NAME         Database name (default: 'duties')
 *   AWS_REGION             eu-west-2 typically
 *
 * Optional:
 *   DUTIES_CSV_DIR         Source directory (default: ../duties)
 *   DUTIES_INGEST_RESET    If set to '1', TRUNCATE duties + bootstrap_progress
 *                          before starting (full re-ingest).
 *   DUTIES_INGEST_BATCH    Rows per BatchExecuteStatement (default 500, max 1000).
 *
 * Usage: node scripts/ingest-duties-pg.js
 */

// Load .env first so the documented local workflow (copy .env.example -> .env)
// supplies the cluster ARNs when this script is run directly. Must precede the
// env reads below; no-op in production, where the env vars are injected.
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BatchExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, "..");
const CSV_DIR = process.env.DUTIES_CSV_DIR || join(REPO_ROOT, "duties");

const CLUSTER_ARN = required("DUTIES_DB_CLUSTER_ARN");
const SECRET_ARN = required("DUTIES_DB_SECRET_ARN");
const DB_NAME = process.env.DUTIES_DB_NAME || "duties";
const REGION = process.env.AWS_REGION || "eu-west-2";

const RESET = process.env.DUTIES_INGEST_RESET === "1";
const BATCH_SIZE = clampBatchSize(parseInt(process.env.DUTIES_INGEST_BATCH || "500", 10));

const EXPECTED_HEADERS = [
  "dutyTempId", "duty_uri", "enactment", "enactmentTitle", "enactmentYear",
  "enactmentType", "enactmentNum", "section", "subsection", "actor",
  "actorIsBody", "actorIsAlias", "actorDefinition", "body_uri", "modality",
  "action", "condition", "inference", "priority",
];

const VERSION_DATE_RE = /\/(\d{4}-\d{2}-\d{2})\//;

// Some source rows carry a descriptive English name in the enactmentType column
// instead of the canonical legislation.gov.uk type code (the code is always
// correct in the URI). Normalise the known descriptive labels to their canonical
// code so type filters/grouping aren't split across two values. The loaded data
// is corrected separately by a one-off backfill UPDATE.
// See docs/duties-malformed-rows-2026-03-30.md.
const ENACTMENT_TYPE_ALIASES = {
  EuropeanUnionDirective: "eudr",
  ScottishAct: "asp",
  NorthernIrelandParliamentAct: "apni",
};

const INSERT_SQL = `
INSERT INTO duties (
  duty_id, duty_uri, enactment_uri, enactment_title, enactment_year,
  enactment_type, enactment_num, section_uri, subsection,
  actor, actor_definition, actor_aliases,
  modality, action, condition, inference, priority, version_date, order_key
) VALUES (
  :duty_id, :duty_uri, :enactment_uri, :enactment_title, :enactment_year,
  :enactment_type, :enactment_num, :section_uri, :subsection,
  :actor, :actor_definition, CAST(:actor_aliases AS jsonb),
  :modality, :action, :condition, :inference, :priority, :version_date, :order_key
)
ON CONFLICT DO NOTHING
`;

const client = new RDSDataClient({ region: REGION });

async function main() {
  console.log(`Cluster:   ${CLUSTER_ARN}`);
  console.log(`Database:  ${DB_NAME}`);
  console.log(`CSV dir:   ${CSV_DIR}`);
  console.log(`Batch:     ${BATCH_SIZE} rows`);
  console.log(`Reset:     ${RESET ? "YES (will TRUNCATE first)" : "no"}`);
  console.log();

  if (RESET) {
    console.log("Resetting…");
    await exec("TRUNCATE TABLE duties");
    await exec("TRUNCATE TABLE bootstrap_progress");
  }

  const files = readdirSync(CSV_DIR)
    .filter(f => f.startsWith("duties_") && f.endsWith(".csv"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No duties_*.csv files found in ${CSV_DIR}`);
  }

  const totals = { rowsRead: 0, duties: 0, multiAlias: 0, droppedMalformed: 0 };
  const t0 = Date.now();

  for (const file of files) {
    const t1 = Date.now();
    const { completedAt } = await getProgress(file);
    if (completedAt) {
      console.log(`  ${file}: already complete — skipping`);
      continue;
    }

    const stats = await ingestFile(file);
    totals.rowsRead += stats.rowsRead;
    totals.duties += stats.duties;
    totals.multiAlias += stats.multiAlias;
    totals.droppedMalformed += stats.droppedMalformed;

    const seconds = ((Date.now() - t1) / 1000).toFixed(1);
    console.log(
      `  ${file}: ${stats.duties} duties (${stats.multiAlias} multi-alias), ` +
      `${stats.rowsRead} rows read, ${stats.droppedMalformed} dropped (${seconds}s)`,
    );
  }

  const totalSeconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();
  console.log(`Done in ${totalSeconds}s`);
  console.log(`  rows read:         ${totals.rowsRead}`);
  console.log(`  duties inserted:   ${totals.duties}`);
  console.log(`    of which multi-alias: ${totals.multiAlias}`);
  console.log(`  dropped malformed: ${totals.droppedMalformed}`);
}

async function ingestFile(fileName) {
  const path = join(CSV_DIR, fileName);
  const text = readFileSync(path, "utf8");

  const stats = { rowsRead: 0, duties: 0, multiAlias: 0, droppedMalformed: 0 };
  const byDutyId = new Map(); // duty_id -> aggregated row

  let headerSeen = false;
  for (const csvRow of parseCsv(text)) {
    if (!headerSeen) {
      headerSeen = true;
      const ok = EXPECTED_HEADERS.every((h, i) => csvRow[i] === h);
      if (!ok) {
        throw new Error(`${fileName}: unexpected header: ${csvRow.slice(0, 5).join(",")}…`);
      }
      continue;
    }

    stats.rowsRead++;
    if (csvRow.length < EXPECTED_HEADERS.length) {
      stats.droppedMalformed++;
      continue;
    }

    const dutyId = parseInt(csvRow[0], 10);
    if (!Number.isFinite(dutyId)) {
      stats.droppedMalformed++;
      continue;
    }

    const aliasName = nullIfEmpty(csvRow[11]);  // actorIsAlias
    const aliasIsBody = nullIfEmpty(csvRow[10]); // actorIsBody
    const aliasBodyUri = nullIfEmpty(csvRow[13]); // body_uri

    const existing = byDutyId.get(dutyId);
    if (existing) {
      // Same duty appearing again — append the alias if it's new and non-null.
      if (aliasName !== null && !existing.actorAliases.some(a => a.name === aliasName)) {
        existing.actorAliases.push({ name: aliasName, is_body: aliasIsBody, body_uri: aliasBodyUri });
      }
      continue;
    }

    const row = parseRow(csvRow);
    if (!row) {
      stats.droppedMalformed++;
      continue;
    }
    row.actorAliases = aliasName !== null
      ? [{ name: aliasName, is_body: aliasIsBody, body_uri: aliasBodyUri }]
      : [];
    byDutyId.set(dutyId, row);
  }

  const allRows = [...byDutyId.values()];
  stats.duties = allRows.length;
  stats.multiAlias = allRows.filter(r => r.actorAliases.length > 1).length;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await flushBatch(batch);
  }

  await markComplete(fileName, allRows.length);
  return stats;
}

async function flushBatch(batch) {
  const parameterSets = batch.map(rowToParams);
  await client.send(new BatchExecuteStatementCommand({
    resourceArn: CLUSTER_ARN,
    secretArn: SECRET_ARN,
    database: DB_NAME,
    sql: INSERT_SQL,
    parameterSets,
  }));
}

function rowToParams(r) {
  return [
    { name: "duty_id", value: { longValue: r.dutyId } },
    { name: "duty_uri", value: { stringValue: r.dutyUri } },
    { name: "enactment_uri", value: { stringValue: r.enactmentUri } },
    { name: "enactment_title", value: { stringValue: r.enactmentTitle } },
    nullableLong("enactment_year", r.enactmentYear),
    { name: "enactment_type", value: { stringValue: r.enactmentType } },
    { name: "enactment_num", value: { stringValue: r.enactmentNum } },
    nullableString("section_uri", r.sectionUri),
    nullableString("subsection", r.subsection),
    nullableString("actor", r.actor),
    nullableString("actor_definition", r.actorDefinition),
    { name: "actor_aliases", value: { stringValue: JSON.stringify(r.actorAliases) } },
    { name: "modality", value: { stringValue: r.modality } },
    { name: "action", value: { stringValue: r.action } },
    nullableString("condition", r.condition),
    { name: "inference", value: { stringValue: r.inference } },
    { name: "priority", value: { stringValue: r.priority } },
    nullableString("version_date", r.versionDate),
    nullableString("order_key", r.orderKey),
  ];
}

function nullableString(name, v) {
  return v === null || v === undefined
    ? { name, value: { isNull: true } }
    : { name, value: { stringValue: v } };
}

function nullableLong(name, v) {
  return v === null || v === undefined
    ? { name, value: { isNull: true } }
    : { name, value: { longValue: v } };
}

function parseRow(row) {
  const [
    _dutyTempId, dutyUri, enactment, enactmentTitle, enactmentYear,
    enactmentType, enactmentNum, section, subsection, actor,
    _actorIsBody, _actorIsAlias, actorDefinition, _bodyUri, modality,
    action, condition, inference, priority,
  ] = row;

  const dutyId = parseInt(row[0], 10);
  if (modality !== "duty" && modality !== "power") return null;
  if (inference !== "explicit" && inference !== "implicit") return null;
  if (priority !== "primary" && priority !== "secondary") return null;
  if (!action || action.length === 0) return null;

  return {
    dutyId,
    dutyUri,
    enactmentUri: enactment,
    enactmentTitle,
    enactmentYear: parseYear(enactmentYear, enactmentTitle),
    enactmentType: ENACTMENT_TYPE_ALIASES[enactmentType] ?? enactmentType,
    enactmentNum,
    sectionUri: nullIfEmpty(section),
    subsection: nullIfEmpty(subsection),
    actor: nullIfEmpty(actor),
    actorDefinition: nullIfEmpty(actorDefinition),
    modality,
    action,
    condition: nullIfEmpty(condition),
    inference,
    priority,
    versionDate: parseVersionDate(dutyUri),
    orderKey: makeOrderKey(section, subsection),
  };
}

async function getProgress(fileName) {
  const r = await exec(
    "SELECT completed_at FROM bootstrap_progress WHERE file_name = :file_name",
    [{ name: "file_name", value: { stringValue: fileName } }],
  );
  if (!r.records || r.records.length === 0) {
    return { completedAt: null };
  }
  const rec = r.records[0];
  return { completedAt: rec[0].isNull ? null : rec[0].stringValue };
}

async function markComplete(fileName, dutiesLoaded) {
  await exec(`
    INSERT INTO bootstrap_progress (file_name, duties_loaded, completed_at, last_updated_at)
    VALUES (:file_name, :duties_loaded, NOW(), NOW())
    ON CONFLICT (file_name) DO UPDATE
      SET duties_loaded = EXCLUDED.duties_loaded,
          completed_at = NOW(),
          last_updated_at = NOW()
  `, [
    { name: "file_name", value: { stringValue: fileName } },
    { name: "duties_loaded", value: { longValue: dutiesLoaded } },
  ]);
}

async function exec(sql, parameters = []) {
  return await client.send(new ExecuteStatementCommand({
    resourceArn: CLUSTER_ARN,
    secretArn: SECRET_ARN,
    database: DB_NAME,
    sql,
    parameters,
    includeResultMetadata: false,
  }));
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

function clampBatchSize(n) {
  if (!Number.isFinite(n) || n < 1) return 500;
  if (n > 1000) return 1000;
  return n;
}

// --- CSV + row helpers (mirror scripts/build-duties-db.js) ---

function* parseCsv(text) {
  let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  const len = text.length;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; }
        else { inQuotes = false; i++; }
      } else { field += ch; i++; }
    } else {
      if (ch === '"') { inQuotes = true; i++; }
      else if (ch === ",") { row.push(field); field = ""; i++; }
      else if (ch === "\r") { i++; }
      else if (ch === "\n") { row.push(field); yield row; row = []; field = ""; i++; }
      else { field += ch; i++; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); yield row; }
}

function makeOrderKey(sectionUri, subsection) {
  if (!sectionUri) return "9";
  const m = sectionUri.match(/\/(section|article|regulation|paragraph|schedule)\/(.+)$/);
  let classPrefix = "1";
  let tail;
  if (m) {
    const kind = m[1];
    tail = m[2];
    classPrefix = kind === "schedule" ? "2" : "0";
  } else {
    const slash = sectionUri.lastIndexOf("/");
    tail = slash >= 0 ? sectionUri.slice(slash + 1) : sectionUri;
  }
  if (subsection) tail += "/" + subsection;
  const padded = tail
    .split(/([a-zA-Z]+|\d+)/)
    .filter(Boolean)
    .map(tok => (/^\d+$/.test(tok) ? tok.padStart(6, "0") : tok.toLowerCase()))
    .join("/");
  return classPrefix + "/" + padded;
}

function parseVersionDate(dutyUri) {
  const m = dutyUri.match(VERSION_DATE_RE);
  return m ? m[1] : null;
}

function nullIfEmpty(s) {
  return s === "" || s === undefined ? null : s;
}

function parseYear(s, fallbackTitle) {
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n > 1000 && n < 3000) return n;
  // Fallback for regnal-year Acts: the year column is a regnal form (e.g.
  // "Eliz2/9-10") that doesn't parse, but legislation.gov.uk's canonical short
  // title carries the calendar year as a trailing 4-digit number (e.g. "Land
  // Drainage Act 1961"). Only consulted when the primary parse fails, and only
  // a year anchored at the end of the title, to avoid mid-title false hits.
  if (fallbackTitle) {
    const m = String(fallbackTitle).match(/\b(1\d{3}|2\d{3})\s*$/);
    if (m) {
      const ty = parseInt(m[1], 10);
      if (ty > 1000 && ty < 3000) return ty;
    }
  }
  return null;
}

main().catch(err => {
  console.error(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
