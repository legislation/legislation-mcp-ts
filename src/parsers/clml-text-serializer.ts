/**
 * Serializes the semantic document model to plain text with markdown-style headings.
 *
 * The serializer owns all presentation decisions: heading markers, indentation,
 * spacing, bold markers, table formatting. The parser resolves what the CLML means;
 * this module decides how it looks.
 *
 * Layout model:
 *   - A Writer manages line output, prefix stacks (indentation, block quotes),
 *     and hanging indents (list bullets)
 *   - Children own content — serialize functions write text without worrying about positioning
 *   - Parents own positioning — they decide separators (blankLine) between children
 *   - The writer owns prefix stacks — indentation and '> ' prefixes compose automatically
 *   - Numeric indent arguments represent structural depth for provision-style numbering;
 *     Writer scopes own prefixes that must persist across rendered lines
 */

import type {
  Document, Prelims, Division, DivisionName, Provision, SubProvision,
  Paragraph, Schedule, Block, Text, Table, BlockAmendment, List,
  NumberedParagraph,
} from './clml-types.js';

type LeadingSeparator = 'blank' | 'line';

const HEADING_MARKS: Record<DivisionName, string> = {
  groupOfParts: '##',
  part: '##',
  chapter: '###',
  crossHeading: '####',
  subHeading: '#####',
};

// --- Public API ---

export function serializeDocument(doc: Document): string {
  const w = new Writer();
  serializePrelims(w, doc.prelims);
  serializeBody(w, doc.body);
  for (const schedule of doc.schedules) {
    serializeSchedule(w, schedule);
  }
  return smartQuotes(w.toString().trim());
}

// --- Prelims ---

function serializePrelims(w: Writer, prelims: Prelims): void {
  for (const block of prelims) {
    serializeBlock(w, block, 0);
    w.blankLine();
  }
}

// --- Structure ---

function serializeBody(w: Writer, nodes: (Division | Provision | Block)[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[i + 1];
    if (node.type === 'division') {
      serializeDivision(w, node);
    } else if (node.type === 'provision') {
      serializeProvision(w, node, 0);
    } else if (isRunOnAmendment(node, next)) {
      w.write(node.content);
      if (!/[\s\u2014\u2013]$/.test(node.content)) w.write(' ');
      i = consumeRunOnAmendment(w, nodes, i, 0);
    } else if (node.type === 'blockAmendment') {
      const appendText = next?.type === 'appendText' ? next.content : undefined;
      serializeBlockAmendment(w, node, 0, appendText);
      if (appendText !== undefined) i++;
    } else {
      serializeBlock(w, node as Block, 0);
    }
  }
}

function serializeDivision(w: Writer, div: Division, leading: LeadingSeparator = 'blank'): void {
  const mark = HEADING_MARKS[div.name];
  applyLeadingSeparator(w, leading);
  if (div.number) {
    w.write(`${mark} ${div.number}`);
    w.endLine();
  }
  w.write(`${mark} ${div.title}`);
  w.endLine();
  serializeBody(w, div.children);
}

function serializeProvision(
  w: Writer,
  prov: Provision,
  indent: number,
  leading: LeadingSeparator = 'blank',
): void {
  // `indent` is structural depth for numbering tokens such as `1.`, `(1)`, `(a)`.
  // Multiline layout still belongs to the Writer within child serializers.
  if (prov.title) {
    applyLeadingSeparator(w, leading);
    w.write(`${prov.number} **${prov.title}**`);
    w.endLine();
  } else if (prov.number) {
    applyLeadingSeparator(w, leading);
    w.write(`${'\t'.repeat(indent)}${prov.number} `);
  }

  if (prov.variant === 'leaf') {
    serializeBlocks(w, prov.content, indent);
  } else {
    serializeBlocks(w, prov.intro, indent);
    serializeProvisionChildren(w, prov.children, indent);
    serializeBlocks(w, prov.wrapUp, indent);
  }
}

function serializeProvisionChildren(w: Writer, children: (SubProvision | Paragraph)[], indent: number): void {
  for (const child of children) {
    if (child.type === 'subProvision') {
      serializeSubProvision(w, child, indent);
    } else {
      serializeParagraph(w, child, indent + 1);
    }
  }
}

function serializeSubProvision(w: Writer, sub: SubProvision, indent: number): void {
  if (sub.number) {
    w.write(`${'\t'.repeat(indent)}${sub.number} `);
  }

  if (sub.variant === 'leaf') {
    serializeBlocks(w, sub.content, indent);
  } else {
    serializeBlocks(w, sub.intro, indent);
    for (const para of sub.children) {
      serializeParagraph(w, para, indent + 1);
    }
    serializeBlocks(w, sub.wrapUp, indent);
  }
}

function serializeParagraph(w: Writer, para: Paragraph, indent: number): void {
  if (para.number) {
    w.write(`${'\t'.repeat(indent)}${para.number} `);
  }

  if (para.variant === 'leaf') {
    serializeBlocks(w, para.content, indent);
  } else {
    serializeBlocks(w, para.intro, indent);
    for (const child of para.children) {
      serializeParagraph(w, child, indent + 1);
    }
    serializeBlocks(w, para.wrapUp, indent);
  }
}

// --- Schedules ---

function serializeSchedule(w: Writer, schedule: Schedule): void {
  w.blankLine();
  w.write(`## ${schedule.number}`);
  w.endLine();
  if (schedule.title) {
    w.write(`## ${schedule.title}`);
    w.endLine();
  }
  if (schedule.subtitle) {
    w.write(`## ${schedule.subtitle}`);
    w.endLine();
  }
  if (schedule.reference) {
    w.write(schedule.reference);
    w.endLine();
  }
  serializeBody(w, schedule.body);
}

// --- Blocks ---

function serializeBlocks(w: Writer, blocks: Block[], indent: number): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (isRunOnAmendment(block, next)) {
      w.write(block.content);
      if (!/[\s\u2014\u2013]$/.test(block.content)) w.write(' ');
      i = consumeRunOnAmendment(w, blocks, i, indent);
    } else if (block.type === 'blockAmendment') {
      const appendText = next?.type === 'appendText' ? next.content : undefined;
      serializeBlockAmendment(w, block, indent, appendText);
      if (appendText !== undefined) i++;
    } else {
      serializeBlock(w, block, indent);
    }
  }
}

function serializeBlock(w: Writer, block: Block, indent: number): void {
  switch (block.type) {
    case 'text':
    case 'appendText':
      w.write(block.content);
      w.endLine();
      break;
    case 'table':
      serializeTable(w, block);
      break;
    case 'figure':
      w.write('[Figure]');
      w.endLine();
      break;
    case 'blockAmendment':
      serializeBlockAmendment(w, block, indent);
      break;
    case 'list':
      serializeList(w, block, indent);
      break;
    case 'footnote':
      w.write(`${block.number} ${block.content}`);
      w.endLine();
      break;
    case 'numberedParagraph':
      serializeNumberedParagraph(w, block);
      break;
  }
}

function serializeTable(w: Writer, table: Table): void {
  for (const row of table.rows) {
    w.write(`| ${row.join(' | ')} |`);
    w.endLine();
  }
}

function serializeBlockAmendment(
  w: Writer,
  amendment: BlockAmendment,
  indent: number,
  appendText?: string,
  runOn?: boolean,
): void {
  // Amendments are multiline quoted layout, so their prefixes are replayed through
  // Writer scopes instead of embedding a pre-indented string into the parent.
  const open = amendment.format === 'single' ? '\u2018'
    : amendment.format === 'none' ? ''
    : '\u201c';
  const close = amendment.format === 'single' ? '\u2019'
    : amendment.format === 'none' ? ''
    : '\u201d';

  let bodyChildren: (Division | Provision | Block)[];
  if (runOn && amendment.children[0].type === 'text') {
    w.write(open + amendment.children[0].content);
    bodyChildren = amendment.children.slice(1);
  } else {
    bodyChildren = amendment.children;
  }

  const sub = new Writer();
  serializeAmendmentChildren(sub, bodyChildren);
  const lines = sub.toString().trimEnd().split('\n');

  let firstIdx = -1;
  let lastIdx = 0;  // fallback to line 0, matching original behaviour for all-empty bodies
  for (let j = 0; j < lines.length; j++) {
    if (lines[j] !== '') {
      if (firstIdx === -1) firstIdx = j;
      lastIdx = j;
    }
  }
  if (!runOn && firstIdx >= 0) lines[firstIdx] = open + lines[firstIdx];
  const appendGap = appendText && /^\w/.test(appendText) ? ' ' : '';
  lines[lastIdx] += close + appendGap + (appendText ?? '');

  w.endOpenLine();
  const tabs = '\t'.repeat(indent + 1);
  w.withPrefix(tabs, () => {
    w.withPrefix('> ', () => {
      for (const line of lines) {
        if (line === '') {
          w.blankLine();
        } else {
          w.write(line);
          w.endLine();
        }
      }
    });
  });
}

function serializeList(w: Writer, list: List, indent: number): void {
  // Lists are line-oriented layout. The bullet and continuation spacing must apply
  // to every rendered line of the item, so they belong to Writer prefixes rather
  // than string-flattened item output.
  w.endOpenLine();
  const tabs = '\t'.repeat(indent + 1);
  for (const item of list.items) {
    w.withPrefix(tabs, () => {
      w.withHanging('- ', '  ', () => {
        serializeBlocks(w, item, indent);
      });
    });
  }
}

function serializeNumberedParagraph(w: Writer, np: NumberedParagraph): void {
  w.write(`${np.number} `);
  serializeBlocks(w, np.children, 0);
  w.endOpenLine();
}

// --- Writer ---

type PrefixEntry = {
  current: string;
  rest?: string;
};

export class Writer {
  private lines: string[] = [];
  private currentLine = '';
  private lineStarted = false;
  private lastWasBlank = false;
  private prefixStack: PrefixEntry[] = [];

  /** Append text to the current line. Starts the line (applying prefixes) if needed. */
  write(text: string): void {
    if (!this.lineStarted) {
      this.currentLine = this.buildPrefix();
      this.lineStarted = true;
    }
    this.currentLine += text;
  }

  /** Finish the current line. If no write() was called, emits a prefix-only line. */
  endLine(): void {
    if (!this.lineStarted) {
      this.currentLine = this.buildPrefix();
    }
    this.lines.push(this.currentLine);
    this.currentLine = '';
    this.lineStarted = false;
    this.lastWasBlank = false;
    this.switchHanging();
  }

  /** Emit a blank separator line with active prefixes. Consecutive calls coalesce. */
  blankLine(): void {
    if (this.lineStarted) {
      this.endLine();
    }
    if (!this.lastWasBlank) {
      this.lines.push(this.buildPrefix().trimEnd());
      this.lastWasBlank = true;
    }
  }

  endOpenLine(): void {
    if (this.lineStarted) {
      this.endLine();
    }
  }

  /** Increase indent by one tab for all lines within fn. Use this for layout
   * prefixes that must persist across rendered lines, not for structural numbering depth. */
  withIndent(fn: () => void): void {
    this.withPrefix('\t', fn);
  }

  /** Add a prefix to every line within fn (e.g. '> ' for block quotes). */
  withPrefix(prefix: string, fn: () => void): void {
    this.withEntry({ current: prefix }, fn);
  }

  /** First line gets `first` prefix, subsequent lines get `rest`. */
  withHanging(first: string, rest: string, fn: () => void): void {
    this.withEntry({ current: first, rest }, fn);
  }

  private withEntry(entry: PrefixEntry, fn: () => void): void {
    this.prefixStack.push(entry);
    try { fn(); } finally { this.prefixStack.pop(); }
  }

  /** Flatten all lines to a single string. */
  toString(): string {
    const lines = this.lineStarted
      ? [...this.lines, this.currentLine]
      : this.lines;
    return lines.join('\n');
  }

  private buildPrefix(): string {
    return this.prefixStack.map(e => e.current).join('');
  }

  private switchHanging(): void {
    for (const entry of this.prefixStack) {
      if (entry.rest !== undefined) {
        entry.current = entry.rest;
        entry.rest = undefined;
      }
    }
  }
}

// --- Helpers ---

function smartQuotes(text: string): string {
  return text
    .replace(/\u201c /g, '\u201c')
    .replace(/ \u201d/g, '\u201d');
}

function serializeAmendmentChildren(
  w: Writer,
  children: (Division | Provision | Block)[],
): void {
  let firstStructuralChild = true;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const next = children[i + 1];
    const leading = firstStructuralChild ? 'line' : 'blank';

    if (isRunOnAmendment(child, next)) {
      w.write(child.content);
      if (!/[\s\u2014\u2013]$/.test(child.content)) w.write(' ');
      i = consumeRunOnAmendment(w, children, i, 0);
      firstStructuralChild = false;
    } else if (child.type === 'division') {
      serializeDivision(w, child, leading);
      firstStructuralChild = false;
    } else if (child.type === 'provision') {
      serializeProvision(w, child, 0, (child.level ?? 0) >= 2 ? 'line' : leading);
      firstStructuralChild = false;
    } else if (child.type === 'blockAmendment') {
      const appendText = next?.type === 'appendText' ? next.content : undefined;
      serializeBlockAmendment(w, child, 0, appendText);
      if (appendText !== undefined) i++;
      firstStructuralChild = false;
    } else {
      serializeBlock(w, child as Block, 0);
      if (child.type !== 'appendText') {
        firstStructuralChild = false;
      }
    }
  }
}

function applyLeadingSeparator(w: Writer, leading: LeadingSeparator): void {
  if (leading === 'blank') {
    w.blankLine();
  } else if (leading === 'line') {
    w.endOpenLine();
  }
}

function isRunOnAmendment(
  block: Block | Division | Provision,
  next: Block | Division | Provision | undefined,
): block is Text {
  return block.type === 'text' &&
    next?.type === 'blockAmendment' &&
    next.format !== 'none' &&
    next.children.length > 1 &&
    next.children[0].type === 'text';
}

function consumeRunOnAmendment(
  w: Writer,
  items: (Block | Division | Provision)[],
  i: number,
  indent: number,
): number {
  i++;  // advance to the amendment
  const after = items[i + 1];
  const appendText = after?.type === 'appendText' ? after.content : undefined;
  serializeBlockAmendment(w, items[i] as BlockAmendment, indent, appendText, true);
  if (appendText !== undefined) i++;
  return i;
}
