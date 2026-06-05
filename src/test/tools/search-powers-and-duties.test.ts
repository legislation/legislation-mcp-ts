/**
 * Tool-layer tests for search_powers_and_duties pagination clamping.
 *
 * Uses a stub DutiesDb that captures the (filters, page, pageSize) it
 * receives, so we can assert the clamp without needing the real database.
 */

import { test } from "node:test";
import assert from "node:assert";
import { execute } from "../../tools/search-powers-and-duties.js";
import type { DutiesDbApi, SearchFilters, SearchResult } from "../../api/duties-types.js";

interface CapturedCall {
  filters: SearchFilters;
  page: number;
  pageSize: number;
}

function makeStub(): { db: DutiesDbApi; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const stub = {
    async search(filters: SearchFilters, page: number, pageSize: number): Promise<SearchResult> {
      calls.push({ filters, page, pageSize });
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;
  return { db: stub, calls };
}

test("page=0 is clamped to 1", async () => {
  const { db, calls } = makeStub();
  await execute({ page: 0 }, db);
  assert.strictEqual(calls[0]?.page, 1);
});

test("negative page is clamped to 1", async () => {
  const { db, calls } = makeStub();
  await execute({ page: -5 }, db);
  assert.strictEqual(calls[0]?.page, 1);
});

test("fractional page is floored", async () => {
  const { db, calls } = makeStub();
  await execute({ page: 2.7 }, db);
  assert.strictEqual(calls[0]?.page, 2);
});

test("missing page defaults to 1", async () => {
  const { db, calls } = makeStub();
  await execute({}, db);
  assert.strictEqual(calls[0]?.page, 1);
});

test("page_size above max is clamped to 100", async () => {
  const { db, calls } = makeStub();
  await execute({ page_size: 1_000_000 }, db);
  assert.strictEqual(calls[0]?.pageSize, 100);
});

test("page_size below 1 is clamped to 1", async () => {
  const { db, calls } = makeStub();
  await execute({ page_size: 0 }, db);
  assert.strictEqual(calls[0]?.pageSize, 1);
});

test("missing page_size defaults to 25", async () => {
  const { db, calls } = makeStub();
  await execute({}, db);
  assert.strictEqual(calls[0]?.pageSize, 25);
});

test("NaN page falls back to default", async () => {
  const { db, calls } = makeStub();
  await execute({ page: NaN as unknown as number }, db);
  assert.strictEqual(calls[0]?.page, 1);
});

test("oversized query is rejected before reaching the DB", async () => {
  const { db, calls } = makeStub();
  const result = await execute({ query: "x".repeat(501) }, db);
  assert.strictEqual(calls.length, 0, "DB should not have been called");
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0]!.text as string, /Invalid input.*query is too long/);
});

test("oversized enactment_type array is rejected before reaching the DB", async () => {
  const { db, calls } = makeStub();
  const types = Array.from({ length: 100 }, (_, i) => `t${i}`);
  const result = await execute({ enactment_type: types }, db);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0]!.text as string, /enactment_type has too many values/);
});

// Reviewer-flagged type-confusion scenarios — pre-fix these crashed with
// generic TypeErrors inside the DB layer; now they fail fast with a
// human-readable message.

test("actor as number is rejected with a clear message", async () => {
  const { db, calls } = makeStub();
  const result = await execute({ actor: 123 as unknown as string }, db);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0]!.text as string, /actor must be a string/);
});

test("enactment_type as string (not array) is rejected with a clear message", async () => {
  const { db, calls } = makeStub();
  const result = await execute(
    { enactment_type: "ukpga" as unknown as string[] },
    db,
  );
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0]!.text as string, /enactment_type must be an array/);
});

test("query as number is rejected with a clear message", async () => {
  const { db, calls } = makeStub();
  const result = await execute({ query: 123 as unknown as string }, db);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0]!.text as string, /query must be a string/);
});

test("enactment (short triple) is canonicalised to the stored /id/ URI", async () => {
  const { db, calls } = makeStub();
  await execute({ enactment: "ukpga/2010/15" }, db);
  assert.strictEqual(
    calls[0]?.filters.enactmentUri,
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("enactment as a live URL is canonicalised to the stored /id/ URI", async () => {
  const { db, calls } = makeStub();
  await execute({ enactment: "https://www.legislation.gov.uk/ukpga/2010/15" }, db);
  assert.strictEqual(
    calls[0]?.filters.enactmentUri,
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});
