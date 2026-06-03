/**
 * Smoke test for the duties DB adapter.
 *
 * Opens data/duties.db (skipping all tests if it isn't present), runs one
 * filter query and one FTS query, and asserts non-empty results.
 *
 * This is a deliberate guard against `node:sqlite` API drift (the module is
 * Stability 1.1 on the LTS lines we target) and against silent FTS-population
 * regressions in the build script.
 */

import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDuties } from "../../api/duties-db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// build/test/api/ -> ../../../data/duties.db
const DB_PATH = join(__dirname, "..", "..", "..", "data", "duties.db");
const SKIP = !existsSync(DB_PATH);

test("opens the duties database", { skip: SKIP }, () => {
  const db = openDuties(DB_PATH);
  assert.ok(db, "openDuties should return a non-null handle");
  db?.close();
});

test("smokeTest: filter and FTS queries both return rows", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const { filterRows, ftsRows } = await db!.smokeTest();
    assert.ok(filterRows > 0, "filter query returned zero rows");
    assert.ok(ftsRows > 0, "FTS query returned zero rows");
  } finally {
    db?.close();
  }
});

test("search by modality and pagination", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const result = await db!.search({ modality: "duty" }, 1, 5);
    assert.ok(result.total > 0);
    assert.strictEqual(result.rows.length, 5);
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.pageSize, 5);
    for (const row of result.rows) {
      assert.strictEqual(row.modality, "duty");
    }
  } finally {
    db?.close();
  }
});

test("FTS search returns matching rows", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const result = await db!.search({ query: "court" }, 1, 3);
    assert.ok(result.total > 0, "expected matches for 'court'");
    assert.ok(result.rows.length > 0);
  } finally {
    db?.close();
  }
});

test("count grouped by modality returns duty and power groups", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const result = await db!.count({}, "modality");
    assert.strictEqual(result.groupBy, "modality");
    const keys = result.groups.map((g) => g.key);
    assert.ok(keys.includes("duty"));
    assert.ok(keys.includes("power"));
  } finally {
    db?.close();
  }
});

test("FTS query tolerates apostrophe and section reference without throwing", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // These would all have crashed with "fts5: syntax error" against a raw
    // MATCH operand. With buildFtsExpression they should execute safely.
    await assert.doesNotReject(() => db!.search({ query: "Children's Act" }, 1, 1));
    await assert.doesNotReject(() => db!.search({ query: "s.117 hospital" }, 1, 1));
    await assert.doesNotReject(() => db!.search({ query: "(licence OR permit) AND grant*" }, 1, 1));
    await assert.doesNotReject(() => db!.search({ query: '"local authority"' }, 1, 1));
  } finally {
    db?.close();
  }
});

test("FTS query that cleans to empty returns the unfiltered total", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const baseline = (await db!.search({}, 1, 1)).total;
    const punct = (await db!.search({ query: "***()" }, 1, 1)).total;
    // When buildFtsExpression returns null, the FTS clause is dropped — the
    // search behaves as if no query was supplied.
    assert.strictEqual(punct, baseline);
  } finally {
    db?.close();
  }
});

test("actor filter treats literal underscore as a non-wildcard", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // No real actor in the dataset contains a literal underscore, so a
    // properly-escaped search must return zero hits. If %_% were unescaped
    // the underscore would match any single character and we'd see most
    // rows in the DB come back.
    const r = await db!.search({ actor: "_" }, 1, 1);
    assert.strictEqual(r.total, 0, `expected 0 rows for literal underscore actor, got ${r.total}`);
  } finally {
    db?.close();
  }
});

test("actor filter still matches plain substrings after escaping", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const r = await db!.search({ actor: "Secretary of State" }, 1, 1);
    assert.ok(r.total > 0);
  } finally {
    db?.close();
  }
});

test("actor filter is inflection-aware: plural phrasing no longer collapses", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // Pre-fix, "local authorities" matched only the ~216 actor/alias names that
    // literally contained the plural substring, while the singular returned
    // tens of thousands — a >100x recall cliff for a trivial phrasing change.
    // The porter-FTS disjunct stems both forms to the same lexeme on the actor
    // term, so the plural now recalls the same core set (~34.8k here).
    //
    // The two totals are NOT identical, and shouldn't be: the substring LIKE
    // disjunct (on the term AND on alias names) is inherently phrasing-specific
    // — that's what lets it catch partial tokens like "authorit". It's additive
    // recall, not the dominant signal any more. So we assert the property that
    // actually broke before: the plural is now a large fraction of the
    // singular, not a sliver of it.
    const singular = (await db!.search({ actor: "local authority" }, 1, 1)).total;
    const plural = (await db!.search({ actor: "local authorities" }, 1, 1)).total;
    assert.ok(plural > 1000, `plural collapsed to ${plural}; expected the stem to recall ~tens of thousands`);
    assert.ok(
      plural > singular * 0.6,
      `plural (${plural}) should be a large fraction of singular (${singular}), not a substring sliver`,
    );
  } finally {
    db?.close();
  }
});

// Structural invariant: count(filters, group_by).total must equal
// count(filters, null).total — i.e., total reports "rows matching the
// filters", independent of how groups are presented.
//
// Both `actor` and `enactment_year` contain NULL values in the dataset,
// which is exactly the case where a future HAVING / COUNT(col) /
// WHERE-col-IS-NOT-NULL change would silently divert the grouped sum
// from the un-grouped total.
test("grouped count total equals ungrouped count total (actor)", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const ungrouped = (await db!.count({}, null)).total;
    const grouped = (await db!.count({}, "actor")).total;
    assert.strictEqual(grouped, ungrouped);
  } finally {
    db?.close();
  }
});

test("grouped count total equals ungrouped count total (enactment_year)", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const ungrouped = (await db!.count({}, null)).total;
    const grouped = (await db!.count({}, "enactment_year")).total;
    assert.strictEqual(grouped, ungrouped);
  } finally {
    db?.close();
  }
});

test("grouped count includes the NULL-key group when one exists", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // `enactment_year` is nullable in the schema; the ingest stores null
    // for years parseYear rejected. Confirm the grouped query actually
    // returns a null-keyed group — this is the row class that future
    // drift (`HAVING`, `COUNT(col)`, `WHERE col IS NOT NULL`) would
    // silently exclude, breaking the invariant the previous test pins.
    //
    // enactment_year has ~274 distinct values; use a generous groupLimit
    // so the NULL group's rank in the top-N is irrelevant to this test.
    const r = await db!.count({}, "enactment_year", { groupLimit: 500 });
    const nullGroup = r.groups.find((g) => g.key === null);
    assert.ok(nullGroup, "expected a null-keyed group for enactment_year");
    assert.ok(nullGroup!.count > 0);
  } finally {
    db?.close();
  }
});

test("grouped count returns top-N + sum equals total when not truncated", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // modality has 2 distinct values, fits comfortably in any groupLimit.
    const r = await db!.count({}, "modality", { groupLimit: 100 });
    assert.strictEqual(r.groupLimit, 100);
    assert.strictEqual(r.groupsTruncated, false);
    assert.strictEqual(r.groupsReturned, r.groups.length);
    const sum = r.groups.reduce((s, g) => s + g.count, 0);
    assert.strictEqual(sum, r.total, "sum of group counts must equal total when not truncated");
  } finally {
    db?.close();
  }
});

test("grouped count truncates with signal + sum is less than total", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // actor has ~98k distinct values; groupLimit 50 is guaranteed to truncate.
    const r = await db!.count({}, "actor", { groupLimit: 50 });
    assert.strictEqual(r.groupLimit, 50);
    assert.strictEqual(r.groups.length, 50);
    assert.strictEqual(r.groupsReturned, 50);
    assert.strictEqual(r.groupsTruncated, true);
    const sum = r.groups.reduce((s, g) => s + g.count, 0);
    assert.ok(sum < r.total, `expected sum(returned) < total, got ${sum} >= ${r.total}`);
  } finally {
    db?.close();
  }
});

test("ungrouped count exposes nullish grouping metadata", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const r = await db!.count({}, null);
    assert.strictEqual(r.groupBy, null);
    assert.strictEqual(r.groupLimit, null);
    assert.strictEqual(r.groupsReturned, 0);
    assert.strictEqual(r.groupsTruncated, false);
    assert.deepStrictEqual(r.groups, []);
  } finally {
    db?.close();
  }
});

test("getForEnactment paginates and bounds the page (regression: unbounded fetch)", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // Find the enactment with the most duties via the grouped count, so we
    // have a case that genuinely spans multiple pages. This is exactly the
    // shape that blew the Data API 1 MB cap before pagination.
    const grouped = await db!.count({}, "enactment_uri", { groupLimit: 1 });
    const top = grouped.groups[0];
    assert.ok(top && typeof top.key === "string", "expected a top enactment_uri group");
    const uri = top.key as string;
    const expectedTotal = top.count;

    const pageSize = 5;
    const r = await db!.getForEnactment(uri, 1, pageSize);

    // total comes from a separate COUNT(*), so it reflects the whole enactment,
    // not just the returned page.
    assert.strictEqual(r.total, expectedTotal, "getForEnactment total should match the grouped count");
    assert.strictEqual(r.page, 1);
    assert.strictEqual(r.pageSize, pageSize);
    assert.ok(r.rows.length <= pageSize, "a page must never exceed pageSize");
    for (const row of r.rows) {
      assert.strictEqual(row.enactmentUri, uri, "every row must belong to the requested enactment");
    }
    if (expectedTotal > pageSize) {
      assert.strictEqual(r.rows.length, pageSize);
      assert.strictEqual(r.morePages, true, "morePages must be true when total exceeds one page");
    }
  } finally {
    db?.close();
  }
});

test("actor filter matches a resolved alias, not just the term (SQLite)", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    // Find a duty whose actor term does NOT contain its (surviving) alias
    // string. Matching on that alias name can then only succeed via the
    // actor_is_alias column — proving alias matching, not term matching.
    let aliasName: string | null = null;
    let enactmentUri: string | null = null;
    let dutyUri: string | null = null;
    for (let page = 1; page <= 30 && !aliasName; page++) {
      const scan = await db!.search({}, page, 200);
      if (scan.rows.length === 0) break;
      for (const row of scan.rows) {
        const a = row.actorAliases[0];
        if (a?.name && row.actor && !row.actor.toLowerCase().includes(a.name.toLowerCase())) {
          aliasName = a.name;
          enactmentUri = row.enactmentUri;
          dutyUri = row.dutyUri;
          break;
        }
      }
    }
    assert.ok(aliasName, "expected a duty whose alias differs from (and isn't contained in) its term");

    // Search by the alias name, scoped to the same enactment so the target row
    // is on the first page. It can only match via actor_is_alias, since the
    // duty's actor term does not contain the alias string.
    const r = await db!.search({ actor: aliasName!, enactmentUri: enactmentUri! }, 1, 200);
    const found = r.rows.some((row) => row.dutyUri === dutyUri);
    assert.ok(found, `alias search for "${aliasName}" did not return the duty matched only via its alias`);
  } finally {
    db?.close();
  }
});

test("enactment_uri groups carry a non-empty title", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const r = await db!.count({}, "enactment_uri", { groupLimit: 5 });
    assert.ok(r.groups.length > 0, "expected at least one enactment_uri group");
    for (const g of r.groups) {
      assert.strictEqual(typeof g.title, "string", `group ${String(g.key)} missing title`);
      assert.ok((g.title as string).length > 0, `group ${String(g.key)} has empty title`);
    }
  } finally {
    db?.close();
  }
});

test("non-enactment_uri groups omit the title field", { skip: SKIP }, async () => {
  const db = openDuties(DB_PATH);
  assert.ok(db);
  try {
    const r = await db!.count({}, "modality");
    assert.ok(r.groups.length > 0);
    for (const g of r.groups) {
      assert.strictEqual(g.title, undefined, "modality groups must not carry a title");
    }
  } finally {
    db?.close();
  }
});
