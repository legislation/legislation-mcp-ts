/**
 * Tests for apply-readonly-role.js.
 *
 * Lives beside the script rather than under src/test/ because tsconfig sets
 * rootDir: ./src with no allowJs, so a TypeScript test cannot import a .js file
 * from scripts/. Run by the `scripts/*.test.js` glob in package.json's test
 * script. The module is import-safe: main() only fires when it is the entry
 * point, so importing it here provisions nothing.
 *
 * Two layers. The pure helpers and SQL builders are tested directly. The
 * orchestration is tested through provision(), with the Data API and Secrets
 * Manager replaced by fakes that record every call — that is the only way to
 * assert the property the guards exist for, since ordering is invisible in the
 * SQL itself.
 *
 * What is NOT covered here: whether the SQL is accepted by Postgres. That is
 * checked by running buildStatements' output against a throwaway postgres:16
 * container, which is how the CREATE/ALTER attribute split was found.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identityProblem,
  targetProblem,
  buildStatements,
  buildLiveVerifySql,
  isPlainIdentifier,
  literal,
  provision,
  ProvisionError,
  CREATE_ATTRIBUTES,
  ALTER_ATTRIBUTES,
} from "./apply-readonly-role.js";

const FIXTURE = {
  roleIdent: '"mcp_ro"',
  dbIdent: '"duties"',
  ownerIdent: '"duties_admin"',
  tables: ['"public"."duties"'],
  exists: false,
  passwordLiteral: "'x'",
  roleName: "mcp_ro",
};

const MUTATING = /^\s*(CREATE|ALTER|GRANT|REVOKE)\b/;

/**
 * A provision() harness whose I/O is recorded rather than performed. `events` is
 * one ordered list of both secret reads and statements, so "the guard ran before
 * the first mutation" is a single index comparison.
 */
function harness({ roSecret = { username: "mcp_ro", password: "pw" }, whoami = "duties_admin", exists = false, attrs = {}, config = {} } = {}) {
  const events = [];
  const bool = v => ({ booleanValue: v });
  // Column order follows VERIFY_ATTRIBUTES_SQL. Defaults are a healthy role.
  const A = {
    super: false, createdb: false, createrole: false, login: true,
    repl: false, bypass: false, memberships: 0, dbCreate: false, ...attrs,
  };

  const execute = async (secretArn, sql) => {
    events.push({ kind: "sql", secretArn, sql });
    if (sql.includes("rolsuper")) {
      return {
        records: [[bool(A.super), bool(A.createdb), bool(A.createrole), bool(A.login),
                   bool(A.repl), bool(A.bypass), { longValue: A.memberships }, bool(A.dbCreate)]],
      };
    }
    if (sql.includes("information_schema.table_privileges")) {
      return { records: [[{ stringValue: "public.duties" }, { stringValue: "SELECT" }]] };
    }
    if (sql.includes("has_table_privilege")) {
      return { records: [[{ stringValue: roSecret.username }, bool(false), { longValue: 1 }]] };
    }
    if (sql === "SELECT current_user AS whoami") return { records: [[{ stringValue: whoami }]] };
    if (sql.includes("SELECT 1 FROM pg_roles")) return { records: exists ? [[{ longValue: 1 }]] : [] };
    return { records: [] };
  };

  const deps = {
    config: {
      clusterArn: "arn:cluster",
      masterSecretArn: "arn:master",
      roSecretArn: "arn:ro",
      dbName: "duties",
      masterUsername: "duties_admin",
      roUsername: "mcp_ro",
      ...config,
    },
    execute,
    getSecret: async arn => {
      events.push({ kind: "secret", arn });
      return JSON.stringify(roSecret);
    },
    log: () => {},
  };
  return { deps, events, statements: () => events.filter(e => e.kind === "sql") };
}

test("identityProblem accepts the expected owner", () => {
  assert.equal(identityProblem("duties_admin", "duties_admin"), null);
});

test("identityProblem rejects a non-owner identity", () => {
  const msg = identityProblem("mcp_ro", "duties_admin");
  assert.ok(msg, "expected a problem message");
  // The failure this guards is DUTIES_DB_SECRET_ARN pointing at the read-only
  // secret — which is what a post-cutover mcp/.env supplies under that name.
  assert.match(msg, /authenticates as "mcp_ro"/);
  assert.match(msg, /expected owner "duties_admin"/);
  assert.match(msg, /DUTIES_DB_SECRET_ARN/);
});

test("identityProblem rejects an undefined identity", () => {
  assert.ok(identityProblem(undefined, "duties_admin"));
});

test("targetProblem accepts the contracted role", () => {
  assert.equal(targetProblem("mcp_ro", "mcp_ro", "duties_admin"), null);
});

test("targetProblem refuses the master role, whatever is expected", () => {
  // The dangerous case: provisioning would reset the master password to the
  // read-only secret's value. Stands even if DUTIES_DB_RO_USERNAME says so.
  for (const expected of ["mcp_ro", "duties_admin"]) {
    const msg = targetProblem("duties_admin", expected, "duties_admin");
    assert.ok(msg, `expected a refusal when expected=${expected}`);
    assert.match(msg, /master user/);
  }
});

test("targetProblem refuses a role it was not asked to provision", () => {
  const msg = targetProblem("some_other_role", "mcp_ro", "duties_admin");
  assert.ok(msg);
  assert.match(msg, /provisions "mcp_ro"/);
  assert.match(msg, /DUTIES_DB_RO_USERNAME/);
  // Deliberately overriding the expected name is allowed — that is the
  // mcp_ro_a/mcp_ro_b rotation path, and it takes an explicit variable.
  assert.equal(targetProblem("mcp_ro_b", "mcp_ro_b", "duties_admin"), null);
});

test("buildStatements puts the role statement before any grant", () => {
  const stmts = buildStatements(FIXTURE);
  assert.match(stmts[0].sql, /^CREATE ROLE/);
  const firstGrant = stmts.findIndex(s => /^GRANT/.test(s.sql));
  assert.ok(firstGrant > 0, "expected at least one GRANT after the role statement");
  // Revokes sit between the two, so a stale grant cannot survive a run.
  assert.ok(stmts.slice(1, firstGrant).some(s => /^REVOKE/.test(s.sql)));
});

test("CREATE sets every attribute; ALTER omits the superuser-only three", () => {
  // Postgres refuses SUPERUSER/REPLICATION/BYPASSRLS from a non-superuser on
  // ALTER even when the value given is the one the role already has, and Aurora's
  // master is not a superuser. Naming them on the ALTER branch would make every
  // run after the first fail. See ALTER_ATTRIBUTES.
  const create = buildStatements({ ...FIXTURE, exists: false })[0].sql;
  const alter = buildStatements({ ...FIXTURE, exists: true })[0].sql;

  assert.match(create, /^CREATE ROLE "mcp_ro" WITH /);
  for (const attr of ["NOSUPERUSER", "NOREPLICATION", "NOBYPASSRLS"]) {
    assert.ok(create.includes(attr), `CREATE should set ${attr}`);
  }

  assert.match(alter, /^ALTER ROLE "mcp_ro" WITH /);
  for (const attr of [/SUPERUSER/, /REPLICATION/, /BYPASSRLS/]) {
    assert.doesNotMatch(alter, attr);
  }
  // What it can still enforce, it must.
  for (const attr of ["LOGIN", "NOCREATEDB", "NOCREATEROLE"]) {
    assert.ok(alter.includes(attr), `ALTER should still set ${attr}`);
  }
  assert.match(alter, /PASSWORD 'x'$/);
  assert.equal(ALTER_ATTRIBUTES, "LOGIN NOCREATEDB NOCREATEROLE");
  assert.ok(CREATE_ATTRIBUTES.startsWith(ALTER_ATTRIBUTES.split(" ")[0]));
});

test("database privileges are revoked before CONNECT is granted", () => {
  // Without the revoke, a hand-made `GRANT CREATE ON DATABASE` is detected by
  // verifyCatalog's db_create check on every run and repaired by none of them.
  // The repair itself is shown by the postgres:16 drift probe, not here — a fake
  // client can only pin that the statement is emitted, and in the right place.
  const sqls = buildStatements(FIXTURE).map(s => s.sql);
  const revoke = sqls.findIndex(sql => /^REVOKE ALL ON DATABASE/.test(sql));
  const grant = sqls.findIndex(sql => /^GRANT CONNECT ON DATABASE/.test(sql));
  assert.ok(revoke >= 0, "expected a database-level revoke");
  assert.ok(grant >= 0, "expected CONNECT to be granted back");
  assert.ok(revoke < grant, "the revoke must precede the grant, or it undoes it");
});

test("a SUPERUSER role is reported with no local remedy", async () => {
  // Neither alterable nor droppable by a non-superuser, so offering the
  // drop-and-recreate sequence here would send the operator down a dead end.
  const { deps } = harness({ attrs: { super: true } });
  await assert.rejects(() => provision(deps), err => {
    assert.match(err.message, /is SUPERUSER/);
    assert.match(err.message, /AWS support/);
    assert.doesNotMatch(err.message, /DROP ROLE/);
    return true;
  });
});

test("REPLICATION or BYPASSRLS gets the drop-and-reprovision remedy", async () => {
  for (const attr of [{ repl: true }, { bypass: true }]) {
    const { deps } = harness({ attrs: attr });
    await assert.rejects(() => provision(deps), err => {
      // Quoted, because the operator pastes these verbatim — see the uppercase
      // case below for what bare names would do.
      assert.match(err.message, /DROP ROLE "mcp_ro";/);
      // The REVOKEs are load-bearing: DROP ROLE refuses while privileges remain.
      assert.match(err.message, /REVOKE ALL ON DATABASE "duties" FROM "mcp_ro";/);
      // And the fallback, for grants this script cannot see.
      assert.match(err.message, /another grantor/);
      assert.doesNotMatch(err.message, /AWS support/);
      return true;
    });
  }
});

test("the remedy quotes identifiers, so a mixed-case name is not folded", async () => {
  // isPlainIdentifier permits upper case, and the script creates the role as
  // "Mcp_Ro". An unquoted `DROP ROLE Mcp_Ro` folds to `mcp_ro` — a role this
  // script never created, and one that may exist and be dropped by mistake.
  const { deps } = harness({
    roSecret: { username: "Mcp_Ro", password: "pw" },
    config: { roUsername: "Mcp_Ro", dbName: "Duties" },
    attrs: { repl: true },
  });
  await assert.rejects(() => provision(deps), err => {
    assert.match(err.message, /DROP ROLE "Mcp_Ro";/);
    assert.match(err.message, /REVOKE ALL ON DATABASE "Duties" FROM "Mcp_Ro";/);
    assert.doesNotMatch(err.message, /DROP ROLE Mcp_Ro;/);
    return true;
  });
});

test("buildStatements grants SELECT and nothing wider", () => {
  const grants = buildStatements(FIXTURE)
    .map(s => s.sql)
    .filter(sql => /^GRANT/.test(sql));
  assert.deepEqual(grants, [
    'GRANT CONNECT ON DATABASE "duties" TO "mcp_ro"',
    'GRANT USAGE ON SCHEMA public TO "mcp_ro"',
    'GRANT SELECT ON TABLE "public"."duties" TO "mcp_ro"',
  ]);
});

test("buildLiveVerifySql tests every write privilege, on every table", () => {
  const sql = buildLiveVerifySql(['"public"."duties"', '"public"."other"']);
  // The catalog check cannot see grants made to PUBLIC, so this one has to cover
  // all six table privileges and the column-level form, not just INSERT.
  for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert.ok(sql.includes(priv), `expected ${priv} in the write check`);
  }
  assert.ok(sql.includes("has_any_column_privilege"));
  for (const table of ['"public"."duties"', '"public"."other"']) {
    assert.ok(sql.includes(`has_table_privilege('${table}'`), `no write check for ${table}`);
    assert.ok(sql.includes(`FROM ${table} LIMIT 1`), `no read probe for ${table}`);
  }
});

test("isPlainIdentifier rejects anything that is not a bare identifier", () => {
  assert.ok(isPlainIdentifier("mcp_ro"));
  assert.ok(isPlainIdentifier("_x9"));
  for (const bad of ['mcp_ro"; DROP ROLE x --', "1abc", "", "a-b", "a b", "a.b", undefined]) {
    assert.equal(isPlainIdentifier(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("literal doubles embedded single quotes", () => {
  assert.equal(literal("abc"), "'abc'");
  assert.equal(literal("a'b"), "'a''b'");
  // readRoleSecret refuses passwords containing quotes, so this is the second
  // line of defence rather than the first.
  assert.equal(literal("'; DROP ROLE x --"), "'''; DROP ROLE x --'");
});

test("the target guard refuses before the database is touched at all", async () => {
  const { deps, statements } = harness({ roSecret: { username: "duties_admin", password: "pw" } });
  await assert.rejects(() => provision(deps), ProvisionError);
  assert.deepEqual(statements(), [], "no statement should have reached the Data API");
});

test("an unexpected role name is refused before the database is touched", async () => {
  const { deps, statements } = harness({ roSecret: { username: "some_other_role", password: "pw" } });
  await assert.rejects(() => provision(deps), /provisions "mcp_ro"/);
  assert.deepEqual(statements(), []);
});

test("the identity guard refuses before any mutation", async () => {
  // DUTIES_DB_SECRET_ARN authenticating as something other than the owner.
  const { deps, statements } = harness({ whoami: "mcp_ro" });
  await assert.rejects(() => provision(deps), ProvisionError);
  assert.deepEqual(
    statements().map(e => e.sql),
    ["SELECT current_user AS whoami"],
    "the identity probe should be the only statement issued"
  );
});

test("both guards precede the first mutating statement", async () => {
  const { deps, events } = harness();
  await provision(deps);

  const firstMutation = events.findIndex(e => e.kind === "sql" && MUTATING.test(e.sql));
  assert.ok(firstMutation > 0, "expected mutating statements on a successful run");
  // The secret read carries the target guard; the identity probe is the first
  // statement. Both land before anything is changed.
  assert.equal(events[0].kind, "secret");
  assert.equal(events[1].sql, "SELECT current_user AS whoami");
  assert.ok(firstMutation > 1);

  // Mutations are issued as the master; the live check as the role itself.
  for (const e of events.filter(x => x.kind === "sql" && MUTATING.test(x.sql))) {
    assert.equal(e.secretArn, "arn:master");
  }
  const live = events.findIndex(e => e.kind === "sql" && e.sql.includes("has_table_privilege"));
  const lastMutation = events.map(e => e.kind === "sql" && MUTATING.test(e.sql)).lastIndexOf(true);
  assert.ok(live > lastMutation, "the live check must run after provisioning");
  assert.equal(events[live].secretArn, "arn:ro");
});

test("a role that already exists takes the ALTER branch", async () => {
  const { deps, events } = harness({ exists: true });
  await provision(deps);
  const role = events.find(e => e.kind === "sql" && /ROLE "mcp_ro" WITH/.test(e.sql));
  assert.match(role.sql, /^ALTER ROLE/);
  assert.doesNotMatch(role.sql, /SUPERUSER/);
});

test("DUTIES_DB_RO_USERNAME provisions a deliberately renamed role", async () => {
  const { deps, events } = harness({
    roSecret: { username: "mcp_ro_b", password: "pw" },
    config: { roUsername: "mcp_ro_b" },
  });
  await provision(deps);
  assert.ok(events.some(e => e.kind === "sql" && /^CREATE ROLE "mcp_ro_b"/.test(e.sql)));
});
