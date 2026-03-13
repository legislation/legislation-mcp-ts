/**
 * Determines whether a provision element ID falls within a range defined by
 * start and end element IDs.
 *
 * Element IDs are hyphen-separated tokens such as "section-1",
 * "schedule-14-paragraph-3", or "section-395-13-bc".
 *
 * Handles hierarchical containment in both directions:
 * - "part-2-section-5" is within range "part-1" to "part-3" (descendant)
 * - "section-1" contains range "section-1-a" to "section-1-c" (ancestor)
 *
 * Token comparison uses proper numeric, alphabetic (with Z-prefix insertion
 * ordering per SI Practice s.6.4), and roman numeral ordering.
 *
 * Ported from SectionRangeContainment.java in the lgu2 API project.
 */

import { parse as parseRoman } from './roman.js';

/**
 * Tests whether `id` falls within the range [`start`, `end`] (inclusive).
 */
export function contains(start: string, end: string, id: string): boolean {
  const startTokens = tokenize(start);
  const endTokens = tokenize(end);
  let idTokens = tokenize(id);

  // Strip common prefix (tokens matching in all three)
  let i = 0;
  while (
    i < startTokens.length && i < endTokens.length && i < idTokens.length
    && startTokens[i].toLowerCase() === endTokens[i].toLowerCase()
    && startTokens[i].toLowerCase() === idTokens[i].toLowerCase()
  ) {
    i++;
  }

  // If id is exhausted, it's an ancestor of the range — it contains it
  if (i >= idTokens.length) return true;

  // Truncate id to the depth of the range boundaries, so that
  // descendants of a boundary are treated as being at that boundary
  const rangeDepth = Math.max(startTokens.length, endTokens.length);
  if (idTokens.length > rangeDepth)
    idTokens = idTokens.slice(0, rangeDepth);

  // Check start <= id <= end using the remaining tokens
  return compareFrom(startTokens, idTokens, i) <= 0
    && compareFrom(idTokens, endTokens, i) <= 0;
}

/**
 * Compares two provision identifiers. A shorter ID sorts before a longer one
 * when all leading tokens match (e.g. "part-2" < "part-2-section-5").
 */
export function compare(id1: string, id2: string): number {
  return compareFrom(tokenize(id1), tokenize(id2), 0);
}

function compareFrom(a: string[], b: string[], from: number): number {
  const len = Math.max(a.length, b.length);
  for (let i = from; i < len; i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const cmp = compareTokens(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function tokenize(id: string): string[] {
  return id.replace('--', '-').split('-');
}

/* token comparison */

// optional alpha prefix + digits + optional alphanumeric suffix
// e.g. "1", "1A", "10ZA", "360Z10", "ZA1", "A1", "B1"
const PROVISION_NUMBER = /^([a-zA-Z]*)(\d+)([a-zA-Z0-9]*)$/;
const ROMAN_CHARS = /^[ivxlcdm]+$/i;
const ALPHA_ONLY = /^[a-zA-Z]+$/;

function compareTokens(a: string, b: string): number {
  if (a.toLowerCase() === b.toLowerCase()) return 0;

  // provision numbers: prefix < bare < suffix (ZA1 < A1 < 1 < 1ZA < 1A)
  const ma = a.match(PROVISION_NUMBER);
  const mb = b.match(PROVISION_NUMBER);
  if (ma && mb) {
    const cmp = parseInt(ma[2], 10) - parseInt(mb[2], 10);
    if (cmp !== 0) return cmp;
    // category: has-prefix (0) < bare (1) < has-suffix (2)
    const catA = ma[1] ? 0 : ma[3] ? 2 : 1;
    const catB = mb[1] ? 0 : mb[3] ? 2 : 1;
    if (catA !== catB) return catA - catB;
    if (catA === 0) return compareSuffix(ma[1], mb[1]);
    if (catA === 2) return compareSuffix(ma[3], mb[3]);
    return 0;
  }

  // roman numerals: both tokens consist of roman characters, and at least one
  // is multi-character (to avoid misclassifying single-letter paragraph labels)
  if (ROMAN_CHARS.test(a) && ROMAN_CHARS.test(b) && (a.length > 1 || b.length > 1)) {
    const ra = parseRoman(a);
    const rb = parseRoman(b);
    if (ra > 0 && rb > 0) return ra - rb;
  }

  // alphabetic (paragraph labels, etc.) using insertion ordering
  if (ALPHA_ONLY.test(a) && ALPHA_ONLY.test(b))
    return compareSuffix(a, b);

  // fallback: case-insensitive lexicographic
  return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
}

/* suffix comparison for inserted provisions */

/**
 * Compares two provision suffixes according to UK legislation insertion conventions.
 *
 * The ordering follows the guidance in section 6.4 of Statutory Instrument Practice:
 * - Z followed by a letter is a prefix meaning "before" (ZA, ZB... sort before A)
 * - Letters A through Y are ordered normally
 * - Z at the end (or followed by a digit) is the letter Z (sorts after Y)
 * - The convention is recursive: ZZA sorts before ZA, which sorts before A
 *
 * Example ordering: ZZA < ZA < ZB < A < AZA < AA < AB < AZ < B < ... < Z
 */
export function compareSuffix(s1: string, s2: string): number {
  if (s1.toLowerCase() === s2.toLowerCase()) return 0;
  if (!s1) return -1;
  if (!s2) return 1;

  // Numeric sub-suffixes (e.g. "10" in "Z10"): compare numerically
  if (isDigit(s1[0]) && isDigit(s2[0])) {
    let i1 = 0;
    while (i1 < s1.length && isDigit(s1[i1])) i1++;
    let i2 = 0;
    while (i2 < s2.length && isDigit(s2[i2])) i2++;
    const cmp = parseInt(s1.slice(0, i1), 10) - parseInt(s2.slice(0, i2), 10);
    if (cmp !== 0) return cmp;
    return compareSuffix(s1.slice(i1), s2.slice(i2));
  }

  const rank1 = suffixRank(s1);
  const rank2 = suffixRank(s2);
  if (rank1 !== rank2) return rank1 - rank2;

  // Same rank: strip first character and recurse
  return compareSuffix(s1.slice(1), s2.slice(1));
}

/**
 * Returns the sort rank of the first character of a suffix string.
 * Z followed by a letter = 0 (before everything).
 * A through Y = 1 through 25.
 * Z at end or followed by a digit = 26 (after Y).
 */
function suffixRank(s: string): number {
  const first = s[0].toUpperCase();
  if (first === 'Z' && s.length > 1 && isLetter(s[1]))
    return 0;
  return first.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
