/**
 * Unit tests for normalizeEnactmentUri — keeps the DB lookup from missing
 * rows when a user pastes https:// or trailing-slash variants.
 */

import { test } from "node:test";
import assert from "node:assert";
import { normalizeEnactmentUri } from "../../api/duties-types.js";

test("https → http", () => {
  assert.strictEqual(
    normalizeEnactmentUri("https://www.legislation.gov.uk/id/ukpga/2010/15"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("trailing slash stripped", () => {
  assert.strictEqual(
    normalizeEnactmentUri("http://www.legislation.gov.uk/id/ukpga/2010/15/"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("multiple trailing slashes stripped", () => {
  assert.strictEqual(
    normalizeEnactmentUri("http://www.legislation.gov.uk/id/ukpga/2010/15///"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("https + trailing slash both fixed", () => {
  assert.strictEqual(
    normalizeEnactmentUri("https://www.legislation.gov.uk/id/ukpga/2010/15/"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("mixed-case scheme normalised", () => {
  assert.strictEqual(
    normalizeEnactmentUri("HTTPS://www.legislation.gov.uk/id/ukpga/2010/15"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
  assert.strictEqual(
    normalizeEnactmentUri("Http://www.legislation.gov.uk/id/ukpga/2010/15"),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("surrounding whitespace trimmed", () => {
  assert.strictEqual(
    normalizeEnactmentUri("  http://www.legislation.gov.uk/id/ukpga/2010/15  "),
    "http://www.legislation.gov.uk/id/ukpga/2010/15",
  );
});

test("already-canonical input passes through unchanged", () => {
  const canonical = "http://www.legislation.gov.uk/id/ukpga/2010/15";
  assert.strictEqual(normalizeEnactmentUri(canonical), canonical);
});

// --- forgiving forms: any document identifier converges on the stored URI ---

const CANONICAL = "http://www.legislation.gov.uk/id/ukpga/2010/15";

test("bare document identifier (the advertised triple) gets the /id/ prefix", () => {
  assert.strictEqual(normalizeEnactmentUri("ukpga/2010/15"), CANONICAL);
});

test("bare identifier with trailing slash", () => {
  assert.strictEqual(normalizeEnactmentUri("ukpga/2010/15/"), CANONICAL);
});

test("identifier with a leading id/ segment", () => {
  assert.strictEqual(normalizeEnactmentUri("id/ukpga/2010/15"), CANONICAL);
});

test("live document URL (no /id/) gets /id/ inserted", () => {
  assert.strictEqual(
    normalizeEnactmentUri("https://www.legislation.gov.uk/ukpga/2010/15"),
    CANONICAL,
  );
});

test("bare domain (no www) gets www added", () => {
  assert.strictEqual(
    normalizeEnactmentUri("http://legislation.gov.uk/id/ukpga/2010/15"),
    CANONICAL,
  );
});

test("live URL on the bare domain gets both www and /id/", () => {
  assert.strictEqual(
    normalizeEnactmentUri("https://legislation.gov.uk/ukpga/2010/15"),
    CANONICAL,
  );
});

test("regnal-year bare identifier is prefixed without being parsed", () => {
  assert.strictEqual(
    normalizeEnactmentUri("aep/Ann/6/11"),
    "http://www.legislation.gov.uk/id/aep/Ann/6/11",
  );
});
