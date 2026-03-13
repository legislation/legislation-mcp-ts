/**
 * Tests for roman numeral parsing
 *
 * Ported from SectionRangeContainmentTest.ParseRomanTests in the lgu2 API project.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { parse, toUpperRoman } from '../../utils/roman.js';

test('valid roman numerals parse correctly', () => {
  assert.strictEqual(parse('i'), 1);
  assert.strictEqual(parse('ii'), 2);
  assert.strictEqual(parse('iii'), 3);
  assert.strictEqual(parse('iv'), 4);
  assert.strictEqual(parse('ix'), 9);
  assert.strictEqual(parse('x'), 10);
  assert.strictEqual(parse('xiv'), 14);
  assert.strictEqual(parse('xl'), 40);
});

test('invalid sequences return 0', () => {
  assert.strictEqual(parse('iiii'), 0);  // should be iv
  assert.strictEqual(parse('dd'), 0);    // not valid
  assert.strictEqual(parse('vv'), 0);    // not valid
});

test('non-roman characters return 0', () => {
  assert.strictEqual(parse('bc'), 0);
  assert.strictEqual(parse('az'), 0);
});

test('toUpperRoman formats correctly', () => {
  assert.strictEqual(toUpperRoman(1), 'I');
  assert.strictEqual(toUpperRoman(4), 'IV');
  assert.strictEqual(toUpperRoman(9), 'IX');
  assert.strictEqual(toUpperRoman(14), 'XIV');
  assert.strictEqual(toUpperRoman(40), 'XL');
  assert.strictEqual(toUpperRoman(3999), 'MMMCMXCIX');
});

test('toUpperRoman rejects out-of-range values', () => {
  assert.throws(() => toUpperRoman(0));
  assert.throws(() => toUpperRoman(-1));
  assert.throws(() => toUpperRoman(4000));
});
