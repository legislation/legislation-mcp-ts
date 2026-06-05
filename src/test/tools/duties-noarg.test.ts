/**
 * Regression tests: the duties tools have all-optional schemas, so a no-argument
 * MCP call (omitted `arguments`) is valid and must not fail. The dispatcher
 * defaults omitted arguments to {} (src/server.ts), and the tool execute()
 * signatures default to {} too, so direct unit calls with `undefined` exercise
 * the same path.
 *
 * Previously: search/count rejected undefined with "tool arguments must be an
 * object", and get_powers_and_duties threw a TypeError on `args.enactment`.
 */

import { test } from "node:test";
import assert from "node:assert";
import { execute as searchExecute } from "../../tools/search-powers-and-duties.js";
import { execute as countExecute } from "../../tools/count-powers-and-duties.js";
import { execute as getExecute } from "../../tools/get-powers-and-duties.js";
import type { DutiesDbApi } from "../../api/duties-types.js";

function searchStub(): DutiesDbApi {
  return {
    async search(_filters: unknown, page: number, pageSize: number) {
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;
}

function countStub(): DutiesDbApi {
  return {
    async count(_filters: unknown, groupBy: string | null) {
      return {
        total: 0,
        groupBy,
        groupLimit: groupBy ? 100 : null,
        groupsReturned: 0,
        groupsTruncated: false,
        groups: [],
      };
    },
  } as unknown as DutiesDbApi;
}

test("search_powers_and_duties with omitted arguments returns a result, not a validation error", async () => {
  const r = await searchExecute(undefined, searchStub());
  assert.ok(!r.isError, `expected success, got: ${r.content?.[0]?.text}`);
});

test("count_powers_and_duties with omitted arguments returns a count, not a validation error", async () => {
  const r = await countExecute(undefined, countStub());
  assert.ok(!r.isError, `expected success, got: ${r.content?.[0]?.text}`);
});

test("get_powers_and_duties with omitted arguments returns graceful guidance, not a TypeError", async () => {
  // Must not touch the DB — it should fail at enactment resolution first.
  const dummy = {} as unknown as DutiesDbApi;
  const r = await getExecute(undefined, dummy);
  assert.ok(r.isError, "expected an error response");
  assert.match(r.content[0].text, /Provide .*type.*year.*number/);
  // Both identifier forms should be named in the guidance.
  assert.match(r.content[0].text, /enactment/);
});

test("get_powers_and_duties builds the enactment URI from type/year/number", async () => {
  let captured: string | null = null;
  const db = {
    async getForEnactment(uri: string, page: number, pageSize: number) {
      captured = uri;
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;

  const r = await getExecute({ type: "ukpga", year: "2010", number: "15" }, db);
  assert.strictEqual(captured, "http://www.legislation.gov.uk/id/ukpga/2010/15");
  assert.ok(!r.isError, `expected a normal (not-found) response, got: ${r.content?.[0]?.text}`);
});

test("get_powers_and_duties resolves a bare `enactment` document identifier", async () => {
  let captured: string | null = null;
  const db = {
    async getForEnactment(uri: string, page: number, pageSize: number) {
      captured = uri;
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;

  await getExecute({ enactment: "ukpga/2010/15" }, db);
  assert.strictEqual(captured, "http://www.legislation.gov.uk/id/ukpga/2010/15");
});

test("get_powers_and_duties passes a regnal `/id/` URI through unchanged", async () => {
  // The case the integer triple would mangle: a pre-1963 regnal Act whose URI
  // year-segment (Cha2/18-19) is not the calendar year. Copying enactmentUri
  // straight through must reach the DB verbatim — no segment reinterpretation.
  let captured: string | null = null;
  const db = {
    async getForEnactment(uri: string, page: number, pageSize: number) {
      captured = uri;
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;

  const uri = "http://www.legislation.gov.uk/id/aep/Cha2/18-19/11";
  await getExecute({ enactment: uri }, db);
  assert.strictEqual(captured, uri);
});

test("get_powers_and_duties: `enactment` takes precedence over the triple", async () => {
  let captured: string | null = null;
  const db = {
    async getForEnactment(uri: string, page: number, pageSize: number) {
      captured = uri;
      return { total: 0, page, pageSize, morePages: false, rows: [] };
    },
  } as unknown as DutiesDbApi;

  await getExecute(
    { enactment: "uksi/2020/5", type: "ukpga", year: "2010", number: "15" },
    db,
  );
  assert.strictEqual(captured, "http://www.legislation.gov.uk/id/uksi/2020/5");
});

const sampleRow = (modality: "duty" | "power", action: string) => ({
  dutyId: 1,
  dutyUri: "u",
  enactmentUri: "http://www.legislation.gov.uk/id/ukpga/2020/1",
  enactmentTitle: "Example Act 2020",
  enactmentYear: 2020,
  enactmentType: "ukpga",
  enactmentNum: "1",
  sectionUri: null,
  subsection: null,
  actor: "A",
  actorDefinition: null,
  actorAliases: [],
  modality,
  action,
  condition: null,
  inference: "explicit" as const,
  priority: "primary" as const,
  extractedAsOf: "2026-01-01",
});

test("get_powers_and_duties returns a modalityBreakdown and a `results` array (no modality filter)", async () => {
  let countEnactmentUri: string | undefined;
  const db = {
    async getForEnactment(_uri: string, page: number, pageSize: number) {
      return {
        total: 2,
        page,
        pageSize,
        morePages: false,
        rows: [sampleRow("duty", "do x"), sampleRow("power", "may y")],
      };
    },
    async count(filters: { enactmentUri?: string }, groupBy: string | null) {
      countEnactmentUri = filters.enactmentUri;
      return {
        total: 2,
        groupBy,
        groupLimit: 100,
        groupsReturned: 2,
        groupsTruncated: false,
        groups: [
          { key: "duty", count: 5 },
          { key: "power", count: 3 },
        ],
      };
    },
  } as unknown as DutiesDbApi;

  const r = await getExecute({ enactment: "ukpga/2020/1" }, db);
  assert.ok(!r.isError, `expected success, got: ${r.content?.[0]?.text}`);
  const body = JSON.parse(r.content[0].text);
  assert.deepStrictEqual(body.modalityBreakdown, { duty: 5, power: 3 });
  assert.ok(Array.isArray(body.results), "response should use the renamed `results` array");
  assert.strictEqual(body.results.length, 2);
  assert.strictEqual(
    countEnactmentUri,
    "http://www.legislation.gov.uk/id/ukpga/2020/1",
    "breakdown must be scoped to the same enactment",
  );
});

test("get_powers_and_duties threads the modality filter through and skips the breakdown query", async () => {
  let countCalled = false;
  const db = {
    async getForEnactment(
      uri: string,
      page: number,
      pageSize: number,
      filters: { modality?: string },
    ) {
      assert.strictEqual(filters?.modality, "duty", "modality filter must reach the adapter");
      return { total: 1, page, pageSize, morePages: false, rows: [{ ...sampleRow("duty", "do x"), enactmentUri: uri }] };
    },
    async count() {
      countCalled = true;
      throw new Error("count must not run when modality is pinned");
    },
  } as unknown as DutiesDbApi;

  const r = await getExecute({ enactment: "ukpga/2020/1", modality: "duty" }, db);
  assert.ok(!r.isError, `expected success, got: ${r.content?.[0]?.text}`);
  const body = JSON.parse(r.content[0].text);
  assert.strictEqual(body.modalityBreakdown, undefined, "no breakdown when modality is pinned");
  assert.strictEqual(countCalled, false, "the extra grouped count must be skipped");
});

test("get_powers_and_duties rejects an invalid modality before resolving", async () => {
  const db = {} as unknown as DutiesDbApi;
  const r = await getExecute({ enactment: "ukpga/2020/1", modality: "obligation" } as never, db);
  assert.ok(r.isError, "expected a validation error");
  assert.match(r.content[0].text, /Invalid input.*modality/);
});
