/**
 * Tool-layer tests for count_powers_and_duties group_by validation. The JSON-schema enum
 * is not enforced by the MCP runtime, so a malformed group_by must be rejected
 * with a clear message before reaching the adapter (otherwise it resolves to
 * GROUP_BY_COLUMN[undefined] and surfaces as an opaque SQL error).
 */

import { test } from "node:test";
import assert from "node:assert";
import { execute } from "../../tools/count-powers-and-duties.js";
import type { DutiesDbApi } from "../../api/duties-types.js";

test("count_powers_and_duties rejects an invalid group_by before touching the DB", async () => {
  const db = {
    async count() {
      throw new Error("db.count must not be called for an invalid group_by");
    },
  } as unknown as DutiesDbApi;

  const r = await execute({ group_by: "year" } as never, db);
  assert.ok(r.isError, "expected an error response");
  assert.match(r.content[0].text, /group_by must be one of/);
});

test("count_powers_and_duties accepts a valid group_by and calls the DB", async () => {
  let called = false;
  const db = {
    async count(_filters: unknown, groupBy: string | null) {
      called = true;
      return {
        total: 0,
        groupBy,
        groupLimit: 100,
        groupsReturned: 0,
        groupsTruncated: false,
        groups: [],
      };
    },
  } as unknown as DutiesDbApi;

  const r = await execute({ group_by: "enactment_type" }, db);
  assert.ok(!r.isError, `expected success, got: ${r.content?.[0]?.text}`);
  assert.ok(called, "db.count should be called for a valid group_by");
});
