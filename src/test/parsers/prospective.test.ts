/**
 * Tests for the undateable test (isUndateableVersion in metadata-parser.ts):
 * whether a revised version can't be dated, so that its version is
 * "prospective". The cases follow the LGU2 API's ProspectiveSignalsTest; the
 * payloads are constructed.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { payload, versionsOf } from '../helpers/metadata-payload.js';

const VALID = '2024-11-01';

/** The version can't be dated. */
const UNDATEABLE = { version: 'prospective', versions: ['enacted', 'prospective'] };
/** Dated by the start date in the content. */
const DATED = { version: '2024-10-01', versions: ['enacted', '2024-10-01'] };
/** No date in the content, so dct:valid is the version. */
const UNDATED = { version: VALID, versions: ['enacted', VALID] };

/** hasVersion links for the requested part of ukpga/2024/1, with the given titles and `current`. */
function links(path: string, ...titles: string[]): string {
  const base = path ? `ukpga/2024/1/${path}` : 'ukpga/2024/1';
  return [...titles, 'current']
    .map(title => `<atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/${base}/${title}" title="${title}"/>`)
    .join('\n');
}

/** Schedule 1, requested unversioned, with the given attributes on the Schedule. */
function schedule(attributes: string, options: { status?: string; titles?: string[] } = {}): string {
  const { status = 'revised', titles = ['enacted'] } = options;
  return payload({
    identifier: 'schedule/1',
    valid: status === 'final' ? undefined : VALID,
    status,
    links: links('schedule/1', ...titles),
    content: `
<Primary><Body/><Schedules>
  <Schedule id="schedule-1" ${attributes}>
    <Number>Schedule 1</Number>
    <ScheduleBody><P><Text>Text.</Text></P></ScheduleBody>
  </Schedule>
</Schedules></Primary>`,
  });
}

/** Section 2, requested unversioned as `identifier`, with attributes on its P1group, its P1 and its subsection (1). */
function section(identifier: string, attributes: { p1group?: string; p1?: string; p2?: string }): string {
  return payload({
    identifier,
    valid: VALID,
    links: links(identifier, 'enacted'),
    content: `
<Primary><Body>
  <P1group ${attributes.p1group ?? ''}>
    <Title>Heading</Title>
    <P1 id="section-2" ${attributes.p1 ?? ''}>
      <Pnumber>2</Pnumber>
      <P1para>
        <P2 id="section-2-1" ${attributes.p2 ?? ''}>
          <Pnumber>1</Pnumber>
          <P2para><Text>Text.</Text></P2para>
        </P2>
      </P1para>
    </P1>
  </P1group>
</Body></Primary>`,
  });
}

// --- The marking and the start date ---

test('a target marked prospective with no start date is undateable', () => {
  assert.deepStrictEqual(versionsOf(schedule('Status="Prospective"')), UNDATEABLE);
});

// As ukpga/2023/50/schedule/2: a start date is a date the version can be labelled with.
test('a target marked prospective with a start date is dated by it', () => {
  assert.deepStrictEqual(versionsOf(schedule('Status="Prospective" RestrictStartDate="2024-10-01"')), DATED);
});

for (const value of ['', 'not a date']) {
  test(`a marked target with RestrictStartDate=${JSON.stringify(value)} is not undateable: the attribute is present`, () => {
    assert.deepStrictEqual(versionsOf(schedule(`Status="Prospective" RestrictStartDate="${value}"`)), UNDATED);
  });
}

// As ukpga/2003/44/schedule/31: the marking that keeps a provision out of every
// dated snapshot is what leaves its version with no date.
test('a marked target is undateable even when Match="false"', () => {
  assert.deepStrictEqual(versionsOf(schedule('Status="Prospective" Match="false"')), UNDATEABLE);
});

// --- Reading @Status as a list ---

for (const value of ['Repealed Prospective', 'Prospective Repealed', 'Repealed\tProspective', 'Repealed\nProspective', 'Repealed\r\nProspective', '  Prospective  ']) {
  test(`Prospective is found as one of the values in Status=${JSON.stringify(value)}`, () => {
    assert.deepStrictEqual(versionsOf(schedule(`Status="${value}"`)), UNDATEABLE);
  });
}

// legislation.gov.uk writes some characters in attribute values as numeric references.
for (const value of ['Repealed&#9;Prospective', 'Repealed&#x9;Prospective', 'Repealed&#10;Prospective', 'Repealed&#xA;Prospective', 'Prospe&#99;tive', 'Prospe&#x63;tive']) {
  test(`Prospective is found in Status=${JSON.stringify(value)}, with its references decoded`, () => {
    assert.deepStrictEqual(versionsOf(schedule(`Status="${value}"`)), UNDATEABLE);
  });
}

for (const value of ['NotProspective', 'prospective', 'Prospective,Repealed', 'Repealed', 'Repealed&amp;#9;Prospective']) {
  test(`Status=${JSON.stringify(value)} is not a prospective marking`, () => {
    assert.deepStrictEqual(versionsOf(schedule(`Status="${value}"`)), UNDATED);
  });
}

// --- A P1 and its P1group ---

// As ukpga/2026/19/section/1: for a P1 the marking usually sits on the P1group.
test('a P1 is undateable when its P1group is marked with no start date', () => {
  assert.deepStrictEqual(versionsOf(section('section/2', { p1group: 'Status="Prospective"' })), UNDATEABLE);
});

test('a P1 marked with no start date is undateable', () => {
  assert.deepStrictEqual(versionsOf(section('section/2', { p1: 'Status="Prospective"' })), UNDATEABLE);
});

// The P1 and its P1group are tested separately: either one qualifies on its own.
test('a dated P1 is undateable when its P1group is marked with no start date', () => {
  const xml = section('section/2', { p1group: 'Status="Prospective"', p1: 'RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(versionsOf(xml), UNDATEABLE);
});

test('a P1 marked with no start date is undateable when its P1group is dated', () => {
  const xml = section('section/2', { p1group: 'RestrictStartDate="2024-10-01"', p1: 'Status="Prospective"' });
  assert.deepStrictEqual(versionsOf(xml), UNDATEABLE);
});

test('a P1 marked with a start date, in an unmarked P1group, is dated', () => {
  const xml = section('section/2', { p1: 'Status="Prospective" RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(versionsOf(xml), DATED);
});

test('a P1 in a P1group marked with a start date is dated', () => {
  const xml = section('section/2', { p1group: 'Status="Prospective" RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(versionsOf(xml), DATED);
});

// A P1group can also hold a P. Only a P1 target's P1group is tested, as in the
// API: a P1group may hold more than one provision.
test('a target other than a P1 is not undateable because its P1group is marked', () => {
  const xml = payload({
    identifier: 'section/3',
    valid: VALID,
    links: links('section/3', 'enacted'),
    content: `
<Primary><Body>
  <P1group Status="Prospective">
    <Title>Heading</Title>
    <P id="section-3"><Text>Text.</Text></P>
  </P1group>
</Body></Primary>`,
  });
  assert.deepStrictEqual(versionsOf(xml), UNDATED);
});

// --- Markings that are not on the target ---

test('a marked sub-provision requested directly is undateable', () => {
  assert.deepStrictEqual(versionsOf(section('section/2/1', { p2: 'Status="Prospective"' })), UNDATEABLE);
});

test('a marking inside the target does not make it undateable', () => {
  assert.deepStrictEqual(versionsOf(section('section/2', { p2: 'Status="Prospective"' })), UNDATED);
});

// --- Whole documents ---

function wholeDocument(rootAttributes: string, sectionAttributes = ''): string {
  return payload({
    valid: VALID,
    links: links('', 'enacted'),
    rootAttributes,
    content: `<Primary><Body><P1group ${sectionAttributes}><Title>Heading</Title><P1 id="section-2"><Pnumber>2</Pnumber></P1></P1group></Body></Primary>`,
  });
}

test('a whole document is undateable when its root is marked with no start date', () => {
  assert.deepStrictEqual(versionsOf(wholeDocument('Status="Prospective"')), UNDATEABLE);
});

test('a whole document whose root is marked with a start date is not undateable', () => {
  assert.deepStrictEqual(versionsOf(wholeDocument('Status="Prospective" RestrictStartDate="2024-10-01"')), UNDATED);
});

// As ukpga/2026/18, a revised Act with provisions awaiting commencement and a dated version.
test('a whole document holding a marked provision is not undateable', () => {
  assert.deepStrictEqual(versionsOf(wholeDocument('', 'Status="Prospective"')), UNDATED);
});

// --- Final text and the links ---

test('final text is never undateable', () => {
  assert.deepStrictEqual(versionsOf(schedule('Status="Prospective"', { status: 'final' })), { version: 'enacted', versions: ['enacted'] });
});

test('a prospective link does not make the version undateable', () => {
  const xml = schedule('RestrictStartDate="2024-10-01"', { titles: ['enacted', 'prospective'] });
  assert.deepStrictEqual(versionsOf(xml), { version: '2024-10-01', versions: ['enacted', '2024-10-01', 'prospective'] });
});
