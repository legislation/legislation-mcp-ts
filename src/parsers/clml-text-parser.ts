/**
 * Parses CLML (Crown Legislation Markup Language) XML into a semantic Document tree.
 *
 * Pure functions — no class, no mutable state. The Document tree is then
 * serialized to plain text by clml-text-serializer.ts.
 */

import { DOMParser } from '@xmldom/xmldom';
import { parseLegislationUri } from '../utils/legislation-uri.js';
import type {
  Document, Division, DivisionName, Provision, SubProvision,
  Paragraph, Schedule, Block, Text, Table, Figure, BlockAmendment,
  List, Footnote, NumberedParagraph,
} from './clml-types.js';

// --- Public API ---

export function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const startNode = findFragmentTarget(doc) ?? doc.documentElement;
  return parseDocument(startNode);
}

// --- Top-level dispatch ---

function parseDocument(root: Element): Document {
  // If the root IS a structural element (fragment), parse it directly
  const structural = parseDivisionOrProvision(root);
  if (structural) {
    return { type: 'document', prelims: [], body: [structural], schedules: [] };
  }

  // Standalone P2 fragment — treat as a provision
  const pMatch = root.localName.match(/^P(\d+)$/);
  if (pMatch) {
    const level = parseInt(pMatch[1], 10);
    if (level >= 2) {
      return { type: 'document', prelims: [], body: [parseProvisionAtAnyLevel(root, level)], schedules: [] };
    }
  }

  // If the root is a Schedule, wrap it
  if (root.localName === 'Schedule') {
    return { type: 'document', prelims: [], body: [], schedules: [parseSchedule(root)] };
  }

  // If the root is Schedules wrapper
  if (root.localName === 'Schedules') {
    return { type: 'document', prelims: [], body: [], schedules: parseSchedules(root) };
  }

  // Prelims as root element (fragment)
  if (root.localName === 'PrimaryPrelims' || root.localName === 'SecondaryPrelims') {
    return { type: 'document', prelims: parsePrelims(root), body: [], schedules: [] };
  }
  if (root.localName === 'EUPrelims') {
    return { type: 'document', prelims: parseEUPrelims(root), body: [], schedules: [] };
  }

  // Standalone block element (Tabular, etc.)
  if (isKnownBlockTag(root.localName)) {
    return { type: 'document', prelims: parseBlockElement(root), body: [], schedules: [] };
  }

  // Otherwise walk through wrappers (Legislation, Primary, Body, etc.)
  const result: Document = { type: 'document', prelims: [], body: [], schedules: [] };
  collectDocument(root, result);
  return result;
}

function collectDocument(el: Element, doc: Document): void {
  for (const child of childElements(el)) {
    const name = child.localName;

    // Skip metadata and contents
    if (name === 'Metadata' || name === 'Commentaries' || name === 'Commentary'
        || name === 'CommentaryRef' || name === 'Contents') continue;

    // Prelims
    if (name === 'PrimaryPrelims' || name === 'SecondaryPrelims') {
      doc.prelims.push(...parsePrelims(child));
      continue;
    }
    if (name === 'EUPrelims') {
      doc.prelims.push(...parseEUPrelims(child));
      continue;
    }

    // Schedules
    if (name === 'Schedules') {
      doc.schedules.push(...parseSchedules(child));
      continue;
    }
    if (name === 'Schedule') {
      doc.schedules.push(parseSchedule(child));
      continue;
    }

    // Structural elements
    const structural = parseDivisionOrProvision(child);
    if (structural) {
      doc.body.push(structural);
      continue;
    }

    // Known block elements at body level (Footnotes, tables, etc.)
    if (isKnownBlockTag(name)) {
      doc.body.push(...parseBlockElement(child));
      continue;
    }

    // Wrappers — recurse
    collectDocument(child, doc);
  }
}

const KNOWN_BLOCK_TAGS = new Set([
  'Text', 'Tabular', 'Figure', 'Image', 'BlockAmendment',
  'UnorderedList', 'OrderedList', 'Footnote', 'FootnoteRef', 'Division',
]);

function isKnownBlockTag(name: string): boolean {
  return KNOWN_BLOCK_TAGS.has(name);
}

// --- Divisions and Provisions dispatch ---

/** Tag → DivisionName mapping for named divisions */
const DIVISION_TAGS: Record<string, DivisionName> = {
  Part: 'part',
  Chapter: 'chapter',
  Pblock: 'crossHeading',
  PsubBlock: 'subHeading',
  EUPart: 'part',
  EUTitle: 'groupOfParts',
  EUChapter: 'chapter',
  EUSection: 'crossHeading',
  EUSubsection: 'subHeading',
};

function parseDivisionOrProvision(el: Element): Division | Provision | null {
  const name = el.localName;

  if (name in DIVISION_TAGS) {
    return parseDivision(el, DIVISION_TAGS[name]);
  }
  if (name === 'P1group') {
    return parseP1group(el);
  }
  if (name === 'P1') {
    return parseProvision(el);
  }
  return null;
}

// --- Division ---

function parseDivision(el: Element, divName: DivisionName): Division {
  let number: string | undefined;
  let title = '';
  const children: (Division | Provision)[] = [];

  for (const child of childElements(el)) {
    const tag = child.localName;
    if (tag === 'Number') {
      number = textContent(child);
    } else if (tag === 'Title') {
      title = textContent(child);
    } else {
      collectDivisionChildren(child, children);
    }
  }

  return { type: 'division', name: divName, number, title, children };
}

function collectDivisionChildren(el: Element, out: (Division | Provision)[]): void {
  // Try structural parse first
  const structural = parseDivisionOrProvision(el);
  if (structural) {
    out.push(structural);
    return;
  }

  // Known block elements — wrap in a dummy leaf provision
  if (isKnownBlockTag(el.localName)) {
    const blocks = parseBlockElement(el);
    if (blocks.length > 0) {
      out.push({ type: 'provision', number: '', variant: 'leaf', content: blocks } as Provision);
    }
    return;
  }

  // Wrapper elements — recurse into children
  for (const child of childElements(el)) {
    collectDivisionChildren(child, out);
  }
}

// --- P1group → Provision with title ---

function parseP1group(el: Element): Provision {
  let groupTitle = '';
  let p1El: Element | null = null;

  for (const child of childElements(el)) {
    if (child.localName === 'Title') {
      groupTitle = textContent(child);
    } else if (child.localName === 'P1') {
      p1El = child;
    }
  }

  return parseProvision(p1El ?? el, groupTitle || undefined);
}

// --- Provision (P1) ---

function parseProvision(el: Element, title?: string): Provision {
  let number = '';
  const paraEls: Element[] = [];

  for (const child of childElements(el)) {
    if (child.localName === 'Pnumber') {
      number = textContent(child);
    } else if (child.localName === 'P1para') {
      paraEls.push(child);
    }
  }

  return buildLeafOrBranch(
    paraEls,
    (child) => parseSubOrParagraph(child),
    (blocks) => ({ type: 'subProvision', number: '', variant: 'leaf', content: blocks }) as SubProvision,
    (variant) => {
      if (variant.kind === 'leaf') {
        return { type: 'provision', number, title, variant: 'leaf', content: variant.blocks } as Provision;
      }
      return { type: 'provision', number, title, variant: 'branch', intro: variant.intro, children: variant.children, wrapUp: variant.wrapUp } as Provision;
    },
  );
}

/** Parse a standalone P2+ fragment as a Provision (for fragment root elements). */
function parseProvisionAtAnyLevel(el: Element, level: number): Provision {
  let number = '';
  const paraTag = `P${level}para`;
  const paraEls: Element[] = [];

  for (const child of childElements(el)) {
    if (child.localName === 'Pnumber') {
      number = textContent(child);
    } else if (child.localName === paraTag) {
      paraEls.push(child);
    }
  }

  const childParser = level <= 2
    ? (child: Element) => parseSubOrParagraph(child)
    : (child: Element) => parseParagraphElement(child);

  return buildLeafOrBranch(
    paraEls,
    childParser,
    (blocks) => ({ type: 'subProvision', number: '', variant: 'leaf', content: blocks }) as SubProvision,
    (variant) => {
      if (variant.kind === 'leaf') {
        return { type: 'provision', number, variant: 'leaf', content: variant.blocks } as Provision;
      }
      return { type: 'provision', number, variant: 'branch', intro: variant.intro, children: variant.children, wrapUp: variant.wrapUp } as Provision;
    },
  );
}

// --- SubProvision (P2) ---

function parseSubProvision(el: Element): SubProvision {
  let number = '';
  const paraEls: Element[] = [];

  for (const child of childElements(el)) {
    if (child.localName === 'Pnumber') {
      number = textContent(child);
    } else if (child.localName === 'P2para') {
      paraEls.push(child);
    }
  }

  return buildLeafOrBranch(
    paraEls,
    (child) => parseParagraphElement(child),
    (blocks) => ({ type: 'paragraph', number: '', variant: 'leaf', content: blocks }) as Paragraph,
    (variant) => {
      if (variant.kind === 'leaf') {
        return { type: 'subProvision', number, variant: 'leaf', content: variant.blocks } as SubProvision;
      }
      return { type: 'subProvision', number, variant: 'branch', intro: variant.intro, children: variant.children, wrapUp: variant.wrapUp } as SubProvision;
    },
  );
}

// --- Paragraph (P3, P4, P5, ...) ---

function parseParagraphAtLevel(el: Element, level: number): Paragraph {
  let number = '';
  const paraTag = `P${level}para`;
  const paraEls: Element[] = [];

  for (const child of childElements(el)) {
    if (child.localName === 'Pnumber') {
      number = textContent(child);
    } else if (child.localName === paraTag) {
      paraEls.push(child);
    }
  }

  const childLevel = level + 1;
  const childTag = `P${childLevel}`;

  return buildLeafOrBranch(
    paraEls,
    (child) => child.localName === childTag ? parseParagraphAtLevel(child, childLevel) : null,
    (blocks) => ({ type: 'paragraph', number: '', variant: 'leaf', content: blocks }) as Paragraph,
    (variant) => {
      if (variant.kind === 'leaf') {
        return { type: 'paragraph', number, variant: 'leaf', content: variant.blocks } as Paragraph;
      }
      return { type: 'paragraph', number, variant: 'branch', intro: variant.intro, children: variant.children, wrapUp: variant.wrapUp } as Paragraph;
    },
  );
}

/** Dispatch: is this element a P2 (SubProvision) or P3+ (Paragraph)? */
function parseSubOrParagraph(child: Element): SubProvision | Paragraph | null {
  if (child.localName === 'P2') return parseSubProvision(child);
  const m = child.localName.match(/^P(\d+)$/);
  if (m) {
    const level = parseInt(m[1], 10);
    if (level >= 3) return parseParagraphAtLevel(child, level);
  }
  return null;
}

function parseParagraphElement(child: Element): Paragraph | null {
  const m = child.localName.match(/^P(\d+)$/);
  if (m) {
    const level = parseInt(m[1], 10);
    if (level >= 3) return parseParagraphAtLevel(child, level);
  }
  return null;
}

// --- Generic leaf/branch detector ---

type LeafOrBranch<C> =
  | { kind: 'leaf'; blocks: Block[] }
  | { kind: 'branch'; intro: Block[]; children: C[]; wrapUp: Block[] };

function buildLeafOrBranch<C, R>(
  paraEls: Element[],
  tryParseChild: (el: Element) => C | null,
  wrapBlocks: (blocks: Block[]) => C,
  build: (variant: LeafOrBranch<C>) => R,
): R {
  const allBlocks: Block[] = [];
  const childEntries: { index: number; child: C }[] = [];

  for (const para of paraEls) {
    for (const child of expandGroups(childElements(para))) {
      const parsed = tryParseChild(child);
      if (parsed !== null) {
        childEntries.push({ index: allBlocks.length, child: parsed });
      } else {
        allBlocks.push(...parseBlockElement(child));
      }
    }
  }

  if (childEntries.length === 0) {
    return build({ kind: 'leaf', blocks: allBlocks });
  }

  const firstIdx = childEntries[0].index;
  const intro = allBlocks.slice(0, firstIdx);
  const children: C[] = [];
  // Walk child entries, wrapping any interstitial blocks as dummy children
  for (let i = 0; i < childEntries.length; i++) {
    if (i > 0) {
      const prevIdx = childEntries[i - 1].index;
      const currIdx = childEntries[i].index;
      const between = allBlocks.slice(prevIdx, currIdx);
      if (between.length > 0) {
        children.push(wrapBlocks(between));
      }
    }
    children.push(childEntries[i].child);
  }
  const lastIdx = childEntries[childEntries.length - 1].index;
  const wrapUp = allBlocks.slice(lastIdx);

  return build({ kind: 'branch', intro, children, wrapUp });
}

// --- Schedules ---

function parseSchedules(el: Element): Schedule[] {
  const schedules: Schedule[] = [];
  for (const child of childElements(el)) {
    if (child.localName === 'Schedule') {
      schedules.push(parseSchedule(child));
    }
    // Skip <Title>SCHEDULES</Title> wrapper title
  }
  return schedules;
}

function parseSchedule(el: Element): Schedule {
  let number = '';
  let title: string | undefined;
  let subtitle: string | undefined;
  let reference: string | undefined;
  const body: (Division | Provision | Block)[] = [];

  for (const child of childElements(el)) {
    const tag = child.localName;
    if (tag === 'Number') {
      number = textContent(child);
    } else if (tag === 'TitleBlock') {
      for (const tbChild of childElements(child)) {
        if (tbChild.localName === 'Title') title = textContent(tbChild);
        else if (tbChild.localName === 'Subtitle') subtitle = textContent(tbChild);
      }
    } else if (tag === 'Reference') {
      reference = textContent(child);
    } else if (tag === 'ScheduleBody') {
      parseScheduleBody(child, body);
    } else {
      // Direct structural children (no ScheduleBody wrapper)
      parseScheduleBody(child, body);
    }
  }

  return { type: 'schedule', number, title, subtitle, reference, body };
}

function parseScheduleBody(el: Element, body: (Division | Provision | Block)[]): void {
  for (const child of childElements(el)) {
    const structural = parseDivisionOrProvision(child);
    if (structural) {
      body.push(structural);
      continue;
    }
    const blocks = parseBlockElement(child);
    if (blocks.length) {
      body.push(...blocks);
      continue;
    }
    // Wrapper — recurse
    parseScheduleBody(child, body);
  }
}

// --- Prelims ---

function parsePrelims(el: Element): Block[] {
  const blocks: Block[] = [];

  for (const child of childElements(el)) {
    const name = child.localName;
    if (name === 'Title') {
      blocks.push({ type: 'text', content: `# ${textContent(child)}` });
    } else if (name === 'Number') {
      blocks.push({ type: 'text', content: textContent(child) });
    } else if (name === 'LongTitle') {
      blocks.push({ type: 'text', content: textContent(child) });
    } else if (name === 'DateOfEnactment' || name === 'MadeDate'
               || name === 'LaidDate' || name === 'ComingIntoForce') {
      blocks.push({ type: 'text', content: formatPrelimsDate(child) });
    } else if (name === 'SubjectInformation') {
      // Skip metadata
    } else if (name === 'PrimaryPreamble' || name === 'SecondaryPreamble') {
      for (const preambleChild of childElements(child)) {
        blocks.push({ type: 'text', content: extractText(preambleChild) });
      }
    }
  }

  return blocks;
}

function formatPrelimsDate(element: Element): string {
  const topParts: string[] = [];
  const clauses: string[] = [];
  for (const child of childElements(element)) {
    if (child.localName === 'ComingIntoForceClauses') {
      const clauseParts: string[] = [];
      for (const clauseChild of childElements(child)) {
        const text = textContent(clauseChild);
        if (text) clauseParts.push(text);
      }
      if (clauseParts.length) clauses.push(clauseParts.join(' '));
    } else {
      const text = textContent(child);
      if (text) topParts.push(text);
    }
  }
  const top = topParts.join(' ');
  if (clauses.length === 0) return top;
  return [top, ...clauses].filter(Boolean).join('\n');
}

function parseEUPrelims(el: Element): Block[] {
  const blocks: Block[] = [];

  for (const child of childElements(el)) {
    const name = child.localName;
    if (name === 'MultilineTitle') {
      const lines: string[] = [];
      for (const textEl of childElements(child)) {
        const text = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) lines.push(text);
      }
      blocks.push({ type: 'text', content: `# ${lines.join('\n')}` });
    } else if (name === 'EUPreamble') {
      // Recurse into preamble for Divisions and text
      for (const pc of childElements(child)) {
        if (pc.localName === 'Division') {
          blocks.push(parseNumberedParagraph(pc));
        } else if (pc.localName === 'CommentaryRef') {
          // skip
        } else {
          const text = extractText(pc);
          if (text) blocks.push({ type: 'text', content: text });
        }
      }
    } else if (name === 'CommentaryRef') {
      // Skip
    } else {
      const text = extractText(child);
      if (text) blocks.push({ type: 'text', content: text });
    }
  }

  return blocks;
}

// --- Block elements ---

function parseBlockElement(el: Element): Block[] {
  const name = el.localName;

  if (name === 'Text') {
    const content = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (content) return [{ type: 'text', content }];
    return [];
  }

  if (name === 'Tabular') return [parseTable(el)];

  if (name === 'Figure' || name === 'Image') {
    return [{ type: 'figure' } as Figure];
  }

  if (name === 'BlockAmendment') return [parseBlockAmendment(el)];

  if (name === 'UnorderedList') return [parseList(el, false)];
  if (name === 'OrderedList') return [parseList(el, true)];

  if (name === 'Footnote') return [parseFootnote(el)];
  if (name === 'FootnoteRef') {
    const content = textContent(el);
    return content ? [{ type: 'text', content }] : [];
  }

  if (name === 'Division') return [parseNumberedParagraph(el)];

  // Wrappers that contain block elements: P, Para, TitleBlock, etc.
  if (name === 'P' || name === 'Para' || name === 'TitleBlock'
      || name === 'IntroductoryText' || name === 'EnactingText') {
    const blocks: Block[] = [];
    for (const child of childElements(el)) {
      blocks.push(...parseBlockElement(child));
    }
    return blocks;
  }

  // Metadata elements to skip
  if (name === 'Metadata' || name === 'Commentaries' || name === 'Commentary'
      || name === 'CommentaryRef' || name === 'Contents') {
    return [];
  }

  // Table sub-elements handled within parseTable
  if (name === 'table' || name === 'tbody' || name === 'thead' || name === 'tfoot'
      || name === 'colgroup' || name === 'tr' || name === 'th' || name === 'td' || name === 'col') {
    return [];
  }

  // Unknown inline elements — extract text
  const content = textContent(el);
  if (content) return [{ type: 'text', content }];
  return [];
}

// --- Block type parsers ---

function parseTable(el: Element): Table {
  const rows: string[][] = [];
  collectTableRows(el, rows);
  return { type: 'table', rows };
}

function collectTableRows(el: Element, rows: string[][]): void {
  for (const child of childElements(el)) {
    if (child.localName === 'tr') {
      const cells: string[] = [];
      for (const cell of childElements(child)) {
        if (cell.localName === 'th' || cell.localName === 'td') {
          cells.push(textContent(cell));
        }
      }
      rows.push(cells);
    } else if (child.localName === 'col') {
      // skip
    } else {
      collectTableRows(child, rows);
    }
  }
}

function parseBlockAmendment(el: Element): BlockAmendment {
  const children: (Division | Provision | Block)[] = [];

  for (const child of childElements(el)) {
    // Try structural parse first
    const structural = parseDivisionOrProvision(child);
    if (structural) {
      children.push(structural);
      continue;
    }
    // Fall back to block parse
    const blocks = parseBlockElement(child);
    children.push(...blocks);
  }

  return { type: 'blockAmendment', children };
}

function parseList(el: Element, ordered: boolean): List {
  const items: Block[][] = [];
  for (const child of childElements(el)) {
    if (child.localName === 'ListItem') {
      const itemBlocks: Block[] = [];
      for (const itemChild of childElements(child)) {
        itemBlocks.push(...parseBlockElement(itemChild));
      }
      items.push(itemBlocks);
    }
  }
  return { type: 'list', ordered, items };
}

function parseFootnote(el: Element): Footnote {
  let number = '';
  let content = '';
  for (const child of childElements(el)) {
    if (child.localName === 'Number') {
      number = textContent(child);
    } else {
      const text = textContent(child);
      if (text) content = content ? content + ' ' + text : text;
    }
  }
  return { type: 'footnote', number, content };
}

function parseNumberedParagraph(el: Element): NumberedParagraph {
  let number = '';
  const children: Block[] = [];
  for (const child of childElements(el)) {
    if (child.localName === 'Number') {
      number = textContent(child);
    } else {
      children.push(...parseBlockElement(child));
    }
  }
  return { type: 'numberedParagraph', number, children };
}

// --- Fragment detection ---

function findFragmentTarget(doc: XMLDocument): Element | null {
  const identifiers = doc.getElementsByTagName('dc:identifier');
  if (identifiers.length === 0) return null;

  const uri = (identifiers[0].textContent || '').trim();
  if (!uri) return null;

  const parsed = parseLegislationUri(uri);
  if (!parsed?.fragment) return null;

  const targetId = parsed.fragment.replace(/\//g, '-');
  return findElementById(doc.documentElement, targetId);
}

function findElementById(node: Element, id: string): Element | null {
  if (node.getAttribute('id') === id) return node;

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) {
      const found = findElementById(child as Element, id);
      if (found) return found;
    }
  }
  return null;
}

// --- Helpers ---

function textContent(element: Element): string {
  return (element.textContent || '').trim();
}

/** Extract all text from an element, collapsing whitespace. */
function extractText(element: Element): string {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function* childElements(element: Element): Iterable<Element> {
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i];
    if (child.nodeType === 1) yield child as Element;
  }
}

/** Flatten group wrappers (e.g. P2group) so each child provision is yielded individually. */
function* expandGroups(elements: Iterable<Element>): Iterable<Element> {
  for (const el of elements) {
    if (el.localName.match(/^P\dgroup$/)) {
      yield* childElements(el);
    } else {
      yield el;
    }
  }
}
