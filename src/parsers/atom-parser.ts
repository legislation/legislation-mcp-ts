/**
 * Parser for Atom feed search results
 *
 * Converts Atom XML search results to clean JSON arrays.
 * This is an experimental feature to improve AI agent usability.
 */

import { XMLParser } from 'fast-xml-parser';
import { longToShortTypeMap } from '../utils/type-codes.js';

/**
 * A single search result from legislation.gov.uk
 */
export interface SearchResult {
  // Identification
  id: string;           // e.g., "ukpga/2026/3"
  type: string;         // e.g., "ukpga"
  year: number;         // e.g., 2026
  number: number;       // e.g., 3
  title: string;

  // Date (enacted for primary, made for secondary)
  date?: string;        // YYYY-MM-DD format
}

/**
 * Pagination metadata from OpenSearch elements in the Atom feed
 */
export interface SearchMeta {
  totalResults?: number;
  page: number;
  itemsPerPage: number;
  morePages: boolean;
}

/**
 * Search response envelope
 */
export interface SearchResponse {
  meta: SearchMeta;
  documents: SearchResult[];
}

/**
 * Extract pagination metadata from a parsed Atom feed object.
 * Shared by AtomParser and EffectsParser.
 */
export function parseFeedMeta(feed: any): SearchMeta {
  const parsedTotal = parseInt(feed.totalResults, 10);
  const totalResults = isNaN(parsedTotal) ? undefined : parsedTotal;
  const itemsPerPage = parseInt(feed.itemsPerPage, 10) || 20;
  const startIndex = parseInt(feed.startIndex, 10) || 1;
  // Prefer leg:page (current page number) over computing from startIndex
  const page = parseInt(feed.page, 10) || Math.ceil(startIndex / itemsPerPage);
  // Prefer leg:morePages (remaining page count) over OpenSearch totalResults calculation,
  // as feeds may omit openSearch:totalResults while still providing leg:morePages
  const legMorePages = parseInt(feed.morePages, 10);
  const morePages = isNaN(legMorePages)
    ? totalResults !== undefined && startIndex + itemsPerPage - 1 < totalResults
    : legMorePages > 0;

  return { totalResults, page, itemsPerPage, morePages };
}

export class AtomParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true  // Strip atom:, ukm:, dc:, etc. prefixes
    });
  }

  /**
   * Parse Atom feed XML into search response
   */
  parse(xml: string): SearchResponse {
    const obj = this.parser.parse(xml);

    // Debug: uncomment to see full structure
    // console.error(JSON.stringify(obj, null, 2));

    const feed = obj.feed;
    if (!feed) {
      throw new Error('Unable to find feed element in Atom XML');
    }

    // Handle both single entry and array of entries
    const entries = feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];

    const documents = entries.map((entry: any) => {
      const longType = this.extractLongType(entry);
      const shortType = longToShortTypeMap.get(longType) || '';

      return {
        id: this.extractId(entry),
        type: shortType,
        year: this.extractYear(entry),
        number: this.extractNumber(entry),
        title: this.extractTitle(entry),
        date: this.extractDate(entry)
      };
    });

    return {
      meta: parseFeedMeta(feed),
      documents
    };
  }

  private extractId(entry: any): string {
    // <id>http://www.legislation.gov.uk/id/ukpga/2026/3</id>
    // Strip prefix to get just "ukpga/2026/3"
    const fullId = entry.id || '';
    return fullId.replace(/^https?:\/\/www\.legislation\.gov\.uk\/(id\/)?/, '');
  }

  private extractLongType(entry: any): string {
    // <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
    return entry.DocumentMainType?.['@_Value'] || '';
  }

  private extractYear(entry: any): number {
    // <ukm:Year Value="2026"/>
    const value = entry.Year?.['@_Value'];
    return value ? parseInt(value, 10) : 0;
  }

  private extractNumber(entry: any): number {
    // <ukm:Number Value="3"/>
    const value = entry.Number?.['@_Value'];
    return value ? parseInt(value, 10) : 0;
  }

  private extractTitle(entry: any): string {
    // <title>Holocaust Memorial Act 2026</title>
    return entry.title || '';
  }

  private extractDate(entry: any): string | undefined {
    // <ukm:CreationDate Date="2026-01-22"/>
    return entry.CreationDate?.['@_Date'];
  }
}
