/**
 * Tests for legislation URI parser
 */

import { test } from "node:test";
import assert from "node:assert";
import { parseLegislationUri } from "../../utils/legislation-uri.js";

// Basic document URIs

test("parses full URI with calendar year", () => {
  const result = parseLegislationUri(
    "https://www.legislation.gov.uk/id/ukpga/2020/2"
  );
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

test("parses full URI with regnal year", () => {
  const result = parseLegislationUri(
    "http://www.legislation.gov.uk/id/ukpga/Geo5/4-5/1"
  );
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "Geo5/4-5",
    number: "1",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

test("parses bare path without base URL", () => {
  const result = parseLegislationUri("ukpga/2020/2");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

test("parses URI without /id/ prefix", () => {
  const result = parseLegislationUri(
    "https://www.legislation.gov.uk/ukpga/2020/2"
  );
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

// Version and language

test("parses URI with enacted version", () => {
  const result = parseLegislationUri(
    "http://www.legislation.gov.uk/id/ukpga/Geo5/4-5/1/enacted/english"
  );
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "Geo5/4-5",
    number: "1",
    fragment: undefined,
    version: "enacted",
    language: "english",
  });
});

test("parses URI with date version", () => {
  const result = parseLegislationUri("ukpga/2020/2/2024-01-01");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: "2024-01-01",
    language: undefined,
  });
});

test("parses URI with welsh language only", () => {
  const result = parseLegislationUri("asc/2021/4/welsh");
  assert.deepStrictEqual(result, {
    type: "asc",
    year: "2021",
    number: "4",
    fragment: undefined,
    version: undefined,
    language: "welsh",
  });
});

test("parses URI with made version", () => {
  const result = parseLegislationUri("uksi/2020/1234/made");
  assert.deepStrictEqual(result, {
    type: "uksi",
    year: "2020",
    number: "1234",
    fragment: undefined,
    version: "made",
    language: undefined,
  });
});

test("parses URI with prospective version", () => {
  const result = parseLegislationUri("ukpga/2020/2/prospective");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: "prospective",
    language: undefined,
  });
});

test("parses URI with current version", () => {
  const result = parseLegislationUri("ukpga/2020/2/current");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: "current",
    language: undefined,
  });
});

test("parses URI with fragment and prospective version", () => {
  const result = parseLegislationUri("ukpga/2020/2/section/1/prospective");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: "section/1",
    version: "prospective",
    language: undefined,
  });
});

// Fragments

test("parses URI with section fragment", () => {
  const result = parseLegislationUri("ukpga/2020/2/section/1");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: "section/1",
    version: undefined,
    language: undefined,
  });
});

test("parses URI with nested fragment", () => {
  const result = parseLegislationUri("ukpga/2020/2/part/1/chapter/2");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: "part/1/chapter/2",
    version: undefined,
    language: undefined,
  });
});

test("parses URI with fragment and version", () => {
  const result = parseLegislationUri("ukpga/2020/2/section/1/2024-01-01");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: "section/1",
    version: "2024-01-01",
    language: undefined,
  });
});

test("parses URI with fragment, version, and language", () => {
  const result = parseLegislationUri("ukpga/2020/2/section/1/enacted/welsh");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: "section/1",
    version: "enacted",
    language: "welsh",
  });
});

test("parses regnal year URI with fragment", () => {
  const result = parseLegislationUri(
    "https://www.legislation.gov.uk/id/ukpga/Vict/63/52/section/1"
  );
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "Vict/63",
    number: "52",
    fragment: "section/1",
    version: undefined,
    language: undefined,
  });
});

// Bare id/ prefix

test("parses bare id-prefixed path", () => {
  const result = parseLegislationUri("id/ukpga/2020/2");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

test("parses bare id-prefixed path with regnal year", () => {
  const result = parseLegislationUri("id/ukpga/Vict/63/52");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "Vict/63",
    number: "52",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});

// Malformed inputs

test("returns null for empty string", () => {
  assert.strictEqual(parseLegislationUri(""), null);
});

test("returns null for single segment", () => {
  assert.strictEqual(parseLegislationUri("ukpga"), null);
});

test("returns null for two segments (type + year, no number)", () => {
  assert.strictEqual(parseLegislationUri("ukpga/2020"), null);
});

test("returns null when number segment is not numeric", () => {
  assert.strictEqual(parseLegislationUri("ukpga/2020/abc"), null);
});

test("returns null for regnal year with missing number", () => {
  assert.strictEqual(parseLegislationUri("ukpga/Vict/63"), null);
});

// Trailing slash

test("ignores trailing slash", () => {
  const result = parseLegislationUri("ukpga/2020/2/");
  assert.deepStrictEqual(result, {
    type: "ukpga",
    year: "2020",
    number: "2",
    fragment: undefined,
    version: undefined,
    language: undefined,
  });
});
