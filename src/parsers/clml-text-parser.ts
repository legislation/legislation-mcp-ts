/**
 * Converts CLML (Crown Legislation Markup Language) XML to readable plain text.
 *
 * Ported from the Python CLMLMarkdownParser used for the vector database,
 * with extensions for Parts, Chapters, prelims, cross-headings, and schedules.
 */

import { DOMParser } from '@xmldom/xmldom';
import { parseLegislationUri } from '../utils/legislation-uri.js';

const SKIP = Symbol('skip');
type ParseResult = string | typeof SKIP | null;

export class CLMLTextParser {
  private skipNextPnumber = false;

  /**
   * Parse CLML XML into plain text.
   * Accepts a full document or a fragment (e.g. a single Part or Section).
   */
  parse(xml: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    this.skipNextPnumber = false;
    const startNode = this.findFragmentTarget(doc) ?? doc.documentElement;
    return this.parseElement(startNode, 0).trim();
  }

  private parseElement(node: Element, indentLevel: number, recurseOnly = false): string {
    if (!recurseOnly) {
      const result = this.parseKnownTag(node, indentLevel);
      if (result !== null && result !== SKIP) return result;
    }

    let result = '';

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];

      if (child.nodeType === 3) {
        // Text node
        const text = (child.textContent || '').trim();
        if (text) result += text + ' ';
      } else if (child.nodeType === 1) {
        // Element node
        const el = child as Element;
        const tagResult = this.parseKnownTag(el, indentLevel);
        if (tagResult === SKIP) continue;
        if (tagResult !== null) {
          result += tagResult;
        } else {
          result += this.parseUnknownTag(el);
        }
      }
    }

    return this.regexEdits(result);
  }

  private parseKnownTag(element: Element, indentLevel: number): ParseResult {
    const name = element.localName;

    // Provision numbers
    if (name === 'Pnumber') {
      if (this.skipNextPnumber) {
        this.skipNextPnumber = false;
        return SKIP;
      }
      return this.formatPnumber(element, indentLevel);
    }

    // Inline/text content
    if (name === 'Text') return (element.textContent || '').replace(/\s+/g, ' ').trim() + ' ';
    if (name === 'BlockAmendment') return this.formatBlockAmendment(element, indentLevel);

    // Grouping
    if (name === 'Pblock') return this.formatPblock(element, indentLevel, '####');
    if (name === 'PsubBlock') return this.formatPblock(element, indentLevel, '#####');
    if (name === 'P1group') return this.formatPgroup(element, indentLevel);

    // Structural divisions
    if (name === 'Part') return this.formatDivision(element, indentLevel, '##');
    if (name === 'Chapter') return this.formatDivision(element, indentLevel, '###');

    // Schedules
    if (name === 'Schedule') return this.formatSchedule(element, indentLevel);
    if (name === 'Schedules') return this.formatSchedules(element, indentLevel);
    if (name === 'ScheduleBody') return this.parseElement(element, indentLevel, true);

    // Tables
    if (name === 'Tabular') return this.formatTable(element);
    if (name === 'table' || name === 'tbody' || name === 'thead' || name === 'tfoot' || name === 'colgroup') {
      return this.parseElement(element, indentLevel, true);
    }
    if (name === 'tr') return this.formatTableRow(element);
    if (name === 'th' || name === 'td') return this.textContent(element);
    if (name === 'col') return '';

    // Lists
    if (name === 'UnorderedList' || name === 'OrderedList') {
      return this.parseElement(element, indentLevel, true);
    }
    if (name === 'ListItem') return this.formatListItem(element, indentLevel);

    // Wrappers — recurse into children
    if (name === 'P' || name === 'Para') return this.parseElement(element, indentLevel, true);
    if (name === 'TitleBlock') return this.parseElement(element, indentLevel, true);
    if (name === 'Legislation' || name === 'Primary' || name === 'Secondary' || name === 'EURetained' || name === 'Body') {
      return this.parseElement(element, indentLevel, true);
    }

    // EU structural divisions (have Number/Title children like Part/Chapter)
    if (name === 'EUPart') return this.formatDivision(element, indentLevel, '##');
    if (name === 'EUTitle') return this.formatDivision(element, indentLevel, '##');
    if (name === 'EUChapter') return this.formatDivision(element, indentLevel, '###');
    if (name === 'EUSection' || name === 'EUSubsection') return this.formatDivision(element, indentLevel, '####');

    // EU wrappers (no Number/Title of their own)
    if (name === 'EUBody' || name === 'EUPreamble') {
      return this.parseElement(element, indentLevel, true);
    }

    // Prelims
    if (name === 'PrimaryPrelims' || name === 'SecondaryPrelims') {
      return this.formatPrelims(element);
    }
    if (name === 'EUPrelims') return this.formatEUPrelims(element, indentLevel);

    // Preamble elements (secondary legislation and EU)
    if (name === 'IntroductoryText' || name === 'EnactingText') {
      return this.parseElement(element, indentLevel, true);
    }

    // Division (EU recitals) — Number + content
    if (name === 'Division') return this.formatNumberedParagraph(element, indentLevel);

    // Skip metadata, editorial commentary, and contents
    if (name === 'Metadata') return '';
    if (name === 'Commentaries' || name === 'Commentary' || name === 'CommentaryRef') return '';
    if (name === 'Contents') return '';

    // Footnotes — authorial, keep with newline separation
    if (name === 'Footnote') return this.formatFootnote(element);
    if (name === 'FootnoteRef') return this.textContent(element);

    // Figures — can't render in plain text
    if (name === 'Figure' || name === 'Image') return '\n[Figure]\n';

    // P<n>para, P<n>group — recurse
    if (/^P\d+para$/.test(name) || /^P\d+group$/.test(name)) {
      return this.parseElement(element, indentLevel, true);
    }

    // P<n> — recurse with calculated indent (P1/P2 = 0, P3 = 1, P4 = 2, ...)
    const pMatch = name.match(/^P(\d+)$/);
    if (pMatch) {
      const level = parseInt(pMatch[1], 10);
      const newIndent = Math.max(0, level - 2);
      return this.parseElement(element, newIndent, true);
    }

    return null;
  }

  private parseUnknownTag(element: Element): string {
    return (element.textContent || '').trim() + ' ';
  }

  private regexEdits(result: string): string {
    return result
      .replace(/\u201c /g, '\u201c')
      .replace(/ \u201d/g, '\u201d');
  }

  // --- Formatters ---

  private formatPnumber(element: Element, indentLevel: number): string {
    const indent = '\t'.repeat(indentLevel);
    return `\n${indent}${this.textContent(element)}) `;
  }

  private formatTable(element: Element): string {
    return '\n' + this.parseElement(element, 0, true).trim() + '\n';
  }

  private formatTableRow(element: Element): string {
    const cells: string[] = [];
    for (const child of this.childElements(element)) {
      if (child.localName === 'th' || child.localName === 'td') {
        cells.push(this.textContent(child));
      }
    }
    return '\n| ' + cells.join(' | ') + ' |';
  }

  private formatBlockAmendment(element: Element, indentLevel: number): string {
    const content = this.parseElement(element, indentLevel + 1, true);
    const indent = '\t'.repeat(indentLevel + 1);
    return content.replace(/\n/g, `\n${indent}`);
  }

  private formatPblock(element: Element, indentLevel: number, headingMark: string): string {
    let result = '';
    let startsWith: string | null = null;

    for (const child of this.childElements(element)) {
      if (child.localName === 'Title') {
        startsWith = `\n\n${headingMark} ${this.textContent(child)}\n`;
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    return startsWith ? startsWith + result : result;
  }

  private formatPgroup(element: Element, indentLevel: number): string {
    let result = '';
    let startsWith: string | null = null;

    for (const child of this.childElements(element)) {
      if (child.localName === 'Title') {
        const groupTitle = this.textContent(child);
        const pnumber = element.getElementsByTagName('Pnumber')[0];
        const pnumberText = pnumber ? this.textContent(pnumber) : '';

        if (pnumber && !pnumberText.includes('Article')) {
          startsWith = `\n\nSection ${pnumberText}) **${groupTitle}**\n`;
          this.skipNextPnumber = true;
        } else if (pnumber && pnumberText.includes('Article')) {
          startsWith = `\n\n${pnumberText}) **${groupTitle}**\n`;
          this.skipNextPnumber = true;
        }
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    return startsWith ? startsWith + result : result;
  }

  /**
   * Format a structural division (Part or Chapter).
   * Both have the same structure: Number, Title, then content.
   */
  private formatDivision(element: Element, indentLevel: number, headingMark: string): string {
    let result = '';
    let startsWith = '';

    for (const child of this.childElements(element)) {
      const name = child.localName;
      if (name === 'Number' || name === 'Title') {
        startsWith += `${headingMark} ${this.textContent(child)}\n`;
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    if (startsWith) {
      result = startsWith + '\n' + result;
    }
    return result;
  }

  private formatSchedules(element: Element, indentLevel: number): string {
    let result = '';
    let startsWith = '';

    for (const child of this.childElements(element)) {
      if (child.localName === 'Title') {
        startsWith += `\n\n## ${this.textContent(child)}\n`;
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    return startsWith + result;
  }

  private formatSchedule(element: Element, indentLevel: number): string {
    let result = '';
    let startsWith = '';

    for (const child of this.childElements(element)) {
      const name = child.localName;
      if (name === 'Number') {
        startsWith += `## ${this.textContent(child)}\n`;
      } else if (name === 'TitleBlock') {
        // TitleBlock can contain Title and Subtitle children
        for (const tbChild of this.childElements(child)) {
          if (tbChild.localName === 'Title' || tbChild.localName === 'Subtitle') {
            startsWith += `## ${this.textContent(tbChild)}\n`;
          }
        }
      } else if (name === 'Reference') {
        startsWith += `${this.textContent(child)}\n`;
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    if (startsWith) {
      result = '\n' + startsWith + '\n' + result;
    }
    return result;
  }

  private formatPrelims(element: Element): string {
    let result = '';

    for (const child of this.childElements(element)) {
      const name = child.localName;
      if (name === 'Title') {
        result += `# ${this.textContent(child)}\n\n`;
      } else if (name === 'Number') {
        result += `${this.textContent(child)}\n\n`;
      } else if (name === 'LongTitle') {
        result += `${this.textContent(child)}\n\n`;
      } else if (name === 'DateOfEnactment' || name === 'MadeDate' || name === 'LaidDate' || name === 'ComingIntoForce') {
        result += this.formatPrelimsDate(child) + '\n\n';
      } else if (name === 'SubjectInformation') {
        // Secondary legislation subject categories — skip (metadata, not legislative text)
      } else if (name === 'PrimaryPreamble' || name === 'SecondaryPreamble') {
        for (const preambleChild of this.childElements(child)) {
          result += this.parseElement(preambleChild, 0).trim() + '\n\n';
        }
      }
    }

    return result;
  }

  /**
   * Format a date element from prelims (MadeDate, LaidDate, ComingIntoForce, etc.).
   * These contain child elements like <Text>Made</Text><DateText>1st Jan 2024</DateText>
   * which must be joined with spaces, not concatenated via textContent.
   *
   * ComingIntoForce can also contain ComingIntoForceClauses sub-elements, each with
   * their own Text + DateText pair (for staggered commencement dates).
   */
  private formatPrelimsDate(element: Element): string {
    const topParts: string[] = [];
    const clauses: string[] = [];
    for (const child of this.childElements(element)) {
      if (child.localName === 'ComingIntoForceClauses') {
        // Each clause has its own Text + DateText pair
        const clauseParts: string[] = [];
        for (const clauseChild of this.childElements(child)) {
          const text = this.textContent(clauseChild);
          if (text) clauseParts.push(text);
        }
        if (clauseParts.length) clauses.push(clauseParts.join(' '));
      } else {
        const text = this.textContent(child);
        if (text) topParts.push(text);
      }
    }
    const top = topParts.join(' ');
    if (clauses.length === 0) return top;
    return [top, ...clauses].filter(Boolean).join('\n');
  }

  private formatEUPrelims(element: Element, indentLevel: number): string {
    let result = '';

    for (const child of this.childElements(element)) {
      const name = child.localName;
      if (name === 'MultilineTitle') {
        // MultilineTitle contains multiple <Text> children — join with newlines
        const lines: string[] = [];
        for (const textEl of this.childElements(child)) {
          const text = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) lines.push(text);
        }
        result += `# ${lines.join('\n')}\n\n`;
      } else if (name === 'EUPreamble') {
        result += this.parseElement(child, indentLevel, true);
      } else if (name === 'CommentaryRef') {
        // Skip
      } else {
        result += this.parseElement(child, indentLevel);
      }
    }

    return result;
  }

  private formatNumberedParagraph(element: Element, indentLevel: number): string {
    let number = '';
    let content = '';
    for (const child of this.childElements(element)) {
      if (child.localName === 'Number') {
        number = this.textContent(child);
      } else {
        content += this.parseElement(child, indentLevel);
      }
    }
    return number ? `\n${number} ${content.trim()}\n` : content;
  }

  private formatFootnote(element: Element): string {
    const parts: string[] = [];
    for (const child of this.childElements(element)) {
      parts.push(this.textContent(child));
    }
    return '\n' + parts.join(' ');
  }

  private formatListItem(element: Element, indentLevel: number): string {
    const indent = '\t'.repeat(indentLevel + 1);
    const content = this.parseElement(element, indentLevel + 1, true);
    return `\n${indent}- ${content.trim()}`;
  }

  // --- Fragment detection ---

  /**
   * If the document metadata contains a dc:identifier with a fragment path,
   * find and return the target element by its id attribute.
   * Returns null for full documents or when the target isn't found.
   */
  private findFragmentTarget(doc: Document): Element | null {
    // Find first dc:identifier element anywhere in the document
    const identifiers = doc.getElementsByTagName('dc:identifier');
    if (identifiers.length === 0) return null;

    const uri = (identifiers[0].textContent || '').trim();
    if (!uri) return null;

    const parsed = parseLegislationUri(uri);
    if (!parsed?.fragment) return null;

    // Convert fragment from slash form (section/1) to dash form (section-1)
    const targetId = parsed.fragment.replace(/\//g, '-');

    return this.findElementById(doc.documentElement, targetId);
  }

  /** Recursively search the DOM for an element with the given id attribute. */
  private findElementById(node: Element, id: string): Element | null {
    if (node.getAttribute('id') === id) return node;

    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === 1) {
        const found = this.findElementById(child as Element, id);
        if (found) return found;
      }
    }
    return null;
  }

  // --- Helpers ---

  private textContent(element: Element): string {
    return (element.textContent || '').trim();
  }

  /** Iterate over direct child elements, skipping text nodes. */
  private *childElements(element: Element): Iterable<Element> {
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes[i];
      if (child.nodeType === 1) yield child as Element;
    }
  }
}
