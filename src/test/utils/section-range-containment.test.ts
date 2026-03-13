/**
 * Tests for section range containment
 *
 * Ported from SectionRangeContainmentTest.java in the lgu2 API project.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { contains, compare, compareSuffix } from '../../utils/section-range-containment.js';

/* contains: sibling ranges at the same structural depth */

test('numeric subsections: section-249-1 to section-249-3', () => {
  const start = 'section-249-1', end = 'section-249-3';
  assert.ok(contains(start, end, 'section-249-1'));   // start boundary
  assert.ok(contains(start, end, 'section-249-2'));   // middle
  assert.ok(contains(start, end, 'section-249-3'));   // end boundary
  assert.ok(!contains(start, end, 'section-249-4'));  // after
  assert.ok(!contains(start, end, 'section-248-5'));  // different parent
});

test('schedule paragraphs: schedule-14-paragraph-1 to schedule-14-paragraph-3', () => {
  const start = 'schedule-14-paragraph-1', end = 'schedule-14-paragraph-3';
  assert.ok(contains(start, end, 'schedule-14-paragraph-1'));
  assert.ok(contains(start, end, 'schedule-14-paragraph-2'));
  assert.ok(contains(start, end, 'schedule-14-paragraph-3'));
  assert.ok(!contains(start, end, 'schedule-14-paragraph-4'));
  assert.ok(!contains(start, end, 'schedule-13-paragraph-2'));
});

test('alphabetic sub-paragraphs: section-395-13-bc to section-395-13-be', () => {
  const start = 'section-395-13-bc', end = 'section-395-13-be';
  assert.ok(contains(start, end, 'section-395-13-bc'));
  assert.ok(contains(start, end, 'section-395-13-bd'));
  assert.ok(contains(start, end, 'section-395-13-be'));
  assert.ok(!contains(start, end, 'section-395-13-bb'));
  assert.ok(!contains(start, end, 'section-395-13-bf'));
});

test('numeric+alpha suffixes: section-1A to section-1C', () => {
  const start = 'section-1A', end = 'section-1C';
  assert.ok(contains(start, end, 'section-1A'));
  assert.ok(contains(start, end, 'section-1B'));
  assert.ok(contains(start, end, 'section-1C'));
  assert.ok(!contains(start, end, 'section-1D'));
  assert.ok(!contains(start, end, 'section-2'));
});

test('single letter sub-paragraphs: section-1-a to section-1-c', () => {
  const start = 'section-1-a', end = 'section-1-c';
  assert.ok(contains(start, end, 'section-1-a'));
  assert.ok(contains(start, end, 'section-1-b'));
  assert.ok(contains(start, end, 'section-1-c'));
  assert.ok(!contains(start, end, 'section-1-d'));
});

test('roman numeral sub-paragraphs: section-1-a-i to section-1-a-iv', () => {
  const start = 'section-1-a-i', end = 'section-1-a-iv';
  assert.ok(contains(start, end, 'section-1-a-i'));
  assert.ok(contains(start, end, 'section-1-a-ii'));
  assert.ok(contains(start, end, 'section-1-a-iii'));
  assert.ok(contains(start, end, 'section-1-a-iv'));
  assert.ok(!contains(start, end, 'section-1-a-v'));
});

test('roman numerals crossing alphabetic boundary: ix to xi', () => {
  assert.ok(contains('section-1-a-ix', 'section-1-a-xi', 'section-1-a-x'));
});

test('single-character roman compared against multi-character: v to ix', () => {
  const start = 'section-1-a-v', end = 'section-1-a-ix';
  assert.ok(contains(start, end, 'section-1-a-vi'));
  assert.ok(contains(start, end, 'section-1-a-viii'));
  assert.ok(!contains(start, end, 'section-1-a-x'));
});

test('single-letter roman chars treated as alphabetic paragraph labels', () => {
  assert.ok(!contains('section-1-l', 'section-1-m', 'section-1-c'));
  assert.ok(contains('section-1-c', 'section-1-i', 'section-1-d'));
});

/* contains: hierarchical containment (id deeper than range) */

test('id is a child of a provision within the range', () => {
  const start = 'part-1', end = 'part-3';
  assert.ok(contains(start, end, 'part-2-section-5'));
  assert.ok(contains(start, end, 'part-1-section-1'));
  assert.ok(contains(start, end, 'part-3-section-9'));
  assert.ok(!contains(start, end, 'part-4-section-1'));
});

test('id is a deeper descendant within the range', () => {
  assert.ok(contains('section-1', 'section-3', 'section-2-a-i'));
});

/* contains: ancestor containment (id shallower than range) */

test('id is a parent of the range boundaries', () => {
  assert.ok(contains('section-1-a', 'section-1-c', 'section-1'));
});

test('id is a grandparent of the range boundaries', () => {
  assert.ok(contains('section-1-a-i', 'section-1-a-iii', 'section-1'));
  assert.ok(contains('section-1-a-i', 'section-1-a-iii', 'section-1-a'));
});

test('id is a parent only if all prefix tokens match', () => {
  assert.ok(!contains('section-1-a', 'section-1-c', 'section-2'));
});

/* contains: edge cases */

test('different structural keywords are not confused', () => {
  assert.ok(!contains('part-1', 'part-3', 'section-5'));
});

test('double hyphens in IDs are handled', () => {
  assert.ok(contains('section--1', 'section--3', 'section--2'));
});

test('numeric ordering is not lexicographic', () => {
  assert.ok(contains('section-2', 'section-10', 'section-5'));
  assert.ok(!contains('section-2', 'section-10', 'section-11'));
});

/* compare: ordering of provision identifiers */

const compareTests: [string, string, number][] = [
  // identical
  ['section-1', 'section-1', 0],
  // numeric ordering
  ['section-1', 'section-2', -1],
  ['section-10', 'section-2', 1],
  // numeric + alpha suffix
  ['section-1', 'section-1A', -1],
  ['section-1A', 'section-1B', -1],
  // alphabetic tokens
  ['section-1-a', 'section-1-b', -1],
  ['section-1-bc', 'section-1-be', -1],
  // roman numerals
  ['section-1-a-ii', 'section-1-a-iv', -1],
  ['section-1-a-ix', 'section-1-a-xi', -1],
  // shorter ID before longer with same prefix
  ['part-2', 'part-2-section-1', -1],
  // different keyword at same position
  ['chapter-1', 'section-1', -1],
];

for (const [id1, id2, expected] of compareTests) {
  test(`compare: ${id1} vs ${id2} => ${expected}`, () => {
    assert.strictEqual(Math.sign(compare(id1, id2)), expected);
  });
}

/* compare: full identifier examples from section 6.4 guidance */

const guidanceTests: [string, string, number][] = [
  // beginning of a series: ZA1, A1, B1, ... then 1
  ['schedule-ZA1', 'schedule-A1', -1],
  ['schedule-A1', 'schedule-B1', -1],
  ['schedule-B1', 'schedule-1', -1],
  // inserted between existing provisions
  ['section-1', 'section-1ZA', -1],
  ['section-1ZA', 'section-1A', -1],
  ['section-1A', 'section-1AZA', -1],
  ['section-1AZA', 'section-1AA', -1],
  // do not generate a lower level unless needed
  ['section-1AA', 'section-1AB', -1],
  ['section-1AB', 'section-1B', -1],
  ['section-1AA', 'section-1AAA', -1],
  ['section-1AAA', 'section-1AB', -1],
  // lettered paragraphs
  ['section-1-zza', 'section-1-za', -1],
  ['section-1-za', 'section-1-a', -1],
  ['section-1-a', 'section-1-aza', -1],
  ['section-1-aza', 'section-1-aa', -1],
  ['section-1-aa', 'section-1-ab', -1],
  ['section-1-ab', 'section-1-b', -1],
  // roman numeral equivalents
  ['section-1-a-i', 'section-1-a-ia', -1],
  ['section-1-a-ia', 'section-1-a-ib', -1],
  ['section-1-a-ib', 'section-1-a-ii', -1],
  // after Z use Z1, Z2, Z3, ...
  ['section-360Z', 'section-360Z1', -1],
  ['section-360Z1', 'section-360Z2', -1],
  ['section-360Z2', 'section-360Z10', -1],
];

for (const [id1, id2, expected] of guidanceTests) {
  test(`guidance: ${id1} vs ${id2} => ${expected}`, () => {
    assert.strictEqual(Math.sign(compare(id1, id2)), expected);
  });
}

/* compareSuffix: inserted provision ordering (section 6.4) */

const suffixTests: [string, string, number][] = [
  // basic: empty < A < B < ... < Z
  ['', 'A', -1],
  ['A', 'B', -1],
  ['Y', 'Z', -1],
  // Z-prefix: ZA sorts before A
  ['ZA', 'A', -1],
  ['ZB', 'A', -1],
  ['ZZ', 'A', -1],
  // recursive Z-prefix: ZZA before ZA before A
  ['ZZA', 'ZA', -1],
  ['ZZA', 'A', -1],
  // sub-insertions: between A and B come AA, AB, ...
  ['A', 'AA', -1],
  ['AA', 'AB', -1],
  ['AZ', 'B', -1],
  // Z-prefix at deeper level: AZA before AA
  ['AZA', 'AA', -1],
  ['AZB', 'AA', -1],
  // Z at end is the letter Z (sorts last among A-Z)
  ['Y', 'Z', -1],
  ['Z', 'ZA', 1],  // Z (letter) > ZA (prefix)
  // case insensitive
  ['za', 'A', -1],
  ['a', 'B', -1],
  // numeric sub-suffixes
  ['Z9', 'Z10', -1],
  ['Z2', 'Z10', -1],
  ['A5', 'A10', -1],
];

for (const [s1, s2, expected] of suffixTests) {
  test(`compareSuffix: ${JSON.stringify(s1)} vs ${JSON.stringify(s2)} => ${expected}`, () => {
    assert.strictEqual(Math.sign(compareSuffix(s1, s2)), expected);
  });
}

/* contains: insertion ordering scenarios */

test('contains with beginning-of-series whole provisions: ZA1 to 1', () => {
  assert.ok(contains('schedule-ZA1', 'schedule-1', 'schedule-ZA1'));
  assert.ok(contains('schedule-ZA1', 'schedule-1', 'schedule-A1'));
  assert.ok(contains('schedule-ZA1', 'schedule-1', 'schedule-B1'));
  assert.ok(contains('schedule-ZA1', 'schedule-1', 'schedule-1'));
  assert.ok(!contains('schedule-ZA1', 'schedule-1', 'schedule-2'));
});

test('contains with inserted provisions: section-1ZA to section-1B', () => {
  assert.ok(contains('section-1ZA', 'section-1B', 'section-1A'));
  assert.ok(contains('section-1ZA', 'section-1B', 'section-1AA'));
  assert.ok(!contains('section-1ZA', 'section-1B', 'section-1C'));
});

test('contains with inserted paragraphs before paragraph (a)', () => {
  assert.ok(contains('section-1-zza', 'section-1-a', 'section-1-za'));
  assert.ok(!contains('section-1-zza', 'section-1-a', 'section-1-aa'));
});

test('contains with inserted paragraphs: (aza) to (b)', () => {
  assert.ok(contains('section-1-aza', 'section-1-b', 'section-1-aa'));
  assert.ok(contains('section-1-aza', 'section-1-b', 'section-1-ab'));
  assert.ok(!contains('section-1-aza', 'section-1-b', 'section-1-a'));
  assert.ok(!contains('section-1-aza', 'section-1-b', 'section-1-c'));
});

test('contains with inserted roman sub-paragraphs: (i) to (ii)', () => {
  assert.ok(contains('section-1-a-i', 'section-1-a-ii', 'section-1-a-ia'));
  assert.ok(contains('section-1-a-i', 'section-1-a-ii', 'section-1-a-ib'));
  assert.ok(!contains('section-1-a-i', 'section-1-a-ii', 'section-1-a-iii'));
});

test('numeric sub-suffixes: section-360Z1 to section-360Z10', () => {
  assert.ok(contains('section-360Z1', 'section-360Z10', 'section-360Z2'));
  assert.ok(contains('section-360Z1', 'section-360Z10', 'section-360Z9'));
  assert.ok(!contains('section-360Z1', 'section-360Z10', 'section-360Z11'));
});

test('1Z sorts after 1AA (Z is 26th letter, not a prefix)', () => {
  assert.ok(!contains('section-1AA', 'section-1AZ', 'section-1Z'));
  assert.ok(contains('section-1AA', 'section-1Z', 'section-1B'));
});
