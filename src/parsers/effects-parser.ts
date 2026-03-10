/**
 * Parser for legislative effects Atom feed
 *
 * Converts effects feed XML to clean JSON structure.
 * Reuses MetadataParser's effect conversion logic.
 */

import { XMLParser } from 'fast-xml-parser';
import { parseFeedMeta, SearchMeta } from './atom-parser.js';
import { MetadataParser, UnappliedEffect } from './metadata-parser.js';

/**
 * Effects response envelope
 */
export interface EffectsResponse {
  meta: SearchMeta;
  effects: UnappliedEffect[];
}

export class EffectsParser {
  private parser: XMLParser;
  private metadataParser: MetadataParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    });
    this.metadataParser = new MetadataParser();
  }

  /**
   * Parse effects feed XML into structured response.
   *
   * @param welsh - Language context: `null` (default) for standalone search results
   *   (includes both English and Welsh applied/required fields, no `outstanding`);
   *   `false` for English document context; `true` for Welsh document context
   *   (sets `outstanding` using the appropriate language's applied/required fields).
   */
  parse(xml: string, welsh: boolean | null = null): EffectsResponse {
    const obj = this.parser.parse(xml);

    const feed = obj.feed;
    if (!feed) {
      throw new Error('Unable to find feed element in effects Atom XML');
    }

    const entries = feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];

    const today = new Date().toISOString().slice(0, 10);
    const effects = entries.map((entry: any) => {
      const effect = entry.content?.Effect;
      if (!effect) {
        throw new Error('Unable to find Effect element in feed entry');
      }
      return this.metadataParser.convertEffect(effect, welsh, today);
    });

    return {
      meta: parseFeedMeta(feed),
      effects,
    };
  }
}
