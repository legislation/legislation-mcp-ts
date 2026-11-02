/**
 * Tests for the two prospective signals in metadata-parser.ts:
 * isUndateableVersion, which decides whether a revised version is labelled
 * "prospective" instead of a date, and the published `prospective` field,
 * which says the response contains provisions not yet in force. The cases
 * follow the LGU2 API's ProspectiveSignalsTest, except those for a
 * sub-provision and the section holding it, which are the MCP's own. The
 * payloads are constructed.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { payload, signalsOf } from '../helpers/metadata-payload.js';

const VALID = '2024-11-01';

/** The version can't be dated, so the response also contains prospective provisions. */
const UNDATEABLE = { version: 'prospective', versions: ['enacted', 'prospective'], prospective: true };
/** Dated by the start date in the content, with nothing prospective. */
const DATED = { version: '2024-10-01', versions: ['enacted', '2024-10-01'], prospective: undefined };
/** No date in the content, so dct:valid is the version, with nothing prospective. */
const UNDATED = { version: VALID, versions: ['enacted', VALID], prospective: undefined };
/** As UNDATED, but the response contains prospective provisions. */
const UNDATED_WITH_PROVISIONS = { ...UNDATED, prospective: true };

/** hasVersion links for the requested part of ukpga/2024/1, with the given titles and `current`. */
function links(path: string, ...titles: string[]): string {
  const base = path ? `ukpga/2024/1/${path}` : 'ukpga/2024/1';
  return [...titles, 'current']
    .map(title => `<atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/${base}/${title}" title="${title}"/>`)
    .join('\n');
}

/** Schedule 1, requested unversioned, with the given attributes on the Schedule. */
function schedule(attributes: string, options: { status?: string; titles?: string[]; body?: string } = {}): string {
  const { status = 'revised', titles = ['enacted'], body = '<P><Text>Text.</Text></P>' } = options;
  return payload({
    identifier: 'schedule/1',
    valid: status === 'final' ? undefined : VALID,
    status,
    links: links('schedule/1', ...titles),
    content: `
<Primary><Body/><Schedules>
  <Schedule id="schedule-1" ${attributes}>
    <Number>Schedule 1</Number>
    <ScheduleBody>${body}</ScheduleBody>
  </Schedule>
</Schedules></Primary>`,
  });
}

/** Paragraph 1 of a schedule, in a P1group with the given attributes. */
function paragraph(p1groupAttributes: string, p1Attributes = ''): string {
  return `
<P1group ${p1groupAttributes}>
  <Title>Heading</Title>
  <P1 id="schedule-1-paragraph-1" ${p1Attributes}><Pnumber>1</Pnumber><P1para><Text>Text.</Text></P1para></P1>
</P1group>`;
}

/**
 * Section 2, requested unversioned as `identifier`, under a crossheading. The
 * attributes go on the crossheading, the section's P1group and P1, its
 * subsection (1), paragraph (a) of that subsection, and its subsection (2).
 */
function section(
  identifier: string,
  attributes: { pblock?: string; p1group?: string; p1?: string; p2?: string; p3?: string; sibling?: string },
  status = 'revised'
): string {
  return payload({
    identifier,
    valid: status === 'final' ? undefined : VALID,
    status,
    links: links(identifier, 'enacted'),
    content: `
<Primary><Body>
  <Pblock ${attributes.pblock ?? ''}>
    <Title>Crossheading</Title>
    <P1group ${attributes.p1group ?? ''}>
      <Title>Heading</Title>
      <P1 id="section-2" ${attributes.p1 ?? ''}>
        <Pnumber>2</Pnumber>
        <P1para>
          <P2 id="section-2-1" ${attributes.p2 ?? ''}>
            <Pnumber>1</Pnumber>
            <P2para>
              <Text>Text.</Text>
              <P3 id="section-2-1-a" ${attributes.p3 ?? ''}>
                <Pnumber>a</Pnumber>
                <P3para><Text>Text.</Text></P3para>
              </P3>
            </P2para>
          </P2>
          <P2 id="section-2-2" ${attributes.sibling ?? ''}>
            <Pnumber>2</Pnumber>
            <P2para><Text>Text.</Text></P2para>
          </P2>
        </P1para>
      </P1>
    </P1group>
  </Pblock>
</Body></Primary>`,
  });
}

/** The whole of ukpga/2024/1, requested unversioned, with attributes on its root and on section 2's P1group. */
function wholeDocument(rootAttributes: string, sectionAttributes = ''): string {
  return payload({
    valid: VALID,
    links: links('', 'enacted'),
    rootAttributes,
    content: `<Primary><Body><P1group ${sectionAttributes}><Title>Heading</Title><P1 id="section-2"><Pnumber>2</Pnumber></P1></P1group></Body></Primary>`,
  });
}

// --- The marking and the start date ---

test('a target marked prospective with no start date is undateable', () => {
  assert.deepStrictEqual(signalsOf(schedule('Status="Prospective"'), 'fragment'), UNDATEABLE);
});

// As ukpga/2023/50/schedule/2: a start date is a date the version can be labelled with.
test('a target marked prospective with a start date is dated by it', () => {
  assert.deepStrictEqual(signalsOf(schedule('Status="Prospective" RestrictStartDate="2024-10-01"'), 'fragment'), DATED);
});

for (const value of ['', 'not a date']) {
  test(`a marked target with RestrictStartDate=${JSON.stringify(value)} is not undateable: the attribute is present`, () => {
    assert.deepStrictEqual(signalsOf(schedule(`Status="Prospective" RestrictStartDate="${value}"`), 'fragment'), UNDATED);
  });
}

// As ukpga/2003/44/schedule/31: the marking that keeps a provision out of every
// dated snapshot is what leaves its version with no date.
test('a marked target is undateable even when Match="false"', () => {
  assert.deepStrictEqual(signalsOf(schedule('Status="Prospective" Match="false"'), 'fragment'), UNDATEABLE);
});

test('an unmarked fragment contains no prospective provisions', () => {
  assert.deepStrictEqual(signalsOf(schedule(''), 'fragment'), UNDATED);
});

// --- Reading @Status as a list ---

for (const value of ['Repealed Prospective', 'Prospective Repealed', 'Repealed\tProspective', 'Repealed\nProspective', 'Repealed\r\nProspective', '  Prospective  ']) {
  test(`Prospective is found as one of the values in Status=${JSON.stringify(value)}`, () => {
    assert.deepStrictEqual(signalsOf(schedule(`Status="${value}"`), 'fragment'), UNDATEABLE);
  });
}

// legislation.gov.uk writes some characters in attribute values as numeric references.
for (const value of ['Repealed&#9;Prospective', 'Repealed&#x9;Prospective', 'Repealed&#10;Prospective', 'Repealed&#xA;Prospective', 'Prospe&#99;tive', 'Prospe&#x63;tive']) {
  test(`Prospective is found in Status=${JSON.stringify(value)}, with its references decoded`, () => {
    assert.deepStrictEqual(signalsOf(schedule(`Status="${value}"`), 'fragment'), UNDATEABLE);
  });
}

for (const value of ['NotProspective', 'prospective', 'Prospective,Repealed', 'Repealed', 'Repealed&amp;#9;Prospective']) {
  test(`Status=${JSON.stringify(value)} is not a prospective marking`, () => {
    assert.deepStrictEqual(signalsOf(schedule(`Status="${value}"`), 'fragment'), UNDATED);
  });
}

// --- A P1 and its P1group ---

// As ukpga/2026/19/section/1: for a P1 the marking usually sits on the P1group.
test('a P1 is undateable when its P1group is marked with no start date', () => {
  assert.deepStrictEqual(signalsOf(section('section/2', { p1group: 'Status="Prospective"' }), 'fragment'), UNDATEABLE);
});

test('a P1 marked with no start date is undateable', () => {
  assert.deepStrictEqual(signalsOf(section('section/2', { p1: 'Status="Prospective"' }), 'fragment'), UNDATEABLE);
});

// The P1 and its P1group are tested separately: either one qualifies on its own.
test('a dated P1 is undateable when its P1group is marked with no start date', () => {
  const xml = section('section/2', { p1group: 'Status="Prospective"', p1: 'RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATEABLE);
});

test('a P1 marked with no start date is undateable when its P1group is dated', () => {
  const xml = section('section/2', { p1group: 'RestrictStartDate="2024-10-01"', p1: 'Status="Prospective"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATEABLE);
});

test('a P1 marked with a start date, in an unmarked P1group, is dated', () => {
  const xml = section('section/2', { p1: 'Status="Prospective" RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), DATED);
});

test('a P1 in a P1group marked with a start date is dated', () => {
  const xml = section('section/2', { p1group: 'Status="Prospective" RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), DATED);
});

// A P1group can also hold a P. With no P1 at or above the target, only the
// target is tested, as in the API: a P1group may hold more than one provision.
// The P1group is not inside the target, so it is not one of the target's
// provisions either.
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
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATED);
});

// --- A sub-provision and the section holding it ---

// Testing the elements between a sub-provision and its P1 goes beyond the
// LGU2 API, which tests only the target and, for a P1, its P1group.

// As ukpga/2026/19/section/2/1: the marking sits on the section's P1group.
test('a subsection is undateable when its section\'s P1group is marked with no start date', () => {
  assert.deepStrictEqual(signalsOf(section('section/2/1', { p1group: 'Status="Prospective"' }), 'fragment'), UNDATEABLE);
});

test('a subsection is undateable when its section is marked with no start date', () => {
  assert.deepStrictEqual(signalsOf(section('section/2/1', { p1: 'Status="Prospective"' }), 'fragment'), UNDATEABLE);
});

test('a paragraph is undateable when the subsection holding it is marked, in a dated, unmarked section', () => {
  const xml = section('section/2/1/a', { p1: 'RestrictStartDate="2024-10-01"', p2: 'Status="Prospective"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATEABLE);
});

test('a subsection of a section marked with a start date is dated', () => {
  const xml = section('section/2/1', { p1group: 'Status="Prospective" RestrictStartDate="2024-10-01"' });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), DATED);
});

test('a subsection is not undateable because a sibling is marked', () => {
  assert.deepStrictEqual(signalsOf(section('section/2/1', { sibling: 'Status="Prospective"' }), 'fragment'), UNDATED);
});

// Markings above the section are not tested. In real payloads, a section
// inside a marked crossheading, Part or Schedule is marked itself.
test('a subsection is not undateable because the crossheading above its section is marked', () => {
  assert.deepStrictEqual(signalsOf(section('section/2/1', { pblock: 'Status="Prospective"' }), 'fragment'), UNDATED);
});

test('final text: a subsection of a marked section is not undateable, and the field is left out', () => {
  const xml = section('section/2/1', { p1group: 'Status="Prospective"', p2: 'Status="Prospective"' }, 'final');
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), { version: 'enacted', versions: ['enacted'], prospective: undefined });
});

// --- Markings inside the target ---

test('a marked sub-provision requested directly is undateable', () => {
  assert.deepStrictEqual(signalsOf(section('section/2/1', { p2: 'Status="Prospective"' }), 'fragment'), UNDATEABLE);
});

test('a marking inside the target is a prospective provision, but the version stays dated', () => {
  assert.deepStrictEqual(signalsOf(section('section/2', { p2: 'Status="Prospective"' }), 'fragment'), UNDATED_WITH_PROVISIONS);
});

// As the Victims and Courts Act 2026, whose markings are all Match="false".
test('a marked provision counts when it is Match="false"', () => {
  const xml = schedule('', { body: paragraph('Status="Prospective" Match="false"') });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATED_WITH_PROVISIONS);
});

test('a marked provision counts inside an element that is Match="false"', () => {
  const xml = schedule('', { body: paragraph('Match="false"', 'Status="Prospective"') });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATED_WITH_PROVISIONS);
});

test('a provision marked with a start date is not a prospective provision', () => {
  const xml = schedule('', { body: paragraph('Status="Prospective" RestrictStartDate="2024-10-01"') });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), DATED);
});

test('a provision\'s marking is read as a list too', () => {
  const xml = schedule('', { body: paragraph('Status="Repealed&#9;Prospective"') });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), UNDATED_WITH_PROVISIONS);
});

// --- Whole documents ---

test('a whole document is undateable when its root is marked with no start date', () => {
  assert.deepStrictEqual(signalsOf(wholeDocument('Status="Prospective"'), 'document'), UNDATEABLE);
});

test('a whole document whose root is marked with a start date is not undateable', () => {
  assert.deepStrictEqual(signalsOf(wholeDocument('Status="Prospective" RestrictStartDate="2024-10-01"'), 'document'), UNDATED);
});

// As ukpga/2026/18, a revised Act with provisions awaiting commencement and a dated version.
test('a whole document holding a marked provision has a dated version and contains prospective provisions', () => {
  assert.deepStrictEqual(signalsOf(wholeDocument('', 'Status="Prospective"'), 'document'), UNDATED_WITH_PROVISIONS);
});

test('an unmarked whole document contains no prospective provisions', () => {
  assert.deepStrictEqual(signalsOf(wholeDocument(''), 'document'), UNDATED);
});

// --- Responses that read no provision text ---

// Absence proves nothing on these responses, but a marking they do carry still counts.
function contents(entryAttributes: string): string {
  return payload({
    identifier: 'contents',
    valid: VALID,
    links: links('', 'enacted'),
    content: `<Contents><ContentsItem ContentRef="section-2" ${entryAttributes}/></Contents>`,
  });
}

test('a marked entry in a table of contents is a prospective provision', () => {
  assert.deepStrictEqual(signalsOf(contents('Match="false" Status="Prospective"'), 'document'), UNDATED_WITH_PROVISIONS);
});

test('a table of contents with no marked entry leaves the field out', () => {
  assert.deepStrictEqual(signalsOf(contents(''), 'document'), UNDATED);
});

// As /resources/data.xml, which has no body.
function metadataOnly(rootAttributes: string): string {
  return payload({ valid: VALID, links: links('', 'enacted'), rootAttributes, content: '' });
}

test('a metadata-only response keeps a marking on its root', () => {
  assert.deepStrictEqual(signalsOf(metadataOnly('Status="Prospective"'), 'document'), UNDATEABLE);
});

test('a metadata-only response with no marking leaves the field out', () => {
  assert.deepStrictEqual(signalsOf(metadataOnly(''), 'document'), UNDATED);
});

// --- Final text and the links ---

// Final text is not a statement about what is in force. Final payloads carry no
// markings in practice; these are here so the omission is shown to be the
// status doing it.
test('final text is never undateable and leaves the field out, whatever its markings', () => {
  const xml = schedule('Status="Prospective"', { status: 'final', body: paragraph('Status="Prospective"') });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), { version: 'enacted', versions: ['enacted'], prospective: undefined });
});

test('a prospective link does not make the version undateable', () => {
  const xml = schedule('RestrictStartDate="2024-10-01"', { titles: ['enacted', 'prospective'] });
  assert.deepStrictEqual(signalsOf(xml, 'fragment'), { ...DATED, versions: ['enacted', '2024-10-01', 'prospective'] });
});
