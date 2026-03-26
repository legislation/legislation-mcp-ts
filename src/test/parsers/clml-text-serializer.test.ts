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
  Schedule, Block, Text, AppendText, Table, Figure, BlockAmendment, List,
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

test('unordered list preserves hanging indent for multiline items', () => {
  const list: List = {
    type: 'list', ordered: false,
    items: [
      [text('First line'), text('Second line')],
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The following item applies:'), list],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. The following item applies:\n\t- First line\n\t  Second line');
});

test('unordered list keeps block amendment prefixes within the hanging indent', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'provision', number: '5.', variant: 'leaf', content: [text('Amendment text.')] } as Provision,
    ],
  };
  const list: List = {
    type: 'list', ordered: false,
    items: [
      [text('After section 4 insert'), amendment],
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The following item applies:'), list],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. The following item applies:\n\t- After section 4 insert\n\t  \t> \u201c5. Amendment text.\u201d');
});

test('nested list renders at the next structural depth, not under outer continuation padding', () => {
  const inner: List = {
    type: 'list', ordered: false,
    items: [[text('inner item')]],
  };
  const outer: List = {
    type: 'list', ordered: false,
    items: [[text('outer item'), inner]],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The following item applies:'), outer],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. The following item applies:\n\t- outer item\n\t\t- inner item');
});

test('text after a nested list resumes at the outer item continuation indent', () => {
  const inner: List = {
    type: 'list', ordered: false,
    items: [[text('inner item')]],
  };
  const outer: List = {
    type: 'list', ordered: false,
    items: [[text('outer item'), inner, text('after inner list')]],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('The following item applies:'), outer],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. The following item applies:\n\t- outer item\n\t\t- inner item\n\t  after inner list');
});

test('block amendment is indented with block quote and curly double quotes', () => {
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
  assert.ok(result.includes('\t> \u201c5. New section five text.\u201d'), 'Block amendment should use curly double quotes');
});

test('amendment-only provision uses a single line break before amendment content', () => {
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
    content: [amendment],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. \n\t> \u201c5. New section five text.\u201d');
});

test('block amendment with format="double" uses curly double quotes', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    format: 'double',
    children: [{ type: 'provision', number: '3A.', variant: 'leaf', content: [text('New subsection text.')] } as Provision],
  };
  const prov: Provision = { type: 'provision', number: '1.', variant: 'leaf', content: [amendment] };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t> \u201c3A. New subsection text.\u201d'));
});

test('block amendment with format="single" uses curly single quotes', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    format: 'single',
    children: [{ type: 'provision', number: '3A.', variant: 'leaf', content: [text('New subsection text.')] } as Provision],
  };
  const prov: Provision = { type: 'provision', number: '1.', variant: 'leaf', content: [amendment] };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t> \u20183A. New subsection text.\u2019'));
});

test('block amendment with format="none" omits quotation marks', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    format: 'none',
    children: [{ type: 'provision', number: '3A.', variant: 'leaf', content: [text('New subsection text.')] } as Provision],
  };
  const prov: Provision = { type: 'provision', number: '1.', variant: 'leaf', content: [amendment] };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t> 3A. New subsection text.'));
  assert.ok(!result.includes('\u201c') && !result.includes('\u201d') && !result.includes('\u2018') && !result.includes('\u2019'));
});

test('format="none" amendment with run-on structure uses standard path: first Text child stays inside > block', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    format: 'none',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('first item.')] } as Provision,
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('After section 4 insert'), amendment],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t> the following\u2014'), 'first Text child is inside > block');
  assert.ok(!result.includes('insert\u2014'), 'no run-on: text not glued to lead-in');
  assert.ok(!result.includes('insertthe'), 'no run-on: text not glued to lead-in without space');
});

test('run-on amendment with AppendText: open quote before lead-in, close quote with AppendText on last line', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('first item;')] } as Provision,
      { type: 'provision', number: '(b)', variant: 'leaf', content: [text('second item.')] } as Provision,
    ],
  };
  const appendTextBlock: AppendText = { type: 'appendText', content: ';' };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('For paragraph (a) substitute'), amendment, appendTextBlock],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('substitute \u201cthe following\u2014'), 'open quote before lead-in');
  assert.ok(result.includes('second item.\u201d;'), 'close quote and AppendText on last line');
  assert.ok(!result.includes('\t> \u201c'), 'no open quote inside > block');
});

test('run-on amendment without AppendText: open quote before lead-in, close quote on last line', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('only item.')] } as Provision,
    ],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('For paragraph (a) substitute'), amendment],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('substitute \u201cthe following\u2014'), 'open quote before lead-in');
  assert.ok(result.includes('only item.\u201d'), 'close quote on last line');
  assert.ok(!result.includes('\t> \u201c'), 'no open quote inside > block');
});

test('single-Text-child amendment is standard case: both marks inside > block', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [{ type: 'text', content: 'any reference to a designated person.' } as Text],
  };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Omit subsection (2)\u2014'), amendment],
  };
  const result = serializeDocument(doc([prov]));
  assert.ok(result.includes('\t> \u201cany reference to a designated person.\u201d'), 'both marks inside > block');
  assert.ok(!result.includes('(2)\u2014\u201c'), 'no mark on provision line');
});

test('in nested amendment, run-on pair followed by provision gets blank-line separator', () => {
  const innerAmendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('inserted item.')] } as Provision,
    ],
  };
  const outerAmendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'after section 4 insert' } as Text,
      innerAmendment,
      { type: 'provision', number: '5.', variant: 'leaf', content: [text('Existing section.')] } as Provision,
    ],
  };
  const prov: Provision = { type: 'provision', number: '1.', variant: 'leaf', content: [outerAmendment] };
  const result = serializeDocument(doc([prov]));
  const lines = result.split('\n');
  const idx = lines.findIndex(l => l.includes('5. Existing section.'));
  assert.ok(idx > 0, 'provision 5. should appear');
  assert.strictEqual(lines[idx - 1].trim(), '>', 'blank-line separator before provision following run-on pair');
});

test('body-level run-on amendment: open quote inline, close quote with AppendText attached', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('first item;')] } as Provision,
      { type: 'provision', number: '(b)', variant: 'leaf', content: [text('second item.')] } as Provision,
    ],
  };
  const appendTextBlock: AppendText = { type: 'appendText', content: ';' };
  const document: Document = {
    type: 'document',
    prelims: [],
    body: [
      { type: 'text', content: 'For paragraph (a) substitute' } as Text,
      amendment,
      appendTextBlock,
    ],
    schedules: [],
  };
  const result = serializeDocument(document);
  assert.ok(result.includes('substitute \u201cthe following\u2014'), 'open quote before lead-in at body level');
  assert.ok(result.includes('second item.\u201d;'), 'close quote and AppendText on last line');
  assert.ok(!result.includes('\t> \u201c'), 'no open quote inside > block');
});

test('body-level standalone block amendment consumes AppendText', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [{ type: 'text', content: 'new section text.' } as Text],
  };
  const appendTextBlock: AppendText = { type: 'appendText', content: ';' };
  const document: Document = {
    type: 'document',
    prelims: [],
    body: [amendment, appendTextBlock],
    schedules: [],
  };
  const result = serializeDocument(document);
  assert.ok(result.includes('new section text.\u201d;'), 'AppendText attached to closing mark');
  assert.ok(!result.includes('\u201d\n;'), 'AppendText not on its own line');
});

test('schedule-level run-on amendment: open quote inline, close quote with AppendText attached', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'text', content: 'the following\u2014' } as Text,
      { type: 'provision', number: '(a)', variant: 'leaf', content: [text('first item;')] } as Provision,
      { type: 'provision', number: '(b)', variant: 'leaf', content: [text('second item.')] } as Provision,
    ],
  };
  const schedule: Schedule = {
    type: 'schedule',
    number: 'Schedule 1',
    title: 'Test Schedule',
    body: [
      { type: 'text', content: 'For paragraph (a) substitute' } as Text,
      amendment,
      { type: 'appendText', content: ';' } as AppendText,
    ],
  };
  const result = serializeDocument(doc([], { schedules: [schedule] }));
  assert.ok(result.includes('## Schedule 1'), 'schedule heading is preserved');
  assert.ok(result.includes('substitute \u201cthe following\u2014'), 'open quote before lead-in at schedule level');
  assert.ok(result.includes('second item.\u201d;'), 'close quote and AppendText on last line');
  assert.ok(!result.includes('\t> \u201c'), 'no open quote inside > block');
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

test('empty numbered paragraph does not collapse into following block', () => {
  const np: NumberedParagraph = { type: 'numberedParagraph', number: '(1)', children: [] };
  const result = serializeDocument(doc([], { prelims: [np, text('Following text.')] }));
  assert.ok(!result.includes('(1) Following text.'), 'number and following text must be on separate lines');
  assert.ok(result.includes('(1)'), 'number is still present');
  assert.ok(result.includes('Following text.'), 'following text is still present');
});

test('amendment-only list item: bullet on its own line, then quoted block on next', () => {
  const amendment: BlockAmendment = {
    type: 'blockAmendment',
    children: [
      { type: 'provision', number: '5.', variant: 'leaf', content: [text('New text.')] } as Provision,
    ],
  };
  const list: List = { type: 'list', ordered: false, items: [[amendment]] };
  const prov: Provision = {
    type: 'provision', number: '1.', variant: 'leaf',
    content: [text('Items:'), list],
  };
  const result = serializeDocument(doc([prov]));
  assert.strictEqual(result, '1. Items:\n\t-\n\t  \t> \u201c5. New text.\u201d');
});

test('sibling P2 provisions in a fragment body have no blank line between them', () => {
  const prov1: Provision = { type: 'provision', number: '(1)', level: 2, variant: 'leaf', content: [text('First subsection.')] };
  const prov2: Provision = { type: 'provision', number: '(2)', level: 2, variant: 'leaf', content: [text('Second subsection.')] };
  const result = serializeDocument(doc([prov1, prov2]));
  assert.strictEqual(result, '(1) First subsection.\n(2) Second subsection.');
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
