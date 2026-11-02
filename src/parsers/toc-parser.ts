/**
 * Parser for legislation table of contents
 *
 * Converts CLML Contents element to structured JSON hierarchy.
 */

import { XMLParser } from 'fast-xml-parser';
import { LegislationMetadata, MetadataParser, NavigationLinks } from './metadata-parser.js';
import { parseLegislationUri } from '../utils/legislation-uri.js';

/**
 * A single item in the table of contents (Part, Chapter, Section, etc.)
 *
 * Note: Optional fields are omitted from JSON output when undefined (not present in source document).
 */
export interface Item {
  name: string;           // "group", "part", "chapter", "crossheading", "subheading", "title", "section", "division", "appendix", "schedule", "attachment", "item"
  number?: string;        // e.g., "1", "2A", "I" (omitted if not present)
  title?: string;         // Human-readable heading (omitted if not present)
  fragmentId?: string;    // Fragment path for use with get_legislation_fragment (e.g., "section/5", "part/1/chapter/2") (omitted if not present)
  extent?: string[];      // Geographical extent (e.g., ["E", "W"], ["E", "W", "S", "NI"]) (omitted if not present)
  children?: Item[];      // Nested items (e.g., chapters within parts, sections within chapters) (omitted if not present)
}

/**
 * Contents structure with semantic sections
 *
 * Note on attachments: In CLML XML, there is only an <attachments> element (no distinction).
 * Attachments can appear before schedules, after schedules, or both. This JSON structure
 * distinguishes them by position: attachmentsBeforeSchedules vs attachments.
 * The parser must process elements in order and track whether <schedules> has been encountered
 * to correctly populate these fields.
 *
 * Note on optional fields: All optional fields are omitted from JSON output when undefined
 * (not present in the source document). Only body is guaranteed to be present.
 */
export interface Contents {
  title?: string;                         // Overall title of the contents (omitted if not present)
  introduction?: Item;                    // Introductory text (single item) (omitted if not present)
  body: Item[];                           // Main body (parts, chapters, sections) - always present
  signature?: Item;                       // Signature section (single item) (omitted if not present)
  appendices?: Item[];                    // Appendices (omitted if not present)
  attachmentsBeforeSchedules?: Item[];    // <attachments> appearing before <schedules> in XML (omitted if not present)
  schedules?: Item[];                     // Schedules (omitted if not present)
  attachments?: Item[];                   // <attachments> appearing after <schedules> in XML (omitted if not present)
  explanatoryNote?: Item;                 // Explanatory note (single item) (omitted if not present)
  earlierOrders?: Item;                   // Note as to earlier commencement orders (single item) (omitted if not present)
}

/**
 * Complete table of contents for a legislation document
 */
export interface TableOfContents {
  meta: LegislationMetadata;  // Metadata about the legislation
  contents: Contents;          // Structured contents with semantic sections
}

/**
 * Parser for CLML Contents elements
 *
 * Uses fast-xml-parser with preserveOrder: true, which produces an array-based structure
 * where each element is { ElementName: [...children...], ":@": { ...attributes... } }.
 * This preserves sibling ordering, which is needed for correctly positioning attachments
 * relative to schedules.
 */
export class TocParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,     // Strip namespace prefixes
      preserveOrder: true,       // Maintain element ordering (needed for interleaved attachments)
      trimValues: false          // Preserve whitespace in text nodes (we trim in extractText)
    });
  }

  /**
   * Parse CLML XML containing a Contents element
   * @param xml CLML XML document containing a <Legislation> root with <Contents>
   * @returns Structured table of contents
   */
  parse(xml: string): TableOfContents {
    // Parse metadata using existing parser (without preserveOrder)
    const metadataParser = new MetadataParser();
    const meta = metadataParser.parse(xml, 'document');
    const nav = metadataParser.parseNavigationLinks(xml);

    // Parse the full document with preserveOrder to maintain element ordering
    const parsed = this.parser.parse(xml);

    // Find the Contents element in the preserveOrder array structure
    const contentsChildren = this.findContents(parsed);

    // Build the structured contents from XML
    const contents = this.buildContents(contentsChildren);

    // Add synthetic items from navigation links (these sections exist in the
    // document but are not represented in the Contents XML element)
    this.addSyntheticItems(contents, nav, meta.extent);

    return { meta, contents };
  }

  /**
   * Find the Contents element's children in the preserveOrder array structure.
   */
  private findContents(parsed: any[]): any[] {
    // Root is an array of wrapper objects
    const legislationWrapper = parsed.find((item: any) => item.Legislation);
    if (!legislationWrapper) {
      throw new Error("No Legislation element found");
    }

    const legislationChildren: any[] = legislationWrapper.Legislation;

    const contentsWrapper = legislationChildren.find((item: any) => item.Contents);
    if (!contentsWrapper) {
      throw new Error("No Contents element found in Legislation");
    }

    return contentsWrapper.Contents;
  }

  /**
   * Build the Contents structure from the Contents element's children.
   * Processes elements in order to correctly position attachments relative to schedules.
   */
  private buildContents(children: any[]): Contents {
    const contents: Contents = {
      body: []
    };

    let seenSchedules = false;

    for (const wrapper of children) {
      const elementName = this.getElementName(wrapper);
      if (!elementName) continue;

      switch (elementName) {
        case "ContentsTitle":
          contents.title = this.extractText(wrapper[elementName]);
          break;

        case "ContentsIntroduction":
          contents.introduction = this.processItem(wrapper);
          break;

        case "ContentsSignature":
          contents.signature = this.processItem(wrapper);
          break;

        case "ContentsSchedules":
          seenSchedules = true;
          contents.schedules = this.processGroupChildren(wrapper[elementName]);
          break;

        case "ContentsAppendices":
          contents.appendices = this.processGroupChildren(wrapper[elementName]);
          break;

        case "ContentsAttachments":
          if (seenSchedules) {
            contents.attachments = this.processGroupChildren(wrapper[elementName]);
          } else {
            contents.attachmentsBeforeSchedules = this.processGroupChildren(wrapper[elementName]);
          }
          break;

        case "ContentsExplanatoryNote":
          contents.explanatoryNote = this.processItem(wrapper);
          break;

        case "ContentsEarlierOrders":
          contents.earlierOrders = this.processItem(wrapper);
          break;

        default:
          // Body items: ContentsPblock, ContentsPart, ContentsChapter, ContentsItem, etc.
          if (elementName.startsWith("Contents")) {
            contents.body.push(this.processItem(wrapper));
          }
          break;
      }
    }

    return contents;
  }

  /**
   * Add synthetic items for sections that exist in the document but aren't
   * represented in the Contents XML. Their presence is indicated by atom:link
   * navigation elements in the metadata. Values are hardcoded per the Java model.
   */
  private addSyntheticItems(contents: Contents, nav: NavigationLinks, extent?: string[]): void {
    if (nav.hasIntroduction && !contents.introduction) {
      const item: Item = { name: "introduction", title: "Introductory Text", fragmentId: "introduction" };
      if (extent) item.extent = extent;
      contents.introduction = item;
    }
    if (nav.hasSignature && !contents.signature) {
      const item: Item = { name: "signature", title: "Signature", fragmentId: "signature" };
      if (extent) item.extent = extent;
      contents.signature = item;
    }
    if (nav.hasExplanatoryNote && !contents.explanatoryNote) {
      const item: Item = { name: "explanatoryNote", title: "Explanatory Note", fragmentId: "note" };
      if (extent) item.extent = extent;
      contents.explanatoryNote = item;
    }
    if (nav.hasEarlierOrders && !contents.earlierOrders) {
      const item: Item = { name: "earlierOrders", title: "Note as to Earlier Commencement Orders", fragmentId: "earlier-orders" };
      if (extent) item.extent = extent;
      contents.earlierOrders = item;
    }
  }

  /**
   * Process a wrapper object into an Item.
   *
   * A wrapper object in preserveOrder looks like:
   *   { "ContentsPblock": [...children...], ":@": { "@_IdURI": "...", ... } }
   */
  private processItem(wrapper: any): Item {
    const elementName = this.getElementName(wrapper)!;
    const children: any[] = wrapper[elementName] || [];
    const attributes = wrapper[":@"] || {};

    const item: Item = {
      name: this.extractName(elementName)
    };

    // Extract attributes
    const fragmentId = this.extractFragmentId(attributes);
    if (fragmentId) item.fragmentId = fragmentId;

    const extent = this.extractExtent(attributes);
    if (extent) item.extent = extent;

    // Process child elements
    const childItems: Item[] = [];
    for (const childWrapper of children) {
      const childName = this.getElementName(childWrapper);
      if (!childName) continue;

      if (childName === "ContentsNumber") {
        item.number = this.extractText(childWrapper[childName]);
      } else if (childName === "ContentsTitle") {
        item.title = this.extractText(childWrapper[childName]);
      } else if (childName.startsWith("Contents")) {
        childItems.push(this.processItem(childWrapper));
      }
    }

    if (childItems.length > 0) {
      item.children = childItems;
    }

    return item;
  }

  /**
   * Process children of a group wrapper (ContentsSchedules, ContentsAppendices, etc.)
   * into an array of Items, skipping the group's own ContentsTitle.
   */
  private processGroupChildren(children: any[]): Item[] {
    const items: Item[] = [];
    for (const childWrapper of children) {
      const childName = this.getElementName(childWrapper);
      if (!childName) continue;

      // Skip the group's title (e.g., "SCHEDULES")
      if (childName === "ContentsTitle") continue;

      if (childName.startsWith("Contents")) {
        items.push(this.processItem(childWrapper));
      }
    }
    return items;
  }

  /**
   * Get the element name from a preserveOrder wrapper object.
   * Returns the first key that isn't ":@" (the attributes key), or undefined.
   */
  private getElementName(wrapper: any): string | undefined {
    return Object.keys(wrapper).find(k => k !== ":@");
  }

  /**
   * Extract text content from a preserveOrder element value (always an array).
   * Recursively descends into nested elements (e.g., Abbreviation, Emphasis, Strong)
   * to collect all text. Converts numeric values to strings.
   *
   * Future: Could be extended to emit Markdown for Emphasis (*italic*) and Strong (**bold**).
   */
  private extractText(value: any[]): string {
    if (!Array.isArray(value)) return String(value ?? "");

    const parts: string[] = [];
    for (const node of value) {
      if (node["#text"] !== undefined) {
        parts.push(String(node["#text"]));
      } else {
        // Recurse into nested elements (Abbreviation, Emphasis, Strong, etc.)
        const elementName = this.getElementName(node);
        if (elementName) {
          parts.push(this.extractText(node[elementName]));
        }
      }
    }
    return parts.join("").trim();
  }

  /** Map CLML element names to clearer public names */
  private static readonly NAME_MAP: Record<string, string> = {
    "Pblock": "crossheading",
    "Psubblock": "subheading",
  };

  /**
   * Extract the 'name' field from an element name (remove 'Contents' prefix, lowercase first char)
   */
  private extractName(elementName: string): string {
    if (elementName.startsWith("Contents")) {
      const suffix = elementName.substring("Contents".length);
      if (suffix in TocParser.NAME_MAP) return TocParser.NAME_MAP[suffix];
      return suffix.charAt(0).toLowerCase() + suffix.slice(1);
    }
    return elementName.toLowerCase();
  }

  /**
   * Extract fragmentId from IdURI or DocumentURI attribute
   */
  private extractFragmentId(attributes: any): string | undefined {
    const uri = attributes?.["@_IdURI"] || attributes?.["@_DocumentURI"];
    if (!uri) return undefined;

    const parsed = parseLegislationUri(uri);
    return parsed?.fragment;
  }

  /**
   * Extract extent from RestrictExtent attribute
   */
  private extractExtent(attributes: any): string[] | undefined {
    const restrictExtent = attributes?.["@_RestrictExtent"];
    if (!restrictExtent) return undefined;

    // RestrictExtent is like "E+W+S+N.I." - split by '+' and normalize "N.I." to "NI"
    return restrictExtent
      .split("+")
      .map((code: string) => code.replace("N.I.", "NI"));
  }
}
