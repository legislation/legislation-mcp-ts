/**
 * Tests for get-legislation-metadata helpers and endpoint selection
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { filterEffectsForFragment } from '../../tools/get-legislation-metadata.js';
import { UnappliedEffect } from '../../parsers/metadata-parser.js';
import * as metadata from '../../tools/get-legislation-metadata.js';

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
