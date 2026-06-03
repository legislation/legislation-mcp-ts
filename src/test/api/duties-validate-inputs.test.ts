/**
 * Unit tests for validateDutyFilters — fast-fail bounds on user-supplied
 * arrays and strings, defending against abuse and gratuitous SQLite work.
 */

import { test } from "node:test";
import assert from "node:assert";
import { validateDutyFilters } from "../../api/duties-db.js";

test("passes for empty input", () => {
  assert.strictEqual(validateDutyFilters({}), null);
});

test("passes for normal-sized inputs", () => {
  assert.strictEqual(
    validateDutyFilters({
      query: "Secretary of State",
      actor: "local authority",
      enactment: "ukpga/2010/15",
      enactment_type: ["ukpga", "uksi", "asp"],
    }),
    null,
  );
});

test("rejects oversized query string", () => {
  const err = validateDutyFilters({ query: "x".repeat(501) });
  assert.ok(err);
  assert.match(err!, /query is too long/);
});

test("rejects oversized actor string", () => {
  const err = validateDutyFilters({ actor: "x".repeat(501) });
  assert.ok(err);
  assert.match(err!, /actor is too long/);
});

test("rejects oversized enactment string", () => {
  const err = validateDutyFilters({ enactment: "x".repeat(501) });
  assert.ok(err);
  assert.match(err!, /enactment is too long/);
});

test("rejects enactment_type array longer than 32", () => {
  const types = Array.from({ length: 33 }, (_, i) => `t${i}`);
  const err = validateDutyFilters({ enactment_type: types });
  assert.ok(err);
  assert.match(err!, /enactment_type has too many values/);
});

test("accepts enactment_type array at the limit (32)", () => {
  const types = Array.from({ length: 32 }, (_, i) => `t${i}`);
  assert.strictEqual(validateDutyFilters({ enactment_type: types }), null);
});

test("accepts strings exactly at the 500-char limit", () => {
  assert.strictEqual(validateDutyFilters({ query: "x".repeat(500) }), null);
  assert.strictEqual(validateDutyFilters({ actor: "x".repeat(500) }), null);
  assert.strictEqual(validateDutyFilters({ enactment: "x".repeat(500) }), null);
});

test("first error wins (query checked before actor)", () => {
  const err = validateDutyFilters({
    query: "x".repeat(501),
    actor: "y".repeat(501),
  });
  assert.match(err!, /query is too long/);
});

// --- runtime-type checks (the MCP boundary erases TS types) ---

test("rejects non-object input", () => {
  assert.match(validateDutyFilters(null)!, /must be an object/);
  assert.match(validateDutyFilters(42)!, /must be an object/);
  assert.match(validateDutyFilters("hello")!, /must be an object/);
  assert.match(validateDutyFilters(undefined)!, /must be an object/);
});

test("rejects non-string query", () => {
  assert.match(validateDutyFilters({ query: 123 })!, /query must be a string/);
  assert.match(validateDutyFilters({ query: [] })!, /query must be a string/);
});

test("rejects non-string actor", () => {
  assert.match(validateDutyFilters({ actor: 123 })!, /actor must be a string/);
});

test("rejects non-string enactment", () => {
  assert.match(
    validateDutyFilters({ enactment: { url: "http://..." } })!,
    /enactment must be a string/,
  );
});

test("rejects non-array enactment_type", () => {
  assert.match(
    validateDutyFilters({ enactment_type: "ukpga" })!,
    /enactment_type must be an array/,
  );
});

test("rejects enactment_type items that are not strings", () => {
  assert.match(
    validateDutyFilters({ enactment_type: ["ukpga", 42] })!,
    /enactment_type items must be strings/,
  );
});

test("rejects empty-string enactment_type items", () => {
  assert.match(
    validateDutyFilters({ enactment_type: ["ukpga", ""] })!,
    /enactment_type items must be non-empty/,
  );
});

test("rejects oversized enactment_type items", () => {
  const tooLong = "x".repeat(65);
  assert.match(
    validateDutyFilters({ enactment_type: [tooLong] })!,
    /enactment_type item is too long/,
  );
});

test("rejects non-numeric year_from / year_to", () => {
  assert.match(
    validateDutyFilters({ year_from: "2010" })!,
    /year_from must be a finite number/,
  );
  assert.match(
    validateDutyFilters({ year_to: NaN })!,
    /year_to must be a finite number/,
  );
  assert.match(
    validateDutyFilters({ year_from: Infinity })!,
    /year_from must be a finite number/,
  );
});

test("accepts valid numeric year bounds", () => {
  assert.strictEqual(validateDutyFilters({ year_from: 2010, year_to: 2024 }), null);
});

test("rejects invalid modality / priority / inference", () => {
  assert.match(validateDutyFilters({ modality: "obligation" })!, /modality must be one of/);
  assert.match(validateDutyFilters({ modality: 42 })!, /modality must be one of/);
  assert.match(validateDutyFilters({ priority: "tertiary" })!, /priority must be one of/);
  assert.match(validateDutyFilters({ inference: "guessed" })!, /inference must be one of/);
});

test("accepts valid modality / priority / inference values", () => {
  assert.strictEqual(
    validateDutyFilters({ modality: "duty", priority: "primary", inference: "explicit" }),
    null,
  );
  assert.strictEqual(
    validateDutyFilters({ modality: "power", priority: "secondary", inference: "implicit" }),
    null,
  );
});
