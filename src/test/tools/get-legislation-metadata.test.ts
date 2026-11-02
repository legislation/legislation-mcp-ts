/**
 * Tests for get-legislation-metadata helpers, endpoint selection and request scope
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { filterEffectsForFragment } from '../../tools/get-legislation-metadata.js';
import { UnappliedEffect } from '../../parsers/metadata-parser.js';
import * as metadata from '../../tools/get-legislation-metadata.js';
import { changesFeed, effectXml, payload } from '../helpers/metadata-payload.js';

/** Minimal effect stub with only the fields filterEffectsForFragment inspects. */
function effect(refs: UnappliedEffect['target']['refs']): UnappliedEffect {
  return {
    type: 'substituted',
    applied: false,
    required: true,
    target: { id: '', type: '', year: 0, number: 0, title: '', refs },
    source: { id: '', type: '', year: 0, number: 0, title: '' },
    inForce: [],
  };
}

test('filterEffectsForFragment: exact match', () => {
  const effects = [effect([{ type: 'section', ref: 'section-12' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/12').length, 1);
});

test('filterEffectsForFragment: descendant ref matches parent fragment', () => {
  // Effect targets section-12-3 (a subsection); viewing section/12 (parent) should include it
  const effects = [effect([{ type: 'section', ref: 'section-12-3' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/12').length, 1);
});

test('filterEffectsForFragment: ancestor ref matches child fragment', () => {
  // Effect has schedule-4 as context ref; viewing schedule/4/paragraph/2 should include it
  const effects = [effect([{ type: 'section', ref: 'schedule-4' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'schedule/4/paragraph/2').length, 1);
});

test('filterEffectsForFragment: no-ref effect (whole act) always matches', () => {
  const effects = [effect(undefined)];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/5').length, 1);
});

test('filterEffectsForFragment: unrelated ref is excluded', () => {
  const effects = [effect([{ type: 'section', ref: 'section-99' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/12').length, 0);
});

test('filterEffectsForFragment: partial ID overlap without dash boundary does not match', () => {
  // section-1 should NOT match section/12 (section-12 does not start with section-1-)
  const effects = [effect([{ type: 'section', ref: 'section-1' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/12').length, 0);
});

test('filterEffectsForFragment: range matching', () => {
  // Range section-1 to section-5; viewing section/3 should match (between start and end)
  const effects = [effect([{ type: 'range', start: 'section-1', end: 'section-5' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/3').length, 1);
});

test('filterEffectsForFragment: range excludes outside fragment', () => {
  const effects = [effect([{ type: 'range', start: 'section-1', end: 'section-5' }])];
  assert.strictEqual(filterEffectsForFragment(effects, 'section/9').length, 0);
});

test('filterEffectsForFragment: schedule with paragraph range', () => {
  // Real-world pattern: Sch. 10 para. 1-5
  // Refs: [schedule-10, range(schedule-10-paragraph-1, schedule-10-paragraph-5)]
  const effects = [effect([
    { type: 'section', ref: 'schedule-10' },
    { type: 'range', start: 'schedule-10-paragraph-1', end: 'schedule-10-paragraph-5' },
  ])];

  // Viewing the whole schedule — matches via the section ref
  assert.strictEqual(filterEffectsForFragment(effects, 'schedule/10').length, 1);
  // Viewing a paragraph within the range — matches via range
  assert.strictEqual(filterEffectsForFragment(effects, 'schedule/10/paragraph/3').length, 1);
  // Viewing a different schedule — no match
  assert.strictEqual(filterEffectsForFragment(effects, 'schedule/11').length, 0);
});

test('filterEffectsForFragment: mixed effects filtered correctly', () => {
  const effects = [
    effect([{ type: 'section', ref: 'section-1' }]),
    effect([{ type: 'section', ref: 'section-2' }]),
    effect([{ type: 'section', ref: 'section-3' }]),
    effect(undefined), // whole-act
  ];
  const filtered = filterEffectsForFragment(effects, 'section/2');
  assert.strictEqual(filtered.length, 2, 'Should keep section-2 match and whole-act effect');
});

// --- Endpoint selection tests ---

const MINIMAL_XML = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

test('execute uses getDocumentMetadata for unversioned whole-document requests', async () => {
  const calls: string[] = [];
  const client = {
    getDocumentMetadata: async () => { calls.push('getDocumentMetadata'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getDocument: async () => { calls.push('getDocument'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getFragment: async () => { calls.push('getFragment'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    searchChanges: async () => { throw new Error('not expected'); },
  };
  await metadata.execute({ type: 'ukpga', year: '2020', number: '2' }, client as any);
  assert.deepStrictEqual(calls, ['getDocumentMetadata']);
});

test('execute uses getDocument for versioned whole-document requests', async () => {
  const calls: string[] = [];
  const client = {
    getDocumentMetadata: async () => { calls.push('getDocumentMetadata'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getDocument: async () => { calls.push('getDocument'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getFragment: async () => { calls.push('getFragment'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    searchChanges: async () => { throw new Error('not expected'); },
  };
  await metadata.execute({ type: 'ukpga', year: '2020', number: '2', version: 'enacted' }, client as any);
  assert.deepStrictEqual(calls, ['getDocument']);
});

test('execute uses getFragment for fragment requests', async () => {
  const calls: string[] = [];
  const client = {
    getDocumentMetadata: async () => { calls.push('getDocumentMetadata'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getDocument: async () => { calls.push('getDocument'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    getFragment: async () => { calls.push('getFragment'); return { kind: 'document' as const, content: MINIMAL_XML }; },
    searchChanges: async () => { throw new Error('not expected'); },
  };
  await metadata.execute({ type: 'ukpga', year: '2020', number: '2', fragment: 'section/1' }, client as any);
  assert.deepStrictEqual(calls, ['getFragment']);
});

// --- The request's scope ---

// The tool says whether a fragment was requested. Each payload below gives
// different versions under the other scope: read as a fragment, the date in
// the content is added; read as a whole document, it isn't, and dct:valid is
// added beside the first version.

const VALID = '2024-11-01';
const SCOPE_LINKS = ['enacted', 'current']
  .map(title => `<atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2024/1/${title}" title="${title}"/>`)
  .join('\n');
const SECTION = `
<Primary><Body>
  <P1group RestrictStartDate="2024-10-01">
    <P1 id="section-2" DocumentURI="http://www.legislation.gov.uk/ukpga/2024/1/section/2"><Pnumber>2</Pnumber></P1>
  </P1group>
</Body></Primary>`;
const DATED_BY_CONTENT = { version: '2024-10-01', versions: ['enacted', '2024-10-01'] };
const WHOLE_DOCUMENT = { version: VALID, versions: ['enacted', VALID] };

/** The `version` and `versions` the tool returns for this request, when every endpoint returns `xml`. */
async function versionsFrom(args: { fragment?: string; version?: string }, xml: string) {
  const response = { kind: 'document' as const, content: xml };
  const client = {
    getDocumentMetadata: async () => response,
    getDocument: async () => response,
    getFragment: async () => response,
    searchChanges: async () => { throw new Error('not expected'); },
  };
  const result = await metadata.execute({ type: 'ukpga', year: '2024', number: '1', ...args }, client as any);
  const { version, versions } = JSON.parse((result.content[0] as { text: string }).text);
  return { version, versions };
}

test('execute reads a fragment request as a fragment', async () => {
  const xml = payload({ identifier: 'section/2', valid: VALID, links: SCOPE_LINKS, content: SECTION });
  assert.deepStrictEqual(await versionsFrom({ fragment: 'section/2' }, xml), DATED_BY_CONTENT);
});

test('execute reads a whole-document request as the whole document', async () => {
  const xml = payload({ valid: VALID, links: SCOPE_LINKS, content: SECTION });
  assert.deepStrictEqual(await versionsFrom({}, xml), WHOLE_DOCUMENT);
});

test('execute reads a request for the contents fragment as the whole document', async () => {
  const xml = payload({ identifier: 'contents', valid: VALID, links: SCOPE_LINKS, content: SECTION });
  assert.deepStrictEqual(await versionsFrom({ fragment: 'contents' }, xml), WHOLE_DOCUMENT);
});

// --- The effects on the current text ---

// Each effect is outstanding, so `upToDate` is false whenever one is kept.

const ON_SECTIONS_1_AND_2 = [effectXml('UnappliedEffect', 'section/1'), effectXml('UnappliedEffect', 'section/2')].join('');
const FEED_ON_SECTIONS_1_AND_2 = changesFeed([effectXml('Effect', 'section/1'), effectXml('Effect', 'section/2')]);

/**
 * The provisions of the `unappliedEffects` the tool returns, and `upToDate`.
 * Every endpoint returns `xml`, and the changes API returns `feed` or fails.
 */
async function effectsFrom(args: { fragment?: string; version?: string }, xml: string, feed?: string) {
  const response = { kind: 'document' as const, content: xml };
  const searches: number[] = [];
  const client = {
    getDocumentMetadata: async () => response,
    getDocument: async () => response,
    getFragment: async () => response,
    searchChanges: async ({ page }: { page: number }) => {
      searches.push(page);
      if (feed === undefined) throw new Error('changes API unavailable');
      return feed;
    },
  };
  const result = await metadata.execute({ type: 'ukpga', year: '2024', number: '1', ...args }, client as any);
  const { unappliedEffects, upToDate } = JSON.parse((result.content[0] as { text: string }).text);
  const provisions = (unappliedEffects as UnappliedEffect[] | undefined)
    ?.map(e => e.target.refs?.map(ref => ref.type === 'section' ? ref.ref : `${ref.start}..${ref.end}`).join());
  return { provisions, upToDate, searched: searches.length > 0 };
}

test('execute keeps only the effects on a revised fragment', async () => {
  const xml = payload({ identifier: 'section/2', links: '', content: SECTION, effects: ON_SECTIONS_1_AND_2 });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'section/2' }, xml),
    { provisions: ['section-2'], upToDate: false, searched: false });
});

test('execute finds a revised fragment up to date when the outstanding effects are elsewhere', async () => {
  const xml = payload({ identifier: 'section/2', links: '', content: SECTION, effects: effectXml('UnappliedEffect', 'section/1') });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'section/2' }, xml),
    { provisions: [], upToDate: true, searched: false });
});

test('execute keeps every effect on a revised whole document', async () => {
  const xml = payload({ links: '', content: SECTION, effects: ON_SECTIONS_1_AND_2 });
  assert.deepStrictEqual(await effectsFrom({}, xml),
    { provisions: ['section-1', 'section-2'], upToDate: false, searched: false });
});

test('execute keeps every effect on a revised contents request', async () => {
  const xml = payload({ identifier: 'contents', links: '', content: SECTION, effects: ON_SECTIONS_1_AND_2 });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'contents' }, xml),
    { provisions: ['section-1', 'section-2'], upToDate: false, searched: false });
});

test('execute keeps only the fetched effects on an enacted fragment', async () => {
  const xml = payload({ identifier: 'section/2', links: '', content: SECTION, status: 'final' });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'section/2' }, xml, FEED_ON_SECTIONS_1_AND_2),
    { provisions: ['section-2'], upToDate: false, searched: true });
});

test('execute keeps every fetched effect on an enacted contents request', async () => {
  const xml = payload({ identifier: 'contents', links: '', content: SECTION, status: 'final' });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'contents' }, xml, FEED_ON_SECTIONS_1_AND_2),
    { provisions: ['section-1', 'section-2'], upToDate: false, searched: true });
});

test('execute leaves out the effects on enacted text when they cannot be fetched', async () => {
  const xml = payload({ identifier: 'section/2', links: '', content: SECTION, status: 'final' });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'section/2' }, xml),
    { provisions: undefined, upToDate: undefined, searched: true });
});

test('execute leaves out the effects on a versioned request', async () => {
  const xml = payload({ identifier: 'section/2', links: '', content: SECTION, effects: ON_SECTIONS_1_AND_2 });
  assert.deepStrictEqual(await effectsFrom({ fragment: 'section/2', version: '2024-10-01' }, xml),
    { provisions: undefined, upToDate: undefined, searched: false });
});
