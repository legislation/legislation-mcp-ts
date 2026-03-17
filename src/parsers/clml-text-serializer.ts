/**
 * Serializes the semantic document model to plain text with markdown-style headings.
 *
 * The serializer owns all presentation decisions: heading markers, indentation,
 * spacing, bold markers, table formatting. The parser resolves what the CLML means;
 * this module decides how it looks.
 *
 * Newline model:
 *   - Every block ends with \n (it completes its own line)
 *   - Divisions and provisions start with \n (blank line above, combining with
 *     the previous element's trailing \n)
 *   - Sub-provisions and paragraphs do NOT add a leading \n — the previous
 *     element's trailing \n provides the line break
 *   - serializeDocument trims the result, removing leading/trailing whitespace
 */

import type {
  Document, Prelims, Division, DivisionName, Provision, SubProvision,
  Paragraph, Schedule, Block, Table, BlockAmendment, List,
  NumberedParagraph, Text,
} from './clml-types.js';

const HEADING_MARKS: Record<DivisionName, string> = {
  groupOfParts: '##',
  part: '##',
  chapter: '###',
  crossHeading: '####',
  subHeading: '#####',
};

// --- Public API ---

export function serializeDocument(doc: Document): string {
  let result = '';
  result += serializePrelims(doc.prelims);
  result += serializeBody(doc.body);
  for (const schedule of doc.schedules) {
    result += serializeSchedule(schedule);
  }
  return smartQuotes(result.trim());
}

// --- Prelims ---

function serializePrelims(prelims: Prelims): string {
  const parts: string[] = [];
  for (const block of prelims) {
    parts.push(serializeBlock(block, 0));
  }
  return parts.length ? parts.join('\n') : '';
}

// --- Structure ---

function serializeBody(nodes: (Division | Provision | Block)[]): string {
  let result = '';
  for (const node of nodes) {
    const type = (node as { type: string }).type;
    if (type === 'division') {
      result += serializeDivision(node as Division);
    } else if (type === 'provision') {
      result += serializeProvision(node as Provision, 0);
    } else {
      result += serializeBlock(node as Block, 0);
    }
  }
  return result;
}

function serializeDivision(div: Division): string {
  const mark = HEADING_MARKS[div.name];
  let result = '\n';

  if (div.number) {
    result += `${mark} ${div.number}\n`;
    result += `${mark} ${div.title}\n`;
  } else {
    result += `${mark} ${div.title}\n`;
  }

  result += serializeBody(div.children);
  return result;
}

function serializeProvision(prov: Provision, indent: number): string {
  let result = '';

  if (prov.title) {
    result += `\n${prov.number} **${prov.title}**\n`;
  } else if (prov.number) {
    result += `\n${'\t'.repeat(indent)}${prov.number} `;
  }

  if (prov.variant === 'leaf') {
    result += serializeBlocks(prov.content, indent);
  } else {
    result += serializeBlocks(prov.intro, indent);
    result += serializeProvisionChildren(prov.children, indent);
    result += serializeBlocks(prov.wrapUp, indent);
  }

  return result;
}

function serializeProvisionChildren(children: (SubProvision | Paragraph)[], indent: number): string {
  let result = '';
  for (const child of children) {
    if (child.type === 'subProvision') {
      result += serializeSubProvision(child, indent);
    } else {
      result += serializeParagraph(child, indent + 1);
    }
  }
  return result;
}

function serializeSubProvision(sub: SubProvision, indent: number): string {
  let result = '';
  if (sub.number) {
    result += `${'\t'.repeat(indent)}${sub.number} `;
  }

  if (sub.variant === 'leaf') {
    result += serializeBlocks(sub.content, indent);
  } else {
    result += serializeBlocks(sub.intro, indent);
    for (const para of sub.children) {
      result += serializeParagraph(para, indent + 1);
    }
    result += serializeBlocks(sub.wrapUp, indent);
  }

  return result;
}

function serializeParagraph(para: Paragraph, indent: number): string {
  let result = '';
  if (para.number) {
    result += `${'\t'.repeat(indent)}${para.number} `;
  }

  if (para.variant === 'leaf') {
    result += serializeBlocks(para.content, indent);
  } else {
    result += serializeBlocks(para.intro, indent);
    for (const child of para.children) {
      result += serializeParagraph(child, indent + 1);
    }
    result += serializeBlocks(para.wrapUp, indent);
  }

  return result;
}

// --- Schedules ---

function serializeSchedule(schedule: Schedule): string {
  let result = '\n';
  result += `## ${schedule.number}\n`;
  if (schedule.title) result += `## ${schedule.title}\n`;
  if (schedule.subtitle) result += `## ${schedule.subtitle}\n`;
  if (schedule.reference) result += `${schedule.reference}\n`;
  result += serializeBody(schedule.body);
  return result;
}

// --- Blocks ---

function serializeBlocks(blocks: Block[], indent: number): string {
  let result = '';
  for (const block of blocks) {
    result += serializeBlock(block, indent);
  }
  return result;
}

function serializeBlock(block: Block, indent: number): string {
  switch (block.type) {
    case 'text':
    case 'appendText':
      return block.content + '\n';
    case 'table':
      return serializeTable(block);
    case 'figure':
      return '[Figure]\n';
    case 'blockAmendment':
      return serializeBlockAmendment(block, indent);
    case 'list':
      return serializeList(block, indent);
    case 'footnote':
      return `${block.number} ${block.content}\n`;
    case 'numberedParagraph':
      return serializeNumberedParagraph(block);
  }
}

function serializeTable(table: Table): string {
  let result = '';
  for (const row of table.rows) {
    result += `| ${row.join(' | ')} |\n`;
  }
  return result;
}

function serializeBlockAmendment(amendment: BlockAmendment, indent: number): string {
  let content = '';
  for (const child of amendment.children) {
    const type = (child as { type: string }).type;
    if (type === 'division') {
      content += serializeDivision(child as Division);
    } else if (type === 'provision') {
      content += serializeProvision(child as Provision, 0);
    } else {
      content += serializeBlock(child as Block, 0);
    }
  }
  const tabs = '\t'.repeat(indent + 1);
  return content.replace(/\n/g, `\n${tabs}`);
}

function serializeList(list: List, indent: number): string {
  let result = '';
  for (const item of list.items) {
    const itemIndent = indent + 1;
    const tabs = '\t'.repeat(itemIndent);
    const content = serializeBlocks(item, itemIndent).trim();
    result += `${tabs}- ${content}\n`;
  }
  return result;
}

function serializeNumberedParagraph(np: NumberedParagraph): string {
  const content = serializeBlocks(np.children, 0).trim();
  return `${np.number} ${content}\n`;
}

// --- Helpers ---

function smartQuotes(text: string): string {
  return text
    .replace(/\u201c /g, '\u201c')
    .replace(/ \u201d/g, '\u201d');
}
