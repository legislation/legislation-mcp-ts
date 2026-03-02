/**
 * Tests for the CLML text serializer.
 *
 * Each test constructs a Document tree by hand and verifies the serialized
 * plain-text output matches the formatting produced by the original monolithic parser.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { serializeDocument } from '../../parsers/clml-text-serializer.js';
import type {
  Document, Provision, SubProvision, Paragraph, Division,
  Schedule, Block, Text, Table, Figure, BlockAmendment, List,
  Footnote, NumberedParagraph,
} from '../../parsers/clml-types.js';

// --- Helpers ---

function text(content: string): Text {
  return { type: 'text', content };
}

function doc(body: (Division | Provision)[], opts?: {
  prelims?: Block[];
  schedules?: Schedule[];
}): Document {
  return {
    type: 'document',
    prelims: opts?.prelims ?? [],
    body,
    schedules: opts?.schedules ?? [],
  };
}

// --- Provisions ---

test('simple leaf provision', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('A person is guilty of theft if he dishonestly appropriates property.')],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. A person is guilty of theft if he dishonestly appropriates property.');
});

test('provision with title renders bold title', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', title: 'Basic definition of theft', variant: 'leaf',
    content: [text('A person is guilty of theft.')],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('1. **Basic definition of theft**'), 'Should format titled provision');
  assert.ok(result.includes('A person is guilty'), 'Should include body text');
});

test('provision with Article number preserves Article prefix', () => {
  const prov: Provision = {
    type: 'provision', number: 'Article 1.', title: 'Scope', variant: 'leaf',
    content: [text('This Regulation applies to all persons.')],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('Article 1. **Scope**'), 'Should use Article, not Section');
});

test('provision with subsections (branch)', () => {
  const prov: Provision = {
    type: 'provision', number: '2.', variant: 'branch',
    intro: [text('It is immaterial whether the appropriation is made with a view to gain.')],
    children: [
      { type: 'subProvision', number: '(1)', variant: 'leaf', content: [text('First subsection text.')] },
      { type: 'subProvision', number: '(2)', variant: 'leaf', content: [text('Second subsection text.')] },
    ],
    wrapUp: [],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('2. It is immaterial'), 'Should include section number and text');
  assert.ok(result.includes('(1) First subsection'), 'Should include first subsection');
  assert.ok(result.includes('(2) Second subsection'), 'Should include second subsection');
});

test('deeply nested provisions indent correctly', () => {
  const para_i: Paragraph = {
    type: 'paragraph', number: '(i)', variant: 'leaf',
    content: [text('Sub-paragraph i text.')],
  };
  const para_a: Paragraph = {
    type: 'paragraph', number: '(a)', variant: 'branch',
    intro: [text('Paragraph a text.')],
    children: [para_i],
    wrapUp: [],
  };
  const sub: SubProvision = {
    type: 'subProvision', number: '(1)', variant: 'branch',
    intro: [text('Subsection intro.')],
    children: [para_a],
    wrapUp: [],
  };
  const prov: Provision = {
    type: 'provision', number: '2.', variant: 'branch',
    intro: [],
    children: [sub],
    wrapUp: [],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t(a) Paragraph a text.'), 'P3 should be indented once');
  assert.ok(result.includes('\t\t(i) Sub-paragraph i text.'), 'P4 should be indented twice');
});

// --- Divisions ---

test('Part with number and title', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Overview of this Act.')],
  };
  const part: Division = {
    type: 'division', name: 'part', number: 'Part 1', title: 'Preliminary',
    children: [prov],
  };
  const result = serializeDocument(doc([part]));
  assert.ok(result.includes('## Part 1'), 'Should include Part number as heading');
  assert.ok(result.includes('## Preliminary'), 'Should include Part title as heading');
  assert.ok(result.includes('1. Overview'), 'Should include section content');
});

test('Chapter with number and title', () => {
  const prov: Provision = {
    type: 'provision', number: '5.', variant: 'leaf',
    content: [text('In this Act, references to property include money.')],
  };
  const chapter: Division = {
    type: 'division', name: 'chapter', number: 'Chapter 2', title: 'Interpretation',
    children: [prov],
  };
  const result = serializeDocument(doc([chapter]));
  assert.ok(result.includes('### Chapter 2'), 'Should include Chapter number as h3');
  assert.ok(result.includes('### Interpretation'), 'Should include Chapter title as h3');
  assert.ok(result.includes('5. In this Act'), 'Should include section content');
});

test('crossHeading (Pblock) with title', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Content of the block.')],
  };
  const cross: Division = {
    type: 'division', name: 'crossHeading', title: 'General provisions',
    children: [prov],
  };
  const result = serializeDocument(doc([cross]));
  assert.ok(result.includes('#### General provisions'), 'Should format crossHeading as h4');
  assert.ok(result.includes('1. Content'), 'Should include section content');
});

test('subHeading (PsubBlock) with title', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Content here.')],
  };
  const sub: Division = {
    type: 'division', name: 'subHeading', title: 'Minor offences',
    children: [prov],
  };
  const result = serializeDocument(doc([sub]));
  assert.ok(result.includes('##### Minor offences'), 'Should format subHeading as h5');
  assert.ok(result.includes('1. Content here.'), 'Should include section content');
});

// --- Schedules ---

test('Schedule with title and reference', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Schedule paragraph text.')],
  };
  const schedule: Schedule = {
    type: 'schedule', number: 'Schedule 1', title: 'Powers of Attorney',
    reference: 'Section 5',
    body: [prov],
  };
  const result = serializeDocument(doc([], { schedules: [schedule] }));
  assert.ok(result.includes('## Schedule 1'), 'Should format schedule number');
  assert.ok(result.includes('## Powers of Attorney'), 'Should format schedule title');
  assert.ok(result.includes('Section 5'), 'Should include reference');
  assert.ok(result.includes('1. Schedule paragraph text.'), 'Should include schedule body content');
});

test('Schedule with subtitle', () => {
  const prov: Provision = {
    type: 'provision', number: '1', variant: 'leaf',
    content: [text('Content.')],
  };
  const schedule: Schedule = {
    type: 'schedule', number: 'Schedule 2', title: 'Main Title',
    subtitle: 'A subtitle here',
    body: [prov],
  };
  const result = serializeDocument(doc([], { schedules: [schedule] }));
  assert.ok(result.includes('## Main Title'), 'Should include title');
  assert.ok(result.includes('## A subtitle here'), 'Should include subtitle');
});

// --- Blocks ---

test('table with header and rows', () => {
  const table: Table = {
    type: 'table',
    rows: [
      ['Expression', 'Modification'],
      ['IP completion day', 'exit day'],
      ['retained EU law', 'retained EU law governing the schemes'],
    ],
  };
  const result = serializeDocument(doc([], { prelims: [table] }));
  assert.ok(result.includes('| Expression | Modification |'), 'Should format header row with pipes');
  assert.ok(result.includes('| IP completion day | exit day |'), 'Should format data rows with pipes');
});

test('figure shows placeholder', () => {
  const figure: Figure = { type: 'figure' };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('See the diagram below.'), figure],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('See the diagram below.'), 'Should include text');
  assert.ok(result.includes('[Figure]'), 'Should include figure placeholder');
});

test('unordered list', () => {
  const list: List = {
    type: 'list', ordered: false,
    items: [
      [text('First item')],
      [text('Second item')],
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The following items:'), list],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('The following items:'), 'Should include intro text');
  assert.ok(result.includes('- First item'), 'Should include first list item');
  assert.ok(result.includes('- Second item'), 'Should include second list item');
});

test('block amendment is indented', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      {
        type: 'provision', number: '5.', variant: 'leaf',
        content: [text('New section five text.')],
      } as Provision,
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('For section 5 substitute:'), amendment],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('For section 5 substitute:'), 'Should include intro text');
  assert.ok(result.includes('\t5. New section five text.'), 'Block amendment should be indented');
});

test('footnotes with number and content', () => {
  const fn1: Footnote = { type: 'footnote', number: '1', content: 'First footnote.' };
  const fn2: Footnote = { type: 'footnote', number: '2', content: 'Second footnote.' };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('See note.')],
  };
  const result = serializeDocument(doc([prov], { prelims: [fn1, fn2] }));
  assert.ok(result.includes('1 First footnote.'), 'Should include first footnote');
  assert.ok(result.includes('2 Second footnote.'), 'Should include second footnote');
});

test('numbered paragraph', () => {
  const np: NumberedParagraph = {
    type: 'numberedParagraph', number: '(1)',
    children: [text('The protection of natural persons is a fundamental right.')],
  };
  const result = serializeDocument(doc([], { prelims: [np] }));
  assert.ok(result.includes('(1) The protection of natural persons is a fundamental right.'), 'Should format with number');
});

// --- Smart quotes ---

test('smart quote spacing is cleaned up', () => {
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The word \u201c theft \u201d means dishonest appropriation.')],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\u201ctheft\u201d'), 'Should remove spaces inside smart quotes');
});

// --- Full document ---

test('full document with prelims, body, and schedule', () => {
  const prelims: Block[] = [
    text('# Example Act 2024'),
    text('2024 CHAPTER 1'),
  ];
  const prov: Provision = {
    type: 'provision', number: '1.', title: 'Overview', variant: 'leaf',
    content: [text('This Act makes provision about examples.')],
  };
  const part: Division = {
    type: 'division', name: 'part', number: 'Part 1', title: 'Introduction',
    children: [prov],
  };
  const schedule: Schedule = {
    type: 'schedule', number: 'Schedule 1', title: 'Details',
    body: [
      {
        type: 'provision', number: '1.', variant: 'leaf',
        content: [text('Schedule content.')],
      } as Provision,
    ],
  };
  const result = serializeDocument(doc([part], { prelims, schedules: [schedule] }));
  assert.ok(result.includes('# Example Act 2024'), 'Should include prelims title');
  assert.ok(result.includes('2024 CHAPTER 1'), 'Should include prelims number');
  assert.ok(result.includes('## Part 1'), 'Should include Part number');
  assert.ok(result.includes('## Introduction'), 'Should include Part title');
  assert.ok(result.includes('1. **Overview**'), 'Should include section heading');
  assert.ok(result.includes('This Act makes provision'), 'Should include section text');
  assert.ok(result.includes('## Schedule 1'), 'Should include schedule number');
  assert.ok(result.includes('## Details'), 'Should include schedule title');
  assert.ok(result.includes('1. Schedule content.'), 'Should include schedule body');
});
