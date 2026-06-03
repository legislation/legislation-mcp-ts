#!/usr/bin/env node

/**
 * Build the powers-and-duties SQLite database from CSV files.
 *
 * Reads CSV files matching `duties_*.csv` from DUTIES_CSV_DIR (default: ./duties),
 * writes a SQLite database to ./data/duties.db.
 *
 * The output database is the single source for the search_powers_and_duties,
 * count_powers_and_duties, and get_powers_and_duties MCP tools. See docs/adr/2026-05-26-powers-and-duties-sqlite.md.
 */

// Load .env first so a .env-configured DUTIES_CSV_DIR is honoured when this
// script is run directly (no-op when no .env is present, e.g. in CI/production).
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync, existsSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, "..");
const CSV_DIR = process.env.DUTIES_CSV_DIR || join(REPO_ROOT, "duties");
const OUT_DIR = join(REPO_ROOT, "data");
const OUT_DB = join(OUT_DIR, "duties.db");
const OUT_DB_TMP = OUT_DB + ".tmp";

const SCHEMA = `
CREATE TABLE duties (
  duty_id            INTEGER PRIMARY KEY,
  duty_uri           TEXT NOT NULL UNIQUE,
  enactment_uri      TEXT NOT NULL,
  enactment_title    TEXT NOT NULL,
  enactment_year     INTEGER,
  enactment_type     TEXT NOT NULL,
  enactment_num      TEXT NOT NULL,
  section_uri        TEXT,
  subsection         TEXT,
  actor              TEXT,
  actor_is_body      TEXT,
  actor_is_alias     TEXT,
  actor_definition   TEXT,
  body_uri           TEXT,
  modality           TEXT CHECK (modality IN ('duty','power')),
  action             TEXT NOT NULL,
  condition          TEXT,
  inference          TEXT CHECK (inference IN ('explicit','implicit')),
  priority           TEXT CHECK (priority IN ('primary','secondary')),
  version_date       TEXT,
  order_key          TEXT
);

CREATE INDEX idx_duties_enactment ON duties(enactment_uri, order_key);
CREATE INDEX idx_duties_type_year ON duties(enactment_type, enactment_year);
CREATE INDEX idx_duties_actor     ON duties(actor);
CREATE INDEX idx_duties_modality  ON duties(modality, priority, inference);

CREATE VIRTUAL TABLE duties_fts USING fts5(
  action, condition, actor,
  content='duties', content_rowid='duty_id',
  tokenize='porter unicode61'
);
`;

const EXPECTED_HEADERS = [
  "dutyTempId", "duty_uri", "enactment", "enactmentTitle", "enactmentYear",
  "enactmentType", "enactmentNum", "section", "subsection", "actor",
  "actorIsBody", "actorIsAlias", "actorDefinition", "body_uri", "modality",
  "action", "condition", "inference", "priority",
];

const VERSION_DATE_RE = /\/(\d{4}-\d{2}-\d{2})\//;

/**
 * Minimal RFC 4180-ish CSV parser. Handles quoted fields, escaped quotes ("")
 * and embedded newlines. Yields one array of strings per record.
 * Strips a leading UTF-8 BOM on the first character if present.
 */
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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        // swallow; \n handles record boundary
        i++;
      } else if (ch === "\n") {
        row.push(field);
        yield row;
        row = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/**
 * Build an order_key from section_uri and subsection that sorts provisions
 * in legal order on the common case (section 2 before section 10, sections
 * before schedules, schedule paragraphs nested within their schedule).
 *
 * Format: `<class>/<padded-tail>` where class is a single digit:
 *   0 — main body: section, article, regulation, paragraph
 *   1 — unknown / no recognised provision keyword
 *   2 — schedule (and anything nested within it)
 *
 * The padded tail tokenises the URI fragment after the class keyword on
 * letter/digit boundaries, zero-padding numeric runs to 6 digits so `2`
 * sorts before `10` lexicographically.
 */
function makeOrderKey(sectionUri, subsection) {
  if (!sectionUri) return "9"; // unknown — sort to the end after class 2
  const m = sectionUri.match(/\/(section|article|regulation|paragraph|schedule)\/(.+)$/);
  let classPrefix = "1";
  let tail;
  if (m) {
    const kind = m[1];
    tail = m[2];
    if (kind === "schedule") classPrefix = "2";
    else classPrefix = "0";
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

function parseYear(s) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 1000 && n < 3000 ? n : null;
}

function main() {
  if (!existsSync(CSV_DIR)) {
    console.error(`CSV source directory not found: ${CSV_DIR}`);
    console.error(`Set DUTIES_CSV_DIR or place CSVs in ./duties/`);
    process.exit(1);
  }

  const files = readdirSync(CSV_DIR)
    .filter(f => f.startsWith("duties_") && f.endsWith(".csv"))
    .sort();

  if (files.length === 0) {
    console.error(`No duties_*.csv files found in ${CSV_DIR}`);
    process.exit(1);
  }

  console.log(`Reading ${files.length} CSV files from ${CSV_DIR}`);

  mkdirSync(OUT_DIR, { recursive: true });
  // Clean any stale tmp from a previous failed run, but never touch OUT_DB itself
  // until the new build has succeeded.
  if (existsSync(OUT_DB_TMP)) unlinkSync(OUT_DB_TMP);

  const db = new DatabaseSync(OUT_DB_TMP);
  const counts = {
    rowsRead: 0,
    inserted: 0,
    droppedMalformed: 0,
    droppedDuplicate: 0,
    droppedHeader: 0,
    fileCount: files.length,
  };
  let inTransaction = false;

  try {
    db.exec("PRAGMA journal_mode = OFF;");
    db.exec("PRAGMA synchronous = OFF;");
    db.exec(SCHEMA);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO duties (
        duty_id, duty_uri, enactment_uri, enactment_title, enactment_year,
        enactment_type, enactment_num, section_uri, subsection, actor,
        actor_is_body, actor_is_alias, actor_definition, body_uri, modality,
        action, condition, inference, priority, version_date, order_key
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    db.exec("BEGIN");
    inTransaction = true;
    for (const file of files) {
      const path = join(CSV_DIR, file);
      const text = readFileSync(path, "utf8");
      let isFirst = true;
      let perFile = 0;
      for (const row of parseCsv(text)) {
        if (isFirst) {
          isFirst = false;
          const ok = EXPECTED_HEADERS.every((h, i) => row[i] === h);
          if (!ok) {
            throw new Error(`${file}: unexpected header: ${row.slice(0, 5).join(",")}...`);
          }
          continue;
        }
        counts.rowsRead++;
        perFile++;

        if (row.length < EXPECTED_HEADERS.length) {
          counts.droppedMalformed++;
          continue;
        }

        const [
          dutyTempId, dutyUri, enactment, enactmentTitle, enactmentYear,
          enactmentType, enactmentNum, section, subsection, actor,
          actorIsBody, actorIsAlias, actorDefinition, bodyUri, modality,
          action, condition, inference, priority,
        ] = row;

        const dutyId = parseInt(dutyTempId, 10);
        if (!Number.isFinite(dutyId)) {
          counts.droppedMalformed++;
          continue;
        }
        if (modality !== "duty" && modality !== "power") {
          counts.droppedMalformed++;
          continue;
        }
        if (inference !== "explicit" && inference !== "implicit") {
          counts.droppedMalformed++;
          continue;
        }
        if (priority !== "primary" && priority !== "secondary") {
          counts.droppedMalformed++;
          continue;
        }
        if (!action || action.length === 0) {
          counts.droppedMalformed++;
          continue;
        }

        const result = insert.run(
          dutyId,
          dutyUri,
          enactment,
          enactmentTitle,
          parseYear(enactmentYear),
          enactmentType,
          enactmentNum,
          nullIfEmpty(section),
          nullIfEmpty(subsection),
          nullIfEmpty(actor),
          nullIfEmpty(actorIsBody),
          nullIfEmpty(actorIsAlias),
          nullIfEmpty(actorDefinition),
          nullIfEmpty(bodyUri),
          modality,
          action,
          nullIfEmpty(condition),
          inference,
          priority,
          parseVersionDate(dutyUri),
          makeOrderKey(section, subsection),
        );
        if (result.changes === 1) counts.inserted++;
        else counts.droppedDuplicate++;
      }
      console.log(`  ${file}: ${perFile} rows`);
    }
    db.exec("COMMIT");
    inTransaction = false;

    console.log("Populating FTS index...");
    db.exec(`
      INSERT INTO duties_fts(rowid, action, condition, actor)
        SELECT duty_id, action, COALESCE(condition,''), COALESCE(actor,'') FROM duties
    `);

    console.log("Optimising FTS...");
    db.exec(`INSERT INTO duties_fts(duties_fts) VALUES('optimize')`);

    db.exec("ANALYZE");
    db.close();
  } catch (err) {
    console.error(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
    try { if (inTransaction) db.exec("ROLLBACK"); } catch {}
    try { db.close(); } catch {}
    try { if (existsSync(OUT_DB_TMP)) unlinkSync(OUT_DB_TMP); } catch {}
    console.error(`Previous ${OUT_DB} (if any) left untouched.`);
    process.exit(1);
  }

  // Atomic publish: only at this point does the previous DB get replaced.
  renameSync(OUT_DB_TMP, OUT_DB);

  const sizeMb = (statSync(OUT_DB).size / (1024 * 1024)).toFixed(1);
  console.log("");
  console.log(`Done: ${OUT_DB}  (${sizeMb} MB)`);
  console.log(`  files read:        ${counts.fileCount}`);
  console.log(`  rows read:         ${counts.rowsRead}`);
  console.log(`  rows inserted:     ${counts.inserted}`);
  console.log(`  dropped malformed: ${counts.droppedMalformed}`);
  console.log(`  dropped duplicate: ${counts.droppedDuplicate}`);
}

main();
