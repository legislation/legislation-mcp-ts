#!/usr/bin/env node

/**
 * Apply scripts/duties-schema.sql to the Aurora duties cluster via Data API.
 *
 * Idempotent (the schema uses CREATE … IF NOT EXISTS), so safe to re-run.
 *
 * Required env: DUTIES_DB_CLUSTER_ARN, DUTIES_DB_SECRET_ARN,
 *               DUTIES_DB_NAME (default 'duties'), AWS_REGION.
 *
 * Usage: node scripts/apply-duties-schema.js
 */

// Load .env first so the documented local workflow (copy .env.example -> .env)
// supplies the cluster ARNs when this script is run directly. Must precede the
// env reads below; no-op in production, where the env vars are injected.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLUSTER_ARN = required("DUTIES_DB_CLUSTER_ARN");
const SECRET_ARN = required("DUTIES_DB_SECRET_ARN");
const DB_NAME = process.env.DUTIES_DB_NAME || "duties";
const REGION = process.env.AWS_REGION || "eu-west-2";

const SCHEMA_PATH = join(__dirname, "duties-schema.sql");

const client = new RDSDataClient({ region: REGION });

async function main() {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  const statements = splitStatements(sql);
  console.log(`Applying ${statements.length} statements from ${SCHEMA_PATH}`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}…  `);
    await client.send(new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DB_NAME,
      sql: stmt,
    }));
    console.log("ok");
  }
  console.log("Schema applied.");
}

/**
 * Strip line comments and split on `;` at statement boundaries.
 *
 * Deliberately naive: it splits on every `;` without understanding string
 * literals or dollar-quoted function bodies. That is safe for THIS schema
 * only because no statement contains a `;` inside quotes — the lone string
 * literal, `DEFAULT '[]'::jsonb`, has none. If a future statement adds a
 * semicolon inside a string literal or a dollar-quoted block, replace this
 * with a real tokenizer.
 */
function splitStatements(sql) {
  const noComments = sql
    .split("\n")
    .map(line => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
  return noComments
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

main().catch(err => {
  console.error(`Schema apply failed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
