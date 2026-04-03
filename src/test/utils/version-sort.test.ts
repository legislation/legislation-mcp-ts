import { test } from 'node:test';
import assert from 'node:assert';
import { compareVersions } from '../../utils/version-sort.js';

test('compareVersions sorts first-version keywords before dates', () => {
  const versions = ['2020-01-01', 'enacted'];
  assert.deepStrictEqual(versions.sort(compareVersions), ['enacted', '2020-01-01']);
});

test('compareVersions sorts dates chronologically', () => {
  const versions = ['2024-06-01', '2020-01-31', '2022-03-15'];
  assert.deepStrictEqual(versions.sort(compareVersions), ['2020-01-31', '2022-03-15', '2024-06-01']);
});

test('compareVersions sorts prospective after dates', () => {
  const versions = ['prospective', '2020-01-01', 'enacted'];
  assert.deepStrictEqual(versions.sort(compareVersions), ['enacted', '2020-01-01', 'prospective']);
});

test('compareVersions handles all first-version keywords equally', () => {
  const versions = ['2020-01-01', 'made'];
  assert.deepStrictEqual(versions.sort(compareVersions), ['made', '2020-01-01']);

  const versions2 = ['2020-01-01', 'created'];
  assert.deepStrictEqual(versions2.sort(compareVersions), ['created', '2020-01-01']);

  const versions3 = ['2020-01-01', 'adopted'];
  assert.deepStrictEqual(versions3.sort(compareVersions), ['adopted', '2020-01-01']);
});

test('compareVersions handles full example', () => {
  const versions = ['prospective', '2024-06-01', 'enacted', '2020-01-31'];
  assert.deepStrictEqual(
    versions.sort(compareVersions),
    ['enacted', '2020-01-31', '2024-06-01', 'prospective']
  );
});
