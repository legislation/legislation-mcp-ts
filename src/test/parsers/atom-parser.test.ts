/**
 * Tests for AtomParser
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { AtomParser } from '../../parsers/atom-parser.js';

const SAMPLE_ATOM_FEED = `
<feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
    xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
    xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
    <updated>2026-01-27T20:05:28.882516Z</updated>
    <openSearch:itemsPerPage>20</openSearch:itemsPerPage>
    <openSearch:startIndex>1</openSearch:startIndex>
    <leg:page>1</leg:page>
    <leg:morePages>12</leg:morePages>
    <entry>
        <id>http://www.legislation.gov.uk/id/ukpga/2026/3</id>
        <title>Holocaust Memorial Act 2026</title>
        <updated>2026-01-26T12:20:07Z</updated>
        <published>2026-01-23T11:53:21.39413Z</published>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:Year Value="2026"/>
        <ukm:Number Value="3"/>
        <ukm:ISBN Value="9780105703068"/>
        <ukm:CreationDate Date="2026-01-22"/>
        <summary>An Act to make provision for expenditure by the Secretary of State and the removal
            of restrictions in respect of certain land for or in connection with the construction of
            a Holocaust Memorial and Learning Centre.</summary>
    </entry>
</feed>
`;

test('AtomParser parses single entry feed', () => {
  const parser = new AtomParser();
  const result = parser.parse(SAMPLE_ATOM_FEED);

  assert.strictEqual(result.documents.length, 1, 'Should have one document');

  const doc = result.documents[0];
  assert.strictEqual(doc.id, 'ukpga/2026/3', 'Should extract simplified id');
  assert.strictEqual(doc.type, 'ukpga', 'Should extract type code');
  assert.strictEqual(doc.year, 2026, 'Should extract year as number');
  assert.strictEqual(doc.number, 3, 'Should extract number as number');
  assert.strictEqual(doc.title, 'Holocaust Memorial Act 2026', 'Should extract title');
  assert.strictEqual(doc.date, '2026-01-22', 'Should extract creation date');
});

test('AtomParser extracts pagination metadata from leg:page and leg:morePages', () => {
  // The sample feed has leg:page=1, leg:morePages=12 but no openSearch:totalResults
  const parser = new AtomParser();
  const result = parser.parse(SAMPLE_ATOM_FEED);

  assert.strictEqual(result.meta.page, 1, 'Should read page from leg:page');
  assert.strictEqual(result.meta.morePages, true, 'Should detect more pages from leg:morePages > 0');
  assert.strictEqual(result.meta.itemsPerPage, 20, 'Should read itemsPerPage from openSearch:itemsPerPage');
});

test('AtomParser handles empty feed', () => {
  const parser = new AtomParser();
  const emptyFeed = `
    <feed xmlns="http://www.w3.org/2005/Atom">
      <updated>2026-01-27T20:05:28.882516Z</updated>
    </feed>
  `;

  const result = parser.parse(emptyFeed);
  assert.strictEqual(result.documents.length, 0, 'Should have zero documents');
});

test('AtomParser handles multiple entries', () => {
  const parser = new AtomParser();
  const multiEntryFeed = `
    <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
      <entry>
        <id>http://www.legislation.gov.uk/id/ukpga/2026/3</id>
        <title>Holocaust Memorial Act 2026</title>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:Year Value="2026"/>
        <ukm:Number Value="3"/>
        <ukm:CreationDate Date="2026-01-22"/>
      </entry>
      <entry>
        <id>http://www.legislation.gov.uk/id/ukpga/2021/24</id>
        <title>Fire Safety Act 2021</title>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:Year Value="2021"/>
        <ukm:Number Value="24"/>
        <ukm:CreationDate Date="2021-04-29"/>
      </entry>
    </feed>
  `;

  const result = parser.parse(multiEntryFeed);
  assert.strictEqual(result.documents.length, 2, 'Should have two documents');

  assert.strictEqual(result.documents[0].id, 'ukpga/2026/3');
  assert.strictEqual(result.documents[0].type, 'ukpga');
  assert.strictEqual(result.documents[0].year, 2026);
  assert.strictEqual(result.documents[0].number, 3);
  assert.strictEqual(result.documents[0].title, 'Holocaust Memorial Act 2026');

  assert.strictEqual(result.documents[1].id, 'ukpga/2021/24');
  assert.strictEqual(result.documents[1].type, 'ukpga');
  assert.strictEqual(result.documents[1].year, 2021);
  assert.strictEqual(result.documents[1].number, 24);
  assert.strictEqual(result.documents[1].title, 'Fire Safety Act 2021');
});

test('AtomParser handles missing optional fields', () => {
  const parser = new AtomParser();
  const minimalFeed = `
    <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
      <entry>
        <id>http://www.legislation.gov.uk/id/ukpga/2026/3</id>
        <title>Test Act 2026</title>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:Year Value="2026"/>
        <ukm:Number Value="3"/>
      </entry>
    </feed>
  `;

  const result = parser.parse(minimalFeed);
  assert.strictEqual(result.documents.length, 1);
  assert.strictEqual(result.documents[0].date, undefined, 'Date should be undefined when missing');
});

test('AtomParser decodes standard XML entities in titles', () => {
  const parser = new AtomParser();
  const feedWithEntities = `
    <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
      <entry>
        <id>http://www.legislation.gov.uk/id/ukpga/2026/3</id>
        <title>Finance Act 2024 &amp; related provisions &lt;draft&gt;</title>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:Year Value="2026"/>
        <ukm:Number Value="3"/>
      </entry>
    </feed>
  `;

  const result = parser.parse(feedWithEntities);
  assert.strictEqual(result.documents[0].title, 'Finance Act 2024 & related provisions <draft>');
});
