#!/usr/bin/env node

/**
 * Provision the MCP server's dedicated read-only Postgres role.
 *
 * The deployed server authenticates to the Data API as `mcp_ro`, NOT as the
 * cluster's `duties_admin` master user. This script is the other half of that
 * arrangement: the CDK (`infra/lib/data-stack.ts`) generates the role's
 * password into a Secrets Manager secret, and this script creates the role
 * inside Postgres with that password and grants it SELECT on exactly the
 * tables the adapter reads.
 *
 * OPERATOR SCRIPT — run from a workstation with master credentials. Nothing in
 * the deployed service can do any of this: the App Runner instance role holds
 * only `rds-data:ExecuteStatement` plus read on the read-only secret.
 *
 * Convergent WITHIN BOUNDS, not merely idempotent: every run resets the role's
 * settable attributes, revokes the table, sequence and schema privileges it holds
 * in `public` by grant of the master user, and re-grants only what
 * READABLE_TABLES lists — so a role that drifted (edited by hand, or left over
 * from an earlier version of this script) is brought back to the intended
 * state rather than being left alone because it already exists.
 *
 * The bounds are real and worth knowing before relying on this to fix a role:
 * it cannot clear SUPERUSER, REPLICATION or BYPASSRLS (only a superuser may set
 * those — see ALTER_ATTRIBUTES; they are verified and reported, not repaired),
 * it cannot revoke a grant made by a different grantor or in another schema, it
 * detects role memberships rather than removing them, and under PG16 a
 * CREATEROLE role may only ALTER roles it holds ADMIN OPTION on — so a role
 * created by some other admin can refuse reconciliation outright.
 *
 * NOT ATOMIC. Each statement is a separate Data API call, autocommitted. A
 * failure partway through can leave the role existing but unable to read, since
 * the revokes precede the grants. The verification at the end says so plainly;
 * the recovery is to fix the cause and run it again, which is safe — the
 * sequence is written to converge from any partial state.
 *
 * Run it after:
 *   - the first deploy of the read-only secret;
 *   - any rotation of that secret (see the outage note below);
 *   - any change to READABLE_TABLES.
 *
 * NOT after ordinary schema changes. The grants are table-scoped and the
 * duties ingest TRUNCATEs rather than replacing the table, so they survive
 * re-ingestion untouched.
 *
 * Required env: DUTIES_DB_CLUSTER_ARN, DUTIES_DB_SECRET_ARN (master — the
 *               credentials this script authenticates WITH),
 *               DUTIES_DB_RO_SECRET_ARN (the read-only role's secret — the
 *               credentials this script provisions), DUTIES_DB_NAME
 *               (default 'duties'), AWS_REGION (default eu-west-2).
 * Optional env: DUTIES_DB_MASTER_USERNAME (default 'duties_admin') — must match
 *               `DataStack.masterUsername`.
 *               DUTIES_DB_RO_USERNAME (default 'mcp_ro') — must match
 *               `DataStack.mcpReadOnlyUsername`, which is the name CDK writes
 *               into the read-only secret's body. Set it only when deliberately
 *               moving to a differently named role.
 *
 * Usage: node scripts/apply-readonly-role.js
 *
 * ROTATION IS A MAINTENANCE WINDOW, not a zero-downtime sequence. The Data API
 * resolves the secret on every request and the server caches nothing, so the
 * moment the secret's new value lands the live service is presenting a password
 * the role does not have. Re-running this script closes the window; nothing
 * shortens it, because Postgres has no two-valid-passwords state for a single
 * role. If the window ever needs to be zero, the answer is the alternating-users
 * pattern (mcp_ro_a / mcp_ro_b, swapping which one the secret names), not a
 * cleverer ordering of these two steps.
 *
 * NOTE ON CREDENTIAL EXPOSURE: Postgres DDL accepts no bind parameters, so the
 * password has to be inlined into the CREATE/ALTER ROLE statement text. If
 * CloudTrail *data* events are enabled for `rds-data` on this account, that
 * statement body may be captured. They are off by default. If they are ever
 * turned on, switch this to send a pre-computed SCRAM-SHA-256 verifier instead
 * of the plaintext — Postgres accepts one in place of a password, and the
 * plaintext then never crosses the Data API.
 */

// Load .env first so the documented local workflow (copy .env.example -> .env)
// supplies the ARNs when this script is run directly. Must precede the env
// reads below.
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { RDSDataClient, ExecuteStatementCommand } from "@aws-sdk/client-rds-data";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

/**
 * Tables the MCP server is allowed to read, in `schema.table` form.
 *
 * Deliberately an explicit list, not `ALL TABLES IN SCHEMA public`: the schema
 * also holds operator bookkeeping (`bootstrap_progress`,
 * `inforce_ingest_progress`), the in-force dataset (`legislation_status`), and
 * whatever staging relations an ingest leaves behind. The adapter queries only
 * `duties` (see src/api/duties-db-pg.ts), so that is all the role gets.
 *
 * Adding the in-force reader later is more than appending a name here: the
 * in-force ingest builds `legislation_status_next` and RENAMES it into place
 * (scripts/inforce-schema.sql), so the live table becomes a new relation with
 * fresh ACLs on every load and a table-scoped grant would silently lapse. That
 * case needs an explicit post-swap grant in the ingest, or another narrowly
 * scoped mechanism — not a schema-wide default privilege.
 */
const READABLE_TABLES = ["public.duties"];

/** The role's full intended shape, set once at CREATE time. */
export const CREATE_ATTRIBUTES =
  "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";

/**
 * The subset an ALTER may set — deliberately three attributes shorter.
 *
 * Postgres refuses SUPERUSER, REPLICATION and BYPASSRLS from a non-superuser
 * even when the value given is the one the role already has: the check is on
 * whether the option appears in the statement, not on whether it would change
 * anything. Verified against postgres:16, the engine version in
 * infra/lib/data-stack.ts:
 *
 *   ALTER ROLE "mcp_ro" WITH LOGIN NOSUPERUSER NOCREATEDB …
 *   ERROR:  permission denied to alter role
 *   DETAIL: Only roles with the SUPERUSER attribute may change the SUPERUSER attribute.
 *
 * Aurora's master is not a superuser — `rds_superuser` is a role membership, not
 * the attribute — so naming those three here would make the first run succeed
 * and every run after it fail, which is precisely the reconcile path this script
 * exists for. CREATE is exempt: there Postgres checks only when an attribute is
 * being turned ON.
 *
 * Dropping them costs nothing in practice, because drift is still caught on every
 * run. An existing SUPERUSER role is refused before the ALTER, since Postgres
 * rejects any ALTER of one by a non-superuser, even a bare password change; and
 * verifyCatalog checks all three after it. Only a superuser could have introduced
 * that drift, so only a superuser could repair it.
 */
export const ALTER_ATTRIBUTES = "LOGIN NOCREATEDB NOCREATEROLE";

// Assigned by init(), not at module load, so this file can be imported for its
// pure SQL builders (buildStatements / the VERIFY_* queries) without demanding
// AWS configuration. scripts/../test harnesses rely on that.
let CLUSTER_ARN, MASTER_SECRET_ARN, RO_SECRET_ARN, DB_NAME, MASTER_USERNAME, RO_USERNAME, REGION;
let rds, secrets;

function init() {
  CLUSTER_ARN = required("DUTIES_DB_CLUSTER_ARN");
  MASTER_SECRET_ARN = required("DUTIES_DB_SECRET_ARN");
  RO_SECRET_ARN = required("DUTIES_DB_RO_SECRET_ARN");
  DB_NAME = process.env.DUTIES_DB_NAME || "duties";
  MASTER_USERNAME = process.env.DUTIES_DB_MASTER_USERNAME || "duties_admin";
  RO_USERNAME = process.env.DUTIES_DB_RO_USERNAME || "mcp_ro";
  REGION = process.env.AWS_REGION || "eu-west-2";
  rds = new RDSDataClient({ region: REGION });
  secrets = new SecretsManagerClient({ region: REGION });
}

/**
 * The full provisioning sequence, as `{sql, label}` pairs.
 *
 * Pure and exported so it can be executed against a throwaway Postgres to
 * validate the SQL, without an Aurora cluster or the Data API in the way.
 * `label` is what gets printed — the CREATE/ALTER statement carries the
 * password inline and must never be echoed.
 */
export function buildStatements({ roleIdent, dbIdent, ownerIdent, tables, exists, passwordLiteral, roleName }) {
  return [
    // 1. Role identity and attributes. Enforced on both paths, so a role that
    //    drifted (or was created by hand) converges instead of persisting.
    {
      sql: exists
        ? `ALTER ROLE ${roleIdent} WITH ${ALTER_ATTRIBUTES} PASSWORD ${passwordLiteral}`
        : `CREATE ROLE ${roleIdent} WITH ${CREATE_ATTRIBUTES} PASSWORD ${passwordLiteral}`,
      label: exists
        ? `ALTER ROLE ${roleName} … (${ALTER_ATTRIBUTES.toLowerCase()}, sync password with secret)`
        : `CREATE ROLE ${roleName} … (${CREATE_ATTRIBUTES.toLowerCase()})`,
    },

    // 2. Revoke first. Without this the script only ever adds privileges, so a
    //    grant made by hand — or by an earlier, broader version of this script —
    //    would survive every "successful" run.
    { sql: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${roleIdent}` },
    { sql: `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${roleIdent}` },
    { sql: `REVOKE ALL ON SCHEMA public FROM ${roleIdent}` },
    // Database level too. Without this a hand-made `GRANT CREATE ON DATABASE`
    // is *detected* by verifyCatalog's db_create check on every run and repaired
    // by none of them — the one privilege class the revoke block used to miss.
    // CONNECT and TEMPORARY are PUBLIC defaults, so revoking them from this role
    // changes nothing effective; CREATE is what this actually removes.
    { sql: `REVOKE ALL ON DATABASE ${dbIdent} FROM ${roleIdent}` },
    // Earlier revisions of this script set a schema-wide default privilege for
    // this role. Clear it, or it keeps granting SELECT on every table the owner
    // creates from here on.
    {
      sql:
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA public ` +
        `REVOKE ALL ON TABLES FROM ${roleIdent}`,
    },

    // 3. Grant back exactly what the adapter needs.
    // CONNECT is redundant against stock defaults, since PUBLIC holds it on every
    // database. It earns its place only where CONNECT has been revoked from
    // PUBLIC as a hardening step — and it has to follow the revoke above.
    { sql: `GRANT CONNECT ON DATABASE ${dbIdent} TO ${roleIdent}` },
    { sql: `GRANT USAGE ON SCHEMA public TO ${roleIdent}` },
    ...tables.map(table => ({ sql: `GRANT SELECT ON TABLE ${table} TO ${roleIdent}` })),
  ];
}

/** Catalog attributes, memberships, and database-level CREATE. */
export const VERIFY_ATTRIBUTES_SQL = `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolcanlogin,
            r.rolreplication, r.rolbypassrls,
            (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) AS memberships,
            has_database_privilege(r.rolname, current_database(), 'CREATE') AS db_create
       FROM pg_roles r WHERE r.rolname = :name`;

/** Every direct table privilege the role holds, as granted by the current user. */
export const VERIFY_PRIVILEGES_SQL = `SELECT table_schema || '.' || table_name AS relname, privilege_type
       FROM information_schema.table_privileges
      WHERE grantee = :name
      ORDER BY 1, 2`;

/**
 * Confirms the "master" secret authenticates as the configured master user
 * (DUTIES_DB_MASTER_USERNAME). That role is expected to own the tables, since
 * it creates them, but this establishes the identity, not the ownership.
 */
export const VERIFY_IDENTITY_SQL = `SELECT current_user AS whoami`;

/**
 * Pure half of the identity guard, so the mismatch case is testable without a
 * cluster: returns an error message, or null when the identity is as expected.
 */
export function identityProblem(actual, expected) {
  if (actual === expected) return null;
  return (
    `Refusing to provision: DUTIES_DB_SECRET_ARN authenticates as "${actual}", ` +
    `not the expected owner "${expected}".\n` +
    `That variable means different things to different consumers — the master ` +
    `secret to this script, the mcp_ro secret to the running MCP server. A ` +
    `sourced or dotenv-loaded post-cutover mcp/.env is the usual cause. Set ` +
    `DUTIES_DB_SECRET_ARN to the cluster master secret, or override the expected ` +
    `owner with DUTIES_DB_MASTER_USERNAME.`
  );
}

/**
 * Pure half of the target guard: the role this script is about to provision must
 * not be the cluster master.
 *
 * The ARN-inequality check in main() cannot catch this — two different secrets
 * can name the same role. Without this, a read-only secret whose body said
 * `duties_admin` would send the master role through the ALTER branch: its
 * password reset to the read-only secret's value (leaving the master secret in
 * Secrets Manager stale, and the cluster's administrative credentials unknown)
 * and its CREATEDB/CREATEROLE stripped.
 *
 * Postgres happens to refuse most of that today, on attribute and ADMIN OPTION
 * grounds — but a self-directed `ALTER ROLE … PASSWORD` does succeed, and that
 * defence is version-dependent Postgres permission semantics rather than
 * anything this script controls. Guard it here instead.
 *
 * Two separate refusals. The master check is the dangerous case and is stated
 * on its own terms; the expected-name check then narrows the target to the one
 * role this script is contracted to manage, so a secret naming some third role
 * cannot have its password reset either. Both stand independently: pointing
 * DUTIES_DB_RO_USERNAME at the master still trips the first.
 *
 * `mcp_ro` is not a guess. DataStack writes it into the secret body
 * (`mcpReadOnlyUsername`, infra/lib/data-stack.ts) and infra pins the literal in
 * its own test, so it is a cross-repository contract. It stays overridable for
 * the alternating mcp_ro_a/mcp_ro_b rotation the header describes — but that
 * now takes a deliberate DUTIES_DB_RO_USERNAME, not silence.
 */
export function targetProblem(target, expected, masterUsername) {
  if (target === masterUsername) {
    return (
      `Refusing to provision: DUTIES_DB_RO_SECRET_ARN names the role "${target}", ` +
      `which is this cluster's master user.\n` +
      `Provisioning it would reset the master password to that secret's value and ` +
      `strip the role's administrative attributes. Point DUTIES_DB_RO_SECRET_ARN ` +
      `at the read-only secret (the DataStack output McpReadOnlySecretArn), or if ` +
      `the master really is named something else, set DUTIES_DB_MASTER_USERNAME.`
    );
  }
  if (target !== expected) {
    return (
      `Refusing to provision: DUTIES_DB_RO_SECRET_ARN names the role "${target}", ` +
      `but this script provisions "${expected}".\n` +
      `"${expected}" is what DataStack writes into the read-only secret, so a ` +
      `different name means that ARN points at some other secret — and running on ` +
      `would reset that role's password and rewrite its attributes. Check the ARN ` +
      `against the McpReadOnlySecretArn stack output. If you are deliberately ` +
      `provisioning a differently named role, set DUTIES_DB_RO_USERNAME.`
    );
  }
  return null;
}

/** Table privileges that would make the role more than a reader. */
const WRITE_PRIVILEGES = "INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER";

/** Column-level equivalents. The table-level test does not see these. */
const WRITE_COLUMN_PRIVILEGES = "INSERT, UPDATE, REFERENCES";

/**
 * Run as the role itself: proves authentication, identity, read, and no-write.
 *
 * This is the only check that sees *effective* privileges, which is why it tests
 * every write privilege rather than a representative one. verifyCatalog reads
 * information_schema.table_privileges filtered on grantee, so a grant made to
 * PUBLIC is invisible to it; has_table_privilege accounts for PUBLIC. Postgres
 * treats INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER as distinct
 * privileges, and column-level grants as distinct again, so all of them are
 * named here — a role holding UPDATE but not INSERT is not read-only.
 *
 * Built from the table list rather than hardcoding `public.duties`, so adding a
 * table to READABLE_TABLES cannot leave it unverified.
 */
export function buildLiveVerifySql(tables) {
  const writable = tables
    .map(
      t =>
        `has_table_privilege('${t}', '${WRITE_PRIVILEGES}') OR ` +
        `has_any_column_privilege('${t}', '${WRITE_COLUMN_PRIVILEGES}')`
    )
    .join(" OR ");
  const readable = tables
    .map(t => `(SELECT count(*) FROM (SELECT 1 FROM ${t} LIMIT 1) probe)`)
    .join(" + ");
  return `SELECT current_user AS whoami,
              (${writable}) AS can_write,
              (${readable}) AS readable`;
}

/**
 * The whole provisioning sequence, with its I/O injected.
 *
 * main() passes the real Data API and Secrets Manager clients; the tests pass
 * fakes that record every call. That injection is the only way to assert the
 * property this script exists for — that both refusal guards run before the
 * first mutating statement. Nothing about that ordering is visible in the SQL
 * builders, because every statement leaves the process through `execute`.
 *
 * Throws ProvisionError on any refusal or failed verification; the caller
 * decides how to report it.
 *
 * @param execute   (secretArn, sql, parameters?) => Data API response
 * @param getSecret (arn) => the secret's SecretString
 */
export async function provision({ config, execute, getSecret, log = console.log }) {
  const { clusterArn, masterSecretArn, roSecretArn, dbName, masterUsername, roUsername } =
    config;
  const asMaster = (sql, parameters) => execute(masterSecretArn, sql, parameters);
  const asRole = (sql, parameters) => execute(roSecretArn, sql, parameters);

  if (masterSecretArn === roSecretArn) {
    fail(
      "DUTIES_DB_SECRET_ARN and DUTIES_DB_RO_SECRET_ARN are the same secret. " +
        "The first must be the cluster master credentials, the second the " +
        "read-only role's — provisioning a role with its own credentials is a no-op."
    );
  }

  // Target guard. Nothing but the secret read precedes it, because the secret's
  // body is what it checks — so a misdirected DUTIES_DB_RO_SECRET_ARN is refused
  // before this script touches the database at all.
  const { username, password } = await readRoleSecret(getSecret, roSecretArn);
  const targetIssue = targetProblem(username, roUsername, masterUsername);
  if (targetIssue) fail(targetIssue);

  const roleIdent = identifier(username, "read-only role name");
  const dbIdent = identifier(dbName, "DUTIES_DB_NAME");
  const ownerIdent = identifier(masterUsername, "DUTIES_DB_MASTER_USERNAME");
  const tables = READABLE_TABLES.map(qualifiedTable);

  log(`Cluster:  ${clusterArn}`);
  log(`Database: ${dbName}`);
  log(`Role:     ${username} (owner: ${masterUsername})`);
  log(`Readable: ${READABLE_TABLES.join(", ")}`);
  log("");

  // Identity guard — the first database operation, before existingRole() and
  // before any DDL. Everything below runs as whoever DUTIES_DB_SECRET_ARN
  // names; if that is not the owner, the grants would be made by the wrong
  // grantor (or fail halfway through), so this refuses before changing
  // anything. Distinct from the ARN-equality check above: that one catches the
  // two secrets being literally the same, this one catches the master ARN
  // being some other non-owner role.
  const idRes = await asMaster(VERIFY_IDENTITY_SQL, []);
  const whoami = idRes.records?.[0]?.[0]?.stringValue;
  const problem = identityProblem(whoami, masterUsername);
  if (problem) fail(problem);
  log(`Authenticated as ${whoami}.`);
  log("");

  const existing = await existingRole(asMaster, username);

  // SUPERUSER preflight. Postgres will not let a non-superuser alter a SUPERUSER
  // role at all, so the ALTER below would fail on Postgres's own error before
  // verifyCatalog could explain it. Refuse here instead, before any mutation.
  if (existing?.superuser) {
    fail(
      `Refusing to provision: ${username} already exists and is SUPERUSER. ` +
        `Postgres lets no non-superuser alter such a role, not even its password, ` +
        `so nothing has been changed.` +
        superuserOnlyAdvice([["is SUPERUSER", "NOSUPERUSER"]], { roleIdent, dbIdent })
    );
  }
  const exists = existing !== null;

  for (const { sql, label } of buildStatements({
    roleIdent,
    dbIdent,
    ownerIdent,
    tables,
    exists,
    passwordLiteral: literal(password),
    roleName: username,
  })) {
    // The CREATE/ALTER statement carries the password inline, so the label is
    // printed and the SQL never is.
    log(`  ${label ?? sql.replace(/\s+/g, " ").slice(0, 80)}…`);
    await asMaster(sql);
  }

  log("");
  await verifyCatalog(asMaster, { name: username, roleIdent, dbIdent }, log);
  await verifyAuthentication(asRole, username, tables, log);
  log("");
  log(`Role ${username} provisioned.`);
}

async function main() {
  init();
  await provision({
    config: {
      clusterArn: CLUSTER_ARN,
      masterSecretArn: MASTER_SECRET_ARN,
      roSecretArn: RO_SECRET_ARN,
      dbName: DB_NAME,
      masterUsername: MASTER_USERNAME,
      roUsername: RO_USERNAME,
    },
    execute: exec,
    getSecret: async arn => {
      const res = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
      return res.SecretString;
    },
  });
}

/** Fetch and validate the {username, password} body the Data API expects. */
async function readRoleSecret(getSecret, arn) {
  const secretString = await getSecret(arn);
  if (!secretString) {
    fail(`Secret ${arn} has no SecretString (binary secrets are not supported)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    fail(`Secret ${arn} is not JSON. Expected {"username":…,"password":…}.`);
  }
  const { username, password } = parsed;
  if (typeof username !== "string" || !username) {
    fail(`Secret ${arn} has no "username" field.`);
  }
  if (typeof password !== "string" || !password) {
    fail(`Secret ${arn} has no "password" field.`);
  }
  // The CDK generates this password with excludeCharacters covering quotes and
  // backslash precisely so the literal below is unambiguous. A hand-rotated
  // value could reintroduce them; refuse rather than risk a mis-parsed literal.
  if (/['"\\]/.test(password)) {
    fail(
      `Password in ${arn} contains a quote or backslash. Regenerate it without ` +
        `those characters (see excludeCharacters in infra/lib/data-stack.ts).`
    );
  }
  return { username, password };
}

/** null if the role does not exist; otherwise whether it is SUPERUSER. */
async function existingRole(asMaster, name) {
  const res = await asMaster("SELECT rolsuper FROM pg_roles WHERE rolname = :name", [
    { name: "name", value: { stringValue: name } },
  ]);
  const row = res.records?.[0];
  return row ? { superuser: row[0].booleanValue === true } : null;
}

/**
 * Catalog-level checks: the role's attributes, its memberships, and the exact
 * set of table privileges it holds.
 *
 * Runs as the master user, so `information_schema.table_privileges` sees the
 * grants it made. That is what makes the "no unexpected privileges" check
 * meaningful — a grant made by a *different* grantor would not appear, which is
 * why the attribute and membership checks matter alongside it.
 */
async function verifyCatalog(asMaster, { name, roleIdent, dbIdent }, log) {
  const attrs = await asMaster(VERIFY_ATTRIBUTES_SQL, [
    { name: "name", value: { stringValue: name } },
  ]);
  const row = attrs.records?.[0];
  if (!row) fail(`Verification failed: role ${name} not found after provisioning.`);

  const [sup, cdb, crole, login, repl, bypass, members, dbCreate] = row;
  const problems = [];
  // Split out the three this script cannot clear (see ALTER_ATTRIBUTES), so the
  // failure tells the operator to fetch a superuser rather than to re-run.
  const superuserOnly = [];
  if (sup.booleanValue) superuserOnly.push(["is SUPERUSER", "NOSUPERUSER"]);
  if (repl.booleanValue) superuserOnly.push(["has REPLICATION", "NOREPLICATION"]);
  if (bypass.booleanValue) superuserOnly.push(["has BYPASSRLS", "NOBYPASSRLS"]);
  if (cdb.booleanValue) problems.push("has CREATEDB");
  if (crole.booleanValue) problems.push("has CREATEROLE");
  if (!login.booleanValue) problems.push("cannot LOGIN");
  if (dbCreate.booleanValue) problems.push("has CREATE on the database");
  if (Number(members.longValue ?? 0) > 0) {
    problems.push(
      `is a member of ${members.longValue} other role(s) — it would inherit their privileges`
    );
  }

  // Exact privilege set, not a count of non-SELECT grants: an extra SELECT on a
  // table the adapter never reads is also a finding.
  const privs = await asMaster(VERIFY_PRIVILEGES_SQL, [
    { name: "name", value: { stringValue: name } },
  ]);
  const held = (privs.records ?? []).map(
    r => `${r[0].stringValue}:${r[1].stringValue}`
  );
  const expected = READABLE_TABLES.map(t => `${t}:SELECT`);
  const unexpected = held.filter(h => !expected.includes(h));
  const missing = expected.filter(e => !held.includes(e));
  if (unexpected.length > 0) problems.push(`holds unexpected privileges: ${unexpected.join(", ")}`);
  if (missing.length > 0) problems.push(`is missing required privileges: ${missing.join(", ")}`);

  const all = [...superuserOnly.map(([desc]) => desc), ...problems];
  if (all.length > 0) {
    // SUPERUSER is normally refused by the preflight in provision(); this branch
    // is the backstop should it appear after that.
    let message = `Verification failed — ${name} ${all.join("; ")}.`;
    if (superuserOnly.length > 0) {
      message += superuserOnlyAdvice(superuserOnly, { roleIdent, dbIdent });
    }
    fail(message);
  }
  log(`Verified (catalog): ${name} holds exactly ${expected.join(", ")}.`);
}

/**
 * Why SUPERUSER, REPLICATION or BYPASSRLS cannot be cleared from here, and what
 * to do instead. `found` holds [description, NO-form] pairs for the ones set.
 * Shared by the SUPERUSER preflight in provision() and by verifyCatalog.
 */
function superuserOnlyAdvice(found, { roleIdent, dbIdent }) {
  let message =
    `\nThis script cannot clear ${found.length === 1 ? "that" : "those"}: ` +
    `only a true Postgres superuser may set ${found.length === 1 ? "it" : "them"}, ` +
    `and no Aurora principal is one — rds_superuser is a role membership, not ` +
    `the attribute. On a stock Aurora cluster this state should be unreachable, ` +
    `since setting these takes the same privilege as clearing them.`;
  if (found.some(([, fix]) => fix === "NOSUPERUSER")) {
    // A SUPERUSER role can be neither altered nor dropped by a non-superuser,
    // so there is no local remedy at all — verified against postgres:16.
    message +=
      `\nA SUPERUSER role can be neither altered nor dropped from here. Do not ` +
      `deploy the MCP stack; raise this with AWS support.`;
  } else {
    // REPLICATION and BYPASSRLS roles *can* be dropped by the master, so
    // recreating is a real remedy. The REVOKEs are required: DROP ROLE
    // refuses while the role holds privileges, and DROP OWNED BY is refused
    // to a non-member of the role. Both verified against postgres:16.
    //
    // Quoted identifiers, not bare names: isPlainIdentifier permits upper
    // case, and an unquoted `DROP ROLE Mcp_Ro` folds to `mcp_ro` — a role
    // this script never created, and possibly one it did not mean to drop.
    message +=
      `\nRecreate the role instead. As the master user:\n` +
      `  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${roleIdent};\n` +
      `  REVOKE ALL ON SCHEMA public FROM ${roleIdent};\n` +
      `  REVOKE ALL ON DATABASE ${dbIdent} FROM ${roleIdent};\n` +
      `  DROP ROLE ${roleIdent};\n` +
      `then re-run this script — the CREATE branch sets every attribute. The ` +
      `REVOKEs are not optional: DROP ROLE refuses while the role holds ` +
      `privileges, and DROP OWNED BY is refused to a non-member. If DROP ROLE ` +
      `still fails after them, the role holds something granted by another ` +
      `grantor or in another schema, which this script never sees; the error's ` +
      `DETAIL lines name it.`;
  }
  return message;
}

/**
 * The check that actually matters before deploying: authenticate through the
 * read-only secret itself.
 *
 * Everything above runs as the master user and proves only what the catalog
 * says. It cannot tell you whether the password in the secret matches the one
 * on the role — which is the exact failure that would take the duties tools
 * down after deploy. This connects as `mcp_ro` and reads the table for real.
 */
async function verifyAuthentication(asRole, name, tables, log) {
  let res;
  try {
    res = await asRole(buildLiveVerifySql(tables));
  } catch (err) {
    fail(
      `Authentication as ${name} FAILED: ${err instanceof Error ? err.message : String(err)}\n` +
        `The role exists but the read-only secret does not authenticate as it. ` +
        `Do NOT deploy the MCP stack until this passes.`
    );
  }
  const [whoami, canWrite] = res.records[0];
  if (whoami.stringValue !== name) {
    fail(`Authenticated as '${whoami.stringValue}', expected '${name}'.`);
  }
  if (canWrite.booleanValue) {
    fail(
      `${name} holds a write privilege on one of ${READABLE_TABLES.join(", ")} ` +
        `(${WRITE_PRIVILEGES}, or the column-level form) — it is not read-only. ` +
        `A grant to PUBLIC is the likeliest source, since verifyCatalog found ` +
        `nothing granted to the role directly.`
    );
  }
  log(
    `Verified (live): authenticated as ${name}; SELECT works, no write privilege ` +
      `on ${READABLE_TABLES.join(", ")}.`
  );
}

function exec(secretArn, sql, parameters) {
  return rds.send(
    new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn,
      database: DB_NAME,
      sql,
      ...(parameters ? { parameters } : {}),
    })
  );
}

/**
 * Does `value` look like a plain Postgres identifier? Pure half of identifier(),
 * which exits the process on rejection and so cannot be tested directly.
 */
export function isPlainIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * Quote a Postgres identifier. Identifiers here come from config, not user
 * input, but they are interpolated into DDL — so validate rather than trust.
 */
function identifier(value, what) {
  if (!isPlainIdentifier(value)) {
    fail(
      `Invalid ${what}: '${value}'. Expected a plain Postgres identifier ` +
        `(letters, digits, underscore; not starting with a digit).`
    );
  }
  return `"${value}"`;
}

/** Validate and quote a `schema.table` entry from READABLE_TABLES. */
function qualifiedTable(value) {
  const parts = value.split(".");
  if (parts.length !== 2) {
    fail(`Invalid READABLE_TABLES entry '${value}'. Expected 'schema.table'.`);
  }
  return parts.map(p => identifier(p, `READABLE_TABLES entry '${value}'`)).join(".");
}

/** Quote a Postgres string literal, doubling any embedded single quotes. */
export function literal(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(2);
  }
  return v;
}

/**
 * A deliberate refusal or a failed verification — as opposed to an unexpected
 * error. Reported bare, without a stack: the message is written for an operator.
 */
export class ProvisionError extends Error {}

function fail(message) {
  throw new ProvisionError(message);
}

// Only run when executed directly, so importing this module for its SQL
// builders does not fire the provisioning sequence.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    if (err instanceof ProvisionError) {
      console.error(err.message);
      process.exit(1);
    }
    console.error(`Role provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}
