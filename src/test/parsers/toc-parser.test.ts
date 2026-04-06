/**
 * Tests for TocParser
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { TocParser } from '../../parsers/toc-parser.js';

/**
 * Helper: wrap Contents XML in a minimal valid Legislation document.
 */
function makeXml({
  contentsXml = '',
  atomLinks = '',
  restrictExtent = 'E+W+S+N.I.',
}: {
  contentsXml?: string;
  atomLinks?: string;
  restrictExtent?: string;
} = {}): string {
  const extentAttr = restrictExtent ? ` RestrictExtent="${restrictExtent}"` : '';
  return `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2024/1"${extentAttr}>
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1</dc:identifier>
        <dc:title>Test Act 2024</dc:title>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentCategory Value="primary"/>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="final"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2024"/>
            <ukm:Number Value="1"/>
        </ukm:PrimaryMetadata>
        ${atomLinks}
    </ukm:Metadata>
    <Contents>
        ${contentsXml}
    </Contents>
</Legislation>`;
}

test('TocParser parses basic body items with numbers and titles', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
        <ContentsNumber>1</ContentsNumber>
        <ContentsTitle>Short title</ContentsTitle>
      </ContentsItem>
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/2">
        <ContentsNumber>2</ContentsNumber>
        <ContentsTitle>Commencement</ContentsTitle>
      </ContentsItem>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.body.length, 2);

  const s1 = result.contents.body[0];
  assert.strictEqual(s1.name, 'item');
  assert.strictEqual(s1.number, '1');
  assert.strictEqual(s1.title, 'Short title');
  assert.strictEqual(s1.fragmentId, 'section/1');

  const s2 = result.contents.body[1];
  assert.strictEqual(s2.name, 'item');
  assert.strictEqual(s2.number, '2');
  assert.strictEqual(s2.title, 'Commencement');
  assert.strictEqual(s2.fragmentId, 'section/2');
});

test('TocParser parses hierarchical nesting (Part > Chapter > Item)', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsPart IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/part/1">
        <ContentsNumber>Part 1</ContentsNumber>
        <ContentsTitle>General</ContentsTitle>
        <ContentsChapter IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/part/1/chapter/1">
          <ContentsNumber>Chapter 1</ContentsNumber>
          <ContentsTitle>Interpretation</ContentsTitle>
          <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
            <ContentsNumber>1</ContentsNumber>
            <ContentsTitle>Definitions</ContentsTitle>
          </ContentsItem>
        </ContentsChapter>
      </ContentsPart>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.body.length, 1);

  const part = result.contents.body[0];
  assert.strictEqual(part.name, 'part');
  assert.strictEqual(part.number, 'Part 1');
  assert.strictEqual(part.title, 'General');
  assert.strictEqual(part.fragmentId, 'part/1');

  assert.strictEqual(part.children?.length, 1);
  const chapter = part.children![0];
  assert.strictEqual(chapter.name, 'chapter');
  assert.strictEqual(chapter.number, 'Chapter 1');
  assert.strictEqual(chapter.title, 'Interpretation');
  assert.strictEqual(chapter.fragmentId, 'part/1/chapter/1');

  assert.strictEqual(chapter.children?.length, 1);
  const item = chapter.children![0];
  assert.strictEqual(item.name, 'item');
  assert.strictEqual(item.number, '1');
  assert.strictEqual(item.title, 'Definitions');
  assert.strictEqual(item.fragmentId, 'section/1');
});

test('TocParser extracts contents title', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsTitle>Test Act 2024</ContentsTitle>
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
        <ContentsNumber>1</ContentsNumber>
        <ContentsTitle>Short title</ContentsTitle>
      </ContentsItem>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.title, 'Test Act 2024');
});

test('TocParser parses schedules and skips group title', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsSchedules>
        <ContentsTitle>SCHEDULES</ContentsTitle>
        <ContentsSchedule IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/schedule/1">
          <ContentsNumber>Schedule 1</ContentsNumber>
          <ContentsTitle>Consequential amendments</ContentsTitle>
        </ContentsSchedule>
        <ContentsSchedule IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/schedule/2">
          <ContentsNumber>Schedule 2</ContentsNumber>
          <ContentsTitle>Transitional provisions</ContentsTitle>
        </ContentsSchedule>
      </ContentsSchedules>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.schedules?.length, 2);

  const sch1 = result.contents.schedules![0];
  assert.strictEqual(sch1.name, 'schedule');
  assert.strictEqual(sch1.number, 'Schedule 1');
  assert.strictEqual(sch1.title, 'Consequential amendments');
  assert.strictEqual(sch1.fragmentId, 'schedule/1');

  const sch2 = result.contents.schedules![1];
  assert.strictEqual(sch2.name, 'schedule');
  assert.strictEqual(sch2.number, 'Schedule 2');
  assert.strictEqual(sch2.title, 'Transitional provisions');
  assert.strictEqual(sch2.fragmentId, 'schedule/2');
});

test('TocParser places attachments before schedules in attachmentsBeforeSchedules', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsAttachments>
        <ContentsAttachment IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/attachment/1">
          <ContentsNumber>Attachment 1</ContentsNumber>
          <ContentsTitle>Form A</ContentsTitle>
        </ContentsAttachment>
      </ContentsAttachments>
      <ContentsSchedules>
        <ContentsSchedule IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/schedule/1">
          <ContentsNumber>Schedule 1</ContentsNumber>
          <ContentsTitle>Details</ContentsTitle>
        </ContentsSchedule>
      </ContentsSchedules>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.attachmentsBeforeSchedules?.length, 1);
  assert.strictEqual(result.contents.attachmentsBeforeSchedules![0].name, 'attachment');
  assert.strictEqual(result.contents.attachmentsBeforeSchedules![0].title, 'Form A');
  assert.strictEqual(result.contents.attachments, undefined, 'Should not populate post-schedule attachments');
});

test('TocParser places attachments after schedules in attachments', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsSchedules>
        <ContentsSchedule IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/schedule/1">
          <ContentsNumber>Schedule 1</ContentsNumber>
          <ContentsTitle>Details</ContentsTitle>
        </ContentsSchedule>
      </ContentsSchedules>
      <ContentsAttachments>
        <ContentsAttachment IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/attachment/1">
          <ContentsNumber>Attachment 1</ContentsNumber>
          <ContentsTitle>Form B</ContentsTitle>
        </ContentsAttachment>
      </ContentsAttachments>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.attachments?.length, 1);
  assert.strictEqual(result.contents.attachments![0].name, 'attachment');
  assert.strictEqual(result.contents.attachments![0].title, 'Form B');
  assert.strictEqual(result.contents.attachmentsBeforeSchedules, undefined, 'Should not populate pre-schedule attachments');
});

test('TocParser extracts extent from items and normalizes N.I.', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1" RestrictExtent="E+W">
        <ContentsNumber>1</ContentsNumber>
        <ContentsTitle>England and Wales only</ContentsTitle>
      </ContentsItem>
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/2" RestrictExtent="N.I.">
        <ContentsNumber>2</ContentsNumber>
        <ContentsTitle>Northern Ireland only</ContentsTitle>
      </ContentsItem>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.deepStrictEqual(result.contents.body[0].extent, ['E', 'W']);
  assert.deepStrictEqual(result.contents.body[1].extent, ['NI'], 'Should normalize N.I. to NI');
});

test('TocParser extracts text from inline elements (Abbreviation, Emphasis)', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
        <ContentsNumber>1</ContentsNumber>
        <ContentsTitle>The <Abbreviation Expansion="Financial Conduct Authority">FCA</Abbreviation> Rules</ContentsTitle>
      </ContentsItem>
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/2">
        <ContentsNumber>2</ContentsNumber>
        <ContentsTitle>Meaning of <Emphasis>"relevant person"</Emphasis></ContentsTitle>
      </ContentsItem>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.body[0].title, 'The FCA Rules');
  assert.strictEqual(result.contents.body[1].title, 'Meaning of "relevant person"');
});

test('TocParser decodes standard XML entities in contents titles', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
        <ContentsNumber>1</ContentsNumber>
        <ContentsTitle>Finance &amp; Administration &lt;General&gt;</ContentsTitle>
      </ContentsItem>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.contents.body[0].title, 'Finance & Administration <General>');
});

test('TocParser creates synthetic items from navigation links', () => {
  const xml = makeXml({
    atomLinks: `
      <atom:link rel="http://www.legislation.gov.uk/def/navigation/introduction" href="http://www.legislation.gov.uk/id/ukpga/2024/1/introduction" title="introduction"/>
      <atom:link rel="http://www.legislation.gov.uk/def/navigation/signature" href="http://www.legislation.gov.uk/id/ukpga/2024/1/signature" title="signature"/>
      <atom:link rel="http://www.legislation.gov.uk/def/navigation/note" href="http://www.legislation.gov.uk/id/ukpga/2024/1/note" title="note"/>
      <atom:link rel="http://www.legislation.gov.uk/def/navigation/earlier-orders" href="http://www.legislation.gov.uk/id/ukpga/2024/1/earlier-orders" title="earlier-orders"/>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.deepStrictEqual(result.contents.introduction, {
    name: 'introduction',
    title: 'Introductory Text',
    fragmentId: 'introduction',
    extent: ['E', 'W', 'S', 'NI'],
  });
  assert.deepStrictEqual(result.contents.signature, {
    name: 'signature',
    title: 'Signature',
    fragmentId: 'signature',
    extent: ['E', 'W', 'S', 'NI'],
  });
  assert.deepStrictEqual(result.contents.explanatoryNote, {
    name: 'explanatoryNote',
    title: 'Explanatory Note',
    fragmentId: 'note',
    extent: ['E', 'W', 'S', 'NI'],
  });
  assert.deepStrictEqual(result.contents.earlierOrders, {
    name: 'earlierOrders',
    title: 'Note as to Earlier Commencement Orders',
    fragmentId: 'earlier-orders',
    extent: ['E', 'W', 'S', 'NI'],
  });
});

test('TocParser does not overwrite XML-parsed items with synthetic items', () => {
  const xml = makeXml({
    contentsXml: `
      <ContentsIntroduction IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/introduction">
        <ContentsTitle>Introduction</ContentsTitle>
      </ContentsIntroduction>
    `,
    atomLinks: `
      <atom:link rel="http://www.legislation.gov.uk/def/navigation/introduction" href="http://www.legislation.gov.uk/id/ukpga/2024/1/introduction" title="introduction"/>
    `,
  });

  const parser = new TocParser();
  const result = parser.parse(xml);

  // Should use the XML-parsed item, not the synthetic one
  assert.strictEqual(result.contents.introduction?.name, 'introduction');
  assert.strictEqual(result.contents.introduction?.title, 'Introduction'); // From XML, not "Introductory Text"
  assert.strictEqual(result.contents.introduction?.fragmentId, 'introduction');
});

test('TocParser populates meta field correctly', () => {
  const xml = makeXml();

  const parser = new TocParser();
  const result = parser.parse(xml);

  assert.strictEqual(result.meta.id, 'ukpga/2024/1');
  assert.strictEqual(result.meta.type, 'ukpga');
  assert.strictEqual(result.meta.year, 2024);
  assert.strictEqual(result.meta.number, 1);
  assert.strictEqual(result.meta.title, 'Test Act 2024');
});
