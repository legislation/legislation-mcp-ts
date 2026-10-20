/**
 * Tests for the dates read from a fragment's content (fragment-dates.ts), as
 * they reach `version` and `versions`. Most cases are ported from the LGU2
 * API's MetadataVersionsSemanticsTest; the payloads are constructed.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { MetadataParser } from '../../parsers/metadata-parser.js';

const VALID = '2024-11-01';

/** hasVersion links with the given titles, and the `current` link. */
function links(...titles: string[]): string {
  return [...titles, 'current']
    .map(title => `<atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2024/1/section/2/${title}" title="${title}"/>`)
    .join('\n');
}

/** A payload for ukpga/2024/1, requested at `identifier` (the part after the number). */
function payload(options: {
  identifier: string;
  valid?: string;
  links: string;
  content: string;
  status?: string;
  documentUri?: string;
  rootAttributes?: string;
}): string {
  const { identifier, valid, content, status = 'revised', documentUri = 'ukpga/2024/1', rootAttributes = '' } = options;
  return `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/${documentUri}" ${rootAttributes}>
  <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
      xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
      xmlns:atom="http://www.w3.org/2005/Atom">
    <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1/${identifier}</dc:identifier>
    ${valid ? `<dct:valid>${valid}</dct:valid>` : ''}
    ${options.links}
    <ukm:PrimaryMetadata>
      <ukm:DocumentClassification>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:DocumentStatus Value="${status}"/>
      </ukm:DocumentClassification>
      <ukm:Year Value="2024"/>
      <ukm:Number Value="1"/>
    </ukm:PrimaryMetadata>
  </ukm:Metadata>
  ${content}
</Legislation>`;
}

/** Section 2, holding subsection (1). The attributes go on the section's P1group and on the subsection. */
function section(p1groupAttributes: string, subsectionAttributes: string): string {
  return `
<Primary><Body>
  <P1group ${p1groupAttributes}>
    <P1 id="section-2">
      <Pnumber>2</Pnumber>
      <P1para>
        <P2 id="section-2-1" ${subsectionAttributes}>
          <Pnumber>1</Pnumber>
          <P2para><Text>Text.</Text></P2para>
        </P2>
      </P1para>
    </P1>
  </P1group>
</Body></Primary>`;
}

/** Section 2 requested at dct:valid, with the given links and content. */
function sectionPayload(sectionLinks: string, content: string): string {
  return payload({ identifier: `section/2/${VALID}`, valid: VALID, links: sectionLinks, content });
}

function versionsOf(xml: string) {
  const { version, versions } = new MetadataParser().parse(xml);
  return { version, versions };
}

// --- The fragment's own version ---

test('a fragment requested at its own version date reports that version, which its links leave out', () => {
  const xml = payload({
    identifier: 'section/2/2024-10-01',
    valid: '2024-10-01',
    links: links('2024-09-01', '2024-12-01'),
    content: section('RestrictStartDate="2024-10-01"', ''),
  });
  assert.deepStrictEqual(versionsOf(xml), {
    version: '2024-10-01',
    versions: ['2024-09-01', '2024-10-01', '2024-12-01'],
  });
});

test('a fragment reports a version made by a change inside it', () => {
  const xml = sectionPayload(links('2024-09-01'), section('RestrictStartDate="2024-09-01"', 'RestrictStartDate="2024-10-01"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

test('a date read from the content stops dct:valid being added', () => {
  // With only "current" in the links, dct:valid used to be recovered as the
  // fragment's label. The content date is a dated label, so it no longer is.
  const xml = sectionPayload(links(), section('RestrictStartDate="2024-10-01"', ''));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-10-01'] });
});

test('a listed version later than the start date is kept as the version', () => {
  // As a version made only by removing text or adding an annotation would
  // leave. The version is selected from the list, not taken from the start date.
  const xml = sectionPayload(links('enacted', '2024-06-01', '2024-09-01'), section('RestrictStartDate="2024-06-01"', ''));
  assert.deepStrictEqual(versionsOf(xml), {
    version: '2024-09-01',
    versions: ['enacted', '2024-06-01', '2024-09-01'],
  });
});

// --- Provision and section ---

test('a sub-provision is read as its provision', () => {
  // Subsection (1) carries an earlier date than its P1group. Read alone, it
  // would miss the change elsewhere in the section.
  const xml = payload({
    identifier: `section/2/1/${VALID}`,
    valid: VALID,
    links: links('2024-09-01'),
    content: section('RestrictStartDate="2024-10-01"', 'RestrictStartDate="2024-09-15"'),
  });
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

test('a P1 is read with every P1 in its P1group', () => {
  const xml = sectionPayload(links('2024-09-01'), `
<Primary><Body>
  <P1group>
    <P1 id="section-2"><Pnumber>2</Pnumber></P1>
    <P1 id="section-3" RestrictStartDate="2024-10-01"><Pnumber>3</Pnumber></P1>
  </P1group>
</Body></Primary>`);
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

// --- Alternative versions ---

const ALTERNATIVE_VERSION = `
<Versions>
  <Version id="v00001" Description="S">
    <P1group RestrictExtent="S" RestrictStartDate="DATE">
      <P1 id="section-2"><Pnumber>2</Pnumber></P1>
    </P1group>
  </Version>
</Versions>`;

const MAIN_TEXT = `
<Primary><Body>
  <P1group AltVersionRefs="v00001" RestrictExtent="E+W" RestrictStartDate="2024-10-01">
    <P1 id="section-2"><Pnumber>2</Pnumber></P1>
  </P1group>
</Body></Primary>`;

test('an alternative version\'s date counts towards the section\'s', () => {
  const xml = sectionPayload(links('2024-10-01'), MAIN_TEXT + ALTERNATIVE_VERSION.replace('DATE', '2024-11-01'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-11-01', versions: ['2024-10-01', '2024-11-01'] });
});

test('an alternative version carrying the same id is not the target', () => {
  // Versions is placed first, so a search that looked inside it would find
  // the Scotland version's P1, whose only date is 2024-09-15.
  const xml = sectionPayload(links('2024-09-01'), ALTERNATIVE_VERSION.replace('DATE', '2024-09-15') + MAIN_TEXT);
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

// --- Match="false" ---

test('an element marked Match="false" does not count, but the elements inside it do', () => {
  const xml = sectionPayload(links('2024-09-01'), section('Match="false" RestrictStartDate="2024-10-15"', 'RestrictStartDate="2024-10-01"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

test('a date marked Match="false" does not count, even on or before dct:valid', () => {
  const xml = sectionPayload(links('2024-09-01'), section('RestrictStartDate="2024-10-01"', 'Match="false" RestrictStartDate="2024-10-20"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

test('with nothing else dated, the section\'s own date counts even when marked Match="false"', () => {
  const xml = sectionPayload(links('2024-09-01'), section('Match="false" RestrictStartDate="2024-10-01"', ''));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

// --- Tables ---

/** A table in section 2, with the given attributes on the section's P1. */
function table(p1Attributes: string): string {
  return payload({
    identifier: `section/2/table/1/${VALID}`,
    valid: VALID,
    links: links('2024-09-01'),
    content: `
<Primary><Body>
  <P1group RestrictStartDate="2024-10-01">
    <P1 id="section-2" ${p1Attributes}>
      <P1para>
        <Tabular id="section-2-table-1" RestrictStartDate="2024-11-01"><table/></Tabular>
      </P1para>
    </P1>
  </P1group>
</Body></Primary>`,
  });
}

test('a table takes the date of its nearest dated ancestor, not its own', () => {
  assert.deepStrictEqual(versionsOf(table('')), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

for (const value of ['', 'not a date']) {
  test(`a table whose nearest dated ancestor's date is ${JSON.stringify(value)} gets no date`, () => {
    // The P1 carries the attribute, so the P1group further up is not used.
    assert.deepStrictEqual(versionsOf(table(`RestrictStartDate="${value}"`)), {
      version: '2024-09-01',
      versions: ['2024-09-01'],
    });
  });
}

test('a table whose nearest dated ancestor starts after dct:valid gets only a later date', () => {
  assert.deepStrictEqual(versionsOf(table('RestrictStartDate="2024-12-01"')), {
    version: '2024-09-01',
    versions: ['2024-09-01', '2024-12-01'],
  });
});

// --- The dct:valid limit and the later date ---

test('a date after dct:valid is a later version, and an earlier one is the start', () => {
  const xml = sectionPayload(links('2024-09-01'), section('RestrictStartDate="2024-12-01"', 'RestrictStartDate="2024-10-01"'));
  assert.deepStrictEqual(versionsOf(xml), {
    version: '2024-10-01',
    versions: ['2024-09-01', '2024-10-01', '2024-12-01'],
  });
});

test('a later version named by the links is kept, and the same date read from the content adds nothing', () => {
  const xml = sectionPayload(links('2024-09-01', '2024-12-01'), section('RestrictStartDate="2024-10-01"', 'RestrictStartDate="2024-12-01"'));
  assert.deepStrictEqual(versionsOf(xml), {
    version: '2024-10-01',
    versions: ['2024-09-01', '2024-10-01', '2024-12-01'],
  });
});

test('with every date after dct:valid, there is no start date but there is a later version', () => {
  const xml = sectionPayload(links('2024-09-01'), section('Match="false" RestrictStartDate="2024-12-01"', 'RestrictStartDate="2024-12-15"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-09-01', versions: ['2024-09-01', '2024-12-15'] });
});

// Without dct:valid, as in a prospective version, there is no limit, and the
// version is the first-version keyword.
test('without dct:valid there is no limit', () => {
  const xml = payload({
    identifier: `section/2/${VALID}`,
    links: links('2024-09-01'),
    content: section('RestrictStartDate="2024-12-01"', 'RestrictStartDate="2024-12-15"'),
  });
  assert.deepStrictEqual(versionsOf(xml), { version: 'enacted', versions: ['2024-09-01', '2024-12-15'] });
});

test('a prospective section without dct:valid stays prospective, and its content date is not added', () => {
  const xml = payload({
    identifier: `section/2/${VALID}`,
    links: links('2024-09-01'),
    content: section('Status="Prospective"', 'RestrictStartDate="2024-12-15"'),
  });
  assert.deepStrictEqual(versionsOf(xml), { version: 'prospective', versions: ['2024-09-01', 'prospective'] });
});

// --- Reading dates ---

for (const date of ['2024-10-01Z', '2024-10-01+01:00', '2024-10-01-05:00']) {
  test(`a start date with a timezone keeps its calendar date (${date})`, () => {
    const xml = sectionPayload(links('2024-09-01'), section(`RestrictStartDate="${date}"`, ''));
    assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
  });
}

for (const date of ['2024-12-01Z', '2024-12-01+01:00', '2024-12-01-05:00']) {
  test(`a later date with a timezone keeps its calendar date (${date})`, () => {
    const xml = sectionPayload(links('2024-09-01'), section(`RestrictStartDate="${date}"`, ''));
    assert.deepStrictEqual(versionsOf(xml), { version: '2024-09-01', versions: ['2024-09-01', '2024-12-01'] });
  });
}

test('dates in different timezones are compared as calendar dates', () => {
  // As instants, 2024-10-01-12:00 begins after 2024-10-02+14:00.
  const xml = sectionPayload(links('2024-09-01'), section('RestrictStartDate="2024-10-01-12:00"', 'RestrictStartDate="2024-10-02+14:00"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-02', versions: ['2024-09-01', '2024-10-02'] });
});

test('a value that is not a calendar date is ignored', () => {
  const xml = sectionPayload(links('2024-09-01'), section('RestrictStartDate="2024-10-01"', 'RestrictStartDate="2024-10-32"'));
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['2024-09-01', '2024-10-01'] });
});

// --- Responses that are not fragments, and final text ---

test('a whole document gets no date from its content', () => {
  const xml = payload({
    identifier: VALID,
    valid: VALID,
    links: links('2024-09-01'),
    content: section('RestrictStartDate="2024-10-01"', ''),
  });
  assert.deepStrictEqual(versionsOf(xml), { version: VALID, versions: ['2024-09-01', VALID] });
});

test('final text gets no date from its content', () => {
  const xml = payload({
    identifier: 'section/2/enacted',
    status: 'final',
    links: links('2024-09-01'),
    content: section('RestrictStartDate="2024-10-01"', ''),
  });
  assert.deepStrictEqual(versionsOf(xml), { version: 'enacted', versions: ['enacted', '2024-09-01'] });
});

// A table of contents is read as the whole document, whatever the form of its
// identifier. Read as a fragment, dct:valid would not be added beside the
// dated link, and the root's Status would not be read.
const CONTENTS_FORMS = [
  { identifier: 'contents', documentUri: 'ukpga/2024/1' },
  { identifier: `contents/${VALID}`, documentUri: `ukpga/2024/1/${VALID}` },
  { identifier: 'contents/welsh', documentUri: 'ukpga/2024/1/welsh' },
];

for (const form of CONTENTS_FORMS) {
  const contents = '<Contents><ContentsItem ContentRef="section-2" RestrictStartDate="2024-10-01"/></Contents>';

  test(`a table of contents (${form.identifier}) gets the whole document's versions`, () => {
    const xml = payload({ ...form, valid: VALID, links: links('2024-09-01'), content: contents });
    assert.deepStrictEqual(versionsOf(xml), { version: VALID, versions: ['2024-09-01', VALID] });
  });

  test(`a table of contents (${form.identifier}) reads the root element's Status`, () => {
    const xml = payload({ ...form, valid: VALID, links: links('2024-09-01'), content: contents, rootAttributes: 'Status="Prospective"' });
    assert.deepStrictEqual(versionsOf(xml), { version: 'prospective', versions: ['2024-09-01', 'prospective'] });
  });
}
