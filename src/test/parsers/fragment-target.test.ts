/**
 * Tests for how metadata-parser.ts finds the element a response is about
 * (findTarget), as it shows in `version`, `versions` and `prospective`. Each
 * part of the constructed document has its own date and markings, so a
 * request that reached the wrong part would get different values.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { payload, signalsOf } from '../helpers/metadata-payload.js';

const VALID = '2024-11-01';

/** hasVersion links with the given titles, and the `current` link. */
function links(...titles: string[]): string {
  return [...titles, 'current']
    .map(title => `<atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2024/1/${title}" title="${title}"/>`)
    .join('\n');
}

const LINKS = links('enacted');

/** A part dated by its content, with nothing prospective. */
function dated(date: string) {
  return { version: date, versions: ['enacted', date], prospective: undefined };
}

/** A part dated by its content, which contains prospective provisions. */
function datedWithProvisions(date: string) {
  return { ...dated(date), prospective: true };
}

/**
 * A document whose introduction, body, sections, schedules and two
 * Attachments containers each have their own date. Section 1, and so the
 * body, contains a prospective provision, and so does the second Attachments.
 * Section 1 links to section 2. The @DocumentURIs are under `base` and end
 * with `suffix`, the request's version and language. (Attachments occur in
 * treaties; finding them doesn't depend on the main element's name.)
 */
function document(suffix: string, base = 'ukpga/2024/1'): string {
  const uri = (path: string) => `http://www.legislation.gov.uk/${base}/${path}${suffix}`;
  return `
<Primary>
  <PrimaryPrelims DocumentURI="${uri('introduction')}" RestrictStartDate="2024-01-15"><Title>Title</Title></PrimaryPrelims>
  <Body DocumentURI="${uri('body')}">
    <P1group RestrictStartDate="2024-02-01">
      <P1 id="section-1" DocumentURI="${uri('section/1')}">
        <Pnumber>1</Pnumber>
        <P1para>
          <P2 id="section-1-1" DocumentURI="${uri('section/1/1')}" Status="Prospective">
            <Pnumber>1</Pnumber>
            <P2para><Text>See <InternalLink Ref="section-2" DocumentURI="${uri('section/2')}">section 2</InternalLink>.</Text></P2para>
          </P2>
        </P1para>
      </P1>
    </P1group>
    <P1group RestrictStartDate="2024-03-01">
      <P1 id="section-2" DocumentURI="${uri('section/2')}"><Pnumber>2</Pnumber><P1para><Text>Text.</Text></P1para></P1>
    </P1group>
  </Body>
  <Schedules>
    <Schedule id="schedule-1" DocumentURI="${uri('schedule/1')}" RestrictStartDate="2024-04-01">
      <Number>Schedule 1</Number>
      <ScheduleBody><P><Text>Text.</Text></P></ScheduleBody>
    </Schedule>
  </Schedules>
  <Attachments><Attachment RestrictStartDate="2024-05-01"><P><Text>Text.</Text></P></Attachment></Attachments>
  <Attachments><Attachment RestrictStartDate="2024-06-01"><P Status="Prospective"><Text>Text.</Text></P></Attachment></Attachments>
</Primary>`;
}

/** The request for `path` within ukpga/2024/1, with `suffix` on the request and every URI. */
function request(path: string, suffix: string): string {
  return payload({
    identifier: path + suffix,
    valid: VALID,
    links: LINKS,
    documentUri: `ukpga/2024/1${suffix}`,
    content: document(suffix),
  });
}

// --- Each kind of request, unversioned, dated and in Welsh ---

const EXPECTED = {
  introduction: dated('2024-01-15'),
  body: datedWithProvisions('2024-03-01'),
  'section/1': datedWithProvisions('2024-02-01'),
  // Section 1's link to section 2 comes first in the document. An
  // InternalLink's @DocumentURI names its destination, not the link.
  'section/2': dated('2024-03-01'),
  schedules: dated('2024-04-01'),
  annexes: dated('2024-04-01'),
  // The first Attachments container only, as in the API.
  attachments: dated('2024-05-01'),
};

const SUFFIXES = ['', `/${VALID}`, '/welsh', `/${VALID}/welsh`];

for (const [path, expected] of Object.entries(EXPECTED)) {
  for (const suffix of SUFFIXES) {
    test(`${path}${suffix} reads only its own part of the document`, () => {
      assert.deepStrictEqual(signalsOf(request(path, suffix)), expected);
    });
  }
}

// --- The order of the lookups ---

test('an element with the requested URI is the target before one with the matching id', () => {
  const xml = payload({
    identifier: 'section/2',
    valid: VALID,
    links: LINKS,
    content: `
<Primary><Body>
  <P1group RestrictStartDate="2024-02-01">
    <P1 id="section-2" Status="Prospective"><Pnumber>2</Pnumber></P1>
  </P1group>
  <P1group RestrictStartDate="2024-03-01">
    <P1 id="section-2A" DocumentURI="http://www.legislation.gov.uk/ukpga/2024/1/section/2"><Pnumber>2</Pnumber></P1>
  </P1group>
</Body></Primary>`,
  });
  assert.deepStrictEqual(signalsOf(xml), dated('2024-03-01'));
});

// As ukpga/1990/43/section/34 (the API's issue #50), whose versions'
// @DocumentURIs carry their extents, so that none is the requested URI. The
// alternative version is placed first, so a search that looked inside
// Versions would find the Scotland version's P1, which is marked prospective.
test('a provision whose URIs carry extents is found by its id, outside Versions', () => {
  const uri = 'http://www.legislation.gov.uk/ukpga/2024/1/section/2';
  const xml = payload({
    identifier: 'section/2',
    valid: VALID,
    links: LINKS,
    content: `
<Versions>
  <Version id="v00001" Description="S">
    <P1group RestrictExtent="S" RestrictStartDate="2024-02-01">
      <P1 id="section-2" DocumentURI="${uri}/scotland" Status="Prospective"><Pnumber>2</Pnumber></P1>
    </P1group>
  </Version>
</Versions>
<Primary><Body>
  <P1group AltVersionRefs="v00001" RestrictExtent="E+W" RestrictStartDate="2024-03-01">
    <P1 id="section-2" DocumentURI="${uri}/england+wales"><Pnumber>2</Pnumber></P1>
  </P1group>
</Body></Primary>`,
  });
  assert.deepStrictEqual(signalsOf(xml), dated('2024-03-01'));
});

// --- Identifiers the URI parser can't read ---

/** A request for `path` within a treaty, whose identifiers parseLegislationUri can't read. */
function treaty(path: string, versionLinks = LINKS, content = document('', 'eut/euratom')): string {
  return payload({
    uri: path ? `eut/euratom/${path}` : 'eut/euratom',
    valid: VALID,
    links: versionLinks,
    documentUri: 'eut/euratom',
    content,
  });
}

test('a treaty\'s attachments are found without the URI parser', () => {
  assert.deepStrictEqual(signalsOf(treaty('attachments')), dated('2024-05-01'));
});

const WHOLE_TREATY = { version: VALID, versions: ['enacted', VALID], prospective: true };

test('a whole treaty is found by its URI', () => {
  assert.deepStrictEqual(signalsOf(treaty('')), WHOLE_TREATY);
});

test('a treaty\'s table of contents is found by its URI without /contents', () => {
  assert.deepStrictEqual(signalsOf(treaty('contents')), WHOLE_TREATY);
});

// The URI parser reads eut/euratom/section/1 as a whole document, with the
// regnal year euratom/section.
test('a treaty\'s provision is found by its URI, which the URI parser misreads', () => {
  assert.deepStrictEqual(signalsOf(treaty('section/1')), datedWithProvisions('2024-02-01'));
});

// Nothing has the requested URI, so nothing is inspected: the body's
// prospective provision doesn't count. With a dated link, dct:valid isn't
// added to `versions` either, as it would be for a whole document. The URI
// parser rejects eut/euratom/annex/I, and reads eut/euratom/article/9 as a
// whole document.
const NOT_FOUND = { version: '2024-07-01', versions: ['enacted', '2024-07-01'], prospective: undefined };

for (const path of ['annex/I', 'article/9']) {
  test(`${path} of a treaty, which isn't found, reads nothing`, () => {
    assert.deepStrictEqual(signalsOf(treaty(path, links('enacted', '2024-07-01'))), NOT_FOUND);
  });
}

// The URI parser reads eut/euratom/article/9/paragraph/2 as paragraph 2 of a
// document eut/euratom/article/9, so the id would be paragraph-2.
test('an id read from a misread treaty identifier is not looked up', () => {
  const xml = treaty('article/9/paragraph/2', links('enacted', '2024-07-01'), `
<EURetained><Body DocumentURI="http://www.legislation.gov.uk/eut/euratom/body">
  <P1group RestrictStartDate="2024-03-01">
    <P1 id="paragraph-2" Status="Prospective"><Pnumber>2</Pnumber></P1>
  </P1group>
</Body></EURetained>`);
  assert.deepStrictEqual(signalsOf(xml), NOT_FOUND);
});

// --- An identifier with a regnal year ---

/** A request for `path` within ukpga/Geo5/4-5/12, an Act cited by regnal year, whose root has the URI `rootPath`. */
function regnal(path: string, rootPath: string): string {
  return payload({
    uri: path ? `ukpga/Geo5/4-5/12/${path}` : 'ukpga/Geo5/4-5/12',
    valid: VALID,
    links: LINKS,
    documentUri: rootPath,
    content: `
<Primary><Body>
  <P1group RestrictStartDate="2024-03-01">
    <P1 id="section-2"><Pnumber>2</Pnumber><P1para><P Status="Prospective"><Text>Text.</Text></P></P1para></P1>
  </P1group>
</Body></Primary>`,
  });
}

// Nothing in the document has a @DocumentURI, so these use the steps that
// rely on the URI parser, which reads a regnal year.
test('a provision of an Act with a regnal year is found by its id', () => {
  assert.deepStrictEqual(signalsOf(regnal('section/2', 'ukpga/Geo5/4-5/12')), datedWithProvisions('2024-03-01'));
});

test('an Act with the same number in another regnal year is another document', () => {
  assert.deepStrictEqual(signalsOf(regnal('section/2', 'ukpga/Geo5/5-6/12')), { version: VALID, versions: ['enacted', VALID], prospective: undefined });
});

// The root's URI carries a version the request doesn't, so only the
// identifiers' type, year and number show it is the same document.
test('an Act with a regnal year is the whole document when its root\'s URI differs from the request', () => {
  assert.deepStrictEqual(signalsOf(regnal('', `ukpga/Geo5/4-5/12/${VALID}`)), { version: VALID, versions: ['enacted', VALID], prospective: true });
});
