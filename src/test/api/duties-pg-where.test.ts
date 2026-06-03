/**
 * Unit tests for the Postgres adapter's buildWhere — the filter → SQL/params
 * translation. Pure function, so these run without an Aurora connection.
 *
 * Focus: the actor filter must emit BOTH a substring (ILIKE) disjunct and a
 * stemmed (to_tsvector @@ plainto_tsquery) disjunct, over the term and over
 * resolved alias names — the fix for the singular/plural recall cliff.
 */

import { test } from "node:test";
import assert from "node:assert";
import { buildWhere, buildOrderBy } from "../../api/duties-db-pg.js";

function paramMap(params: ReturnType<typeof buildWhere>["params"]) {
  return Object.fromEntries(params.map((p) => [p.name, p.value?.stringValue]));
}

test("actor filter emits both substring (ILIKE) and stemmed (tsquery) disjuncts", () => {
  const { whereSql, params } = buildWhere({ actor: "local authorities" });

  // 1. substring branch on the term
  assert.match(whereSql, /actor ILIKE :p_actor/);
  // 2. stemmed branch on the actor column
  assert.match(
    whereSql,
    /to_tsvector\('english', coalesce\(actor, ''\)\) @@ plainto_tsquery\('english', :p_actor_raw\)/,
  );
  // 3. stemmed branch also covers resolved alias names
  assert.match(
    whereSql,
    /to_tsvector\('english', a->>'name'\) @@ plainto_tsquery\('english', :p_actor_raw\)/,
  );

  const byName = paramMap(params);
  // escaped substring pattern (LIKE metacharacters escaped, wrapped in %)
  assert.strictEqual(byName.p_actor, "%local authorities%");
  // raw, unwrapped operand for plainto_tsquery
  assert.strictEqual(byName.p_actor_raw, "local authorities");
});

test("actor LIKE metacharacters are escaped, raw operand is left intact", () => {
  const { params } = buildWhere({ actor: "a_b%c" });
  const byName = paramMap(params);
  assert.strictEqual(byName.p_actor, "%a\\_b\\%c%", "underscore and percent must be escaped for ILIKE");
  assert.strictEqual(byName.p_actor_raw, "a_b%c", "plainto_tsquery operand must be the raw string");
});

test("no actor filter emits no actor disjunct", () => {
  const { whereSql } = buildWhere({ modality: "duty" });
  assert.doesNotMatch(whereSql, /p_actor/);
  assert.match(whereSql, /modality = :p_modality/);
});

const PROVISION_ORDER = "enactment_uri, order_key, duty_id";

test("buildOrderBy ranks by relevance when a free-text query is present", () => {
  const orderBy = buildOrderBy({ query: "enter premises inspect", modality: "power" });
  assert.match(orderBy, /^ts_rank\(search_tsv, websearch_to_tsquery\('english', :p_query\)\) DESC/);
  // provision order is retained as a deterministic tiebreaker
  assert.ok(orderBy.endsWith(PROVISION_ORDER), `expected provision-order tiebreaker, got: ${orderBy}`);
});

test("buildOrderBy keeps provision order for filter-only searches", () => {
  assert.strictEqual(buildOrderBy({ actor: "local authority", modality: "duty" }), PROVISION_ORDER);
  assert.strictEqual(buildOrderBy({ enactmentUri: "x" }), PROVISION_ORDER);
  assert.strictEqual(buildOrderBy({}), PROVISION_ORDER);
});

test("buildOrderBy does not rank a content-less query (blank or punctuation-only)", () => {
  // Whitespace-only and punctuation-only queries reduce to an empty tsquery;
  // ts_rank over that is a non-indexable full sort (~14.5s over the whole
  // table), so they must stay on the fast provision-order path. The ORDER BY
  // must not reference :p_query in that case either.
  for (const q of ["   ", "***", "()-/", "!!!", '""']) {
    assert.strictEqual(buildOrderBy({ query: q }), PROVISION_ORDER, `query=${JSON.stringify(q)} should not rank`);
    assert.doesNotMatch(buildOrderBy({ query: q }), /:p_query/);
  }
});

test("buildOrderBy ranks a query that has content amid punctuation", () => {
  // A single alphanumeric token is enough to produce a non-empty tsquery.
  for (const q of ["report!", "s.117", "2024", "café"]) {
    assert.match(buildOrderBy({ query: q }), /^ts_rank\(/, `query=${JSON.stringify(q)} should rank`);
  }
});
