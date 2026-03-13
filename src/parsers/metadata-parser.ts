/**
 * Parser for legislation metadata XML
 *
 * Converts XML metadata responses to clean JSON structure with key fields.
 * This is an experimental feature to improve AI agent usability.
 */

import { XMLParser } from 'fast-xml-parser';
import { parseLegislationUri } from '../utils/legislation-uri.js';
import { longToShortTypeMap } from '../utils/type-codes.js';

/**
 * Structured metadata extracted from legislation
 */
export interface LegislationMetadata {
  // Identification
  id: string;            // e.g., "ukpga/2020/2"
  type: string;          // e.g., "ukpga"
  year: number;          // e.g., 2020
  number: number;        // e.g., 2
  title: string;

  // Version status
  status?: string;       // "draft", "final", "revised", "proposed"

  // Geographical extent
  extent?: string[];     // ["E", "W"], ["E", "W", "S"], ["E", "W", "S", "NI"], etc. (normalized from N.I.)

  // Important dates
  enactmentDate?: string;   // When enacted (primary legislation)
  madeDate?: string;        // When made (secondary legislation)

  // Version/language of this response (if URI included them)
  version?: string;        // e.g., "enacted", "2024-01-01"
  language?: string;       // "english" or "welsh"

  // Additional metadata
  isbn?: string;            // TODO: Extract from metadata

  // Whether the legislation text is up to date (no outstanding effects)
  upToDate?: boolean;

  // Amendments enacted but not yet applied to the text
  unappliedEffects?: UnappliedEffect[];
}

export interface UnappliedEffect {
  type: string;                  // e.g. "substituted", "words repealed"
  applied: boolean;
  required: boolean;             // XML: RequiresApplied
  appliedWelsh?: boolean;
  requiredWelsh?: boolean;       // XML: RequiresWelshApplied
  outstanding?: boolean;         // required, not applied, and in force on or before today (only for document metadata)
  notes?: string;
  target: EffectSource;          // affected legislation
  source: EffectSource;          // affecting legislation
  commencement?: string;         // plain text from CommencementAuthority sections
  inForce: InForceDate[];
}

export type ProvisionRef =
  | { type: 'section'; ref: string }
  | { type: 'range'; start: string; end: string };

export interface EffectSource {
  id: string;                    // shortened URI, e.g. "ukpga/2024/10"
  type: string;                  // short type code, e.g. "ukpga"
  year: number;
  number: number;
  title: string;
  provisions?: string;           // plain text from attribute, e.g. "s. 12(7)(a)"
  refs?: ProvisionRef[];         // structured refs from AffectedProvisions/AffectingProvisions elements
  extent?: string[];             // ["E", "W", "S"] — same normalization as LegislationMetadata.extent
}

export interface InForceDate {
  date?: string;                 // ISO date string, if present
  description?: string;          // XML: Qualification
}

/**
 * Navigation links indicating which structural sections exist in a document.
 * Internal use only — not part of the public response contract.
 */
export interface NavigationLinks {
  hasIntroduction: boolean;
  hasSignature: boolean;
  hasExplanatoryNote: boolean;
  hasEarlierOrders: boolean;
}

const NAV_REL_PREFIX = 'http://www.legislation.gov.uk/def/navigation/';

export class MetadataParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true  // Strip ukm:, dc:, etc. prefixes
    });
  }

  /**
   * Parse XML metadata into structured JSON
   */
  parse(xml: string): LegislationMetadata {
    const obj = this.parser.parse(xml);

    // Debug: uncomment to see full structure
    // console.error(JSON.stringify(obj, null, 2));

    // Navigate to root Legislation element
    const legislation = obj.Legislation;

    if (!legislation) {
      throw new Error('Unable to find Legislation element in metadata XML');
    }

    const longType = this.extractLongType(legislation);
    const shortType = longToShortTypeMap.get(longType) || '';

    const parsed = this.parseDocumentUri(legislation);

    const unappliedEffects = !parsed.version
      ? this.parseUnappliedEffects(legislation, parsed.language)
      : undefined;
    const upToDate = unappliedEffects
      ? !unappliedEffects.some(e => e.outstanding)
      : undefined;

    return {
      id: parsed.id,
      type: shortType,
      year: this.extractYear(legislation),
      number: this.extractNumber(legislation),
      title: this.extractTitle(legislation),
      status: this.extractStatus(legislation),
      extent: this.extractExtent(legislation),
      enactmentDate: this.extractEnactmentDate(legislation),
      madeDate: this.extractMadeDate(legislation),
      version: parsed.version,
      language: parsed.language,
      upToDate,
      unappliedEffects,
    };
  }

  private parseDocumentUri(legislation: any): { id: string; version?: string; language?: string } {
    const fullUri = legislation['@_DocumentURI'] || '';
    if (!fullUri) return { id: '' };

    const parsed = parseLegislationUri(fullUri);
    if (!parsed) {
      // Fall back to stripping the base URL prefix
      return { id: fullUri.replace(/^https?:\/\/www\.legislation\.gov\.uk\/(id\/)?/, '') };
    }
    const id = `${parsed.type}/${parsed.year}/${parsed.number}`;
    return { id, version: parsed.version, language: parsed.language };
  }

  private extractLongType(legislation: any): string {
    const metadata = legislation?.Metadata;
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.SecondaryMetadata || metadata?.EUMetadata;
    return typeMetadata?.DocumentClassification?.DocumentMainType?.['@_Value'] || '';
  }

  private extractYear(legislation: any): number {
    const metadata = legislation?.Metadata;
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.SecondaryMetadata || metadata?.EUMetadata;
    const value = typeMetadata?.Year?.['@_Value'];
    return value ? parseInt(value, 10) : 0;
  }

  private extractNumber(legislation: any): number {
    const metadata = legislation?.Metadata;
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.SecondaryMetadata || metadata?.EUMetadata;
    const value = typeMetadata?.Number?.['@_Value'];
    return value ? parseInt(value, 10) : 0;
  }

  private extractTitle(legislation: any): string {
    const metadata = legislation?.Metadata;
    const title = metadata?.title;

    // Handle both single title and multiple titles (array)
    if (Array.isArray(title)) {
      return title[0] || '';
    }

    return title || '';
  }

  private parseExtent(extentStr: string | undefined): string[] | undefined {
    if (!extentStr) return undefined;
    return extentStr.split('+').map((code: string) => code === 'N.I.' ? 'NI' : code);
  }

  private extractExtent(legislation: any): string[] | undefined {
    return this.parseExtent(legislation?.['@_RestrictExtent']);
  }

  private extractEnactmentDate(legislation: any): string | undefined {
    const metadata = legislation?.Metadata;
    // Check PrimaryMetadata and EUMetadata (both have EnactmentDate)
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.EUMetadata;
    return typeMetadata?.EnactmentDate?.['@_Date'];
  }

  private extractMadeDate(legislation: any): string | undefined {
    const metadata = legislation?.Metadata;
    // Only SecondaryMetadata has MadeDate
    const typeMetadata = metadata?.SecondaryMetadata;
    return typeMetadata?.MadeDate?.['@_Date'];
  }

  private extractStatus(legislation: any): string | undefined {
    const metadata = legislation?.Metadata;
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.SecondaryMetadata || metadata?.EUMetadata;
    return typeMetadata?.DocumentClassification?.DocumentStatus?.['@_Value'];
  }

  private isOutstanding(effect: UnappliedEffect, today: string): boolean {
    if (effect.applied) return false;
    if (!effect.required) return false;
    return effect.inForce.some(inf => inf.date != null && inf.date <= today);
  }

  private parseUnappliedEffects(legislation: any, language?: string): UnappliedEffect[] {
    const metadata = legislation?.Metadata;
    const typeMetadata = metadata?.PrimaryMetadata || metadata?.SecondaryMetadata || metadata?.EUMetadata;
    const effects = typeMetadata?.UnappliedEffects?.UnappliedEffect;
    if (!effects) return [];

    const welsh = language === 'welsh';
    const today = new Date().toISOString().slice(0, 10);
    const effectList = Array.isArray(effects) ? effects : [effects];
    return effectList.map(e => this.convertEffect(e, welsh, today));
  }

  convertEffect(e: any, welsh: boolean | null, today: string): UnappliedEffect {
    const effect: UnappliedEffect = {
      type: e['@_Type'] || '',
      applied: e[welsh ? '@_WelshApplied' : '@_Applied'] === 'true',
      required: e[welsh ? '@_RequiresWelshApplied' : '@_RequiresApplied'] !== 'false',
      ...(welsh === null && '@_WelshApplied' in e ? {
        appliedWelsh: e['@_WelshApplied'] === 'true',
        requiredWelsh: e['@_RequiresWelshApplied'] !== 'false',
      } : {}),
      notes: e['@_Notes'] || undefined,
      target: this.convertSource(e, 'Affected', welsh),
      source: this.convertSource(e, 'Affecting', welsh),
      commencement: this.extractCommencementText(e.CommencementAuthority),
      inForce: this.convertInForce(e.InForceDates),
    };
    // outstanding only applies in a document context (welsh is boolean);
    // in a standalone effects search (welsh is null), there is no document to be outstanding against
    if (welsh !== null) {
      effect.outstanding = this.isOutstanding(effect, today);
    }
    return effect;
  }

  private extractEffectTitle(title: any, welsh: boolean | null): string {
    if (Array.isArray(title)) {
      // Bilingual: pick the title matching the requested language
      const preferred = welsh
        ? title.find((t: any) => t['@_lang'] === 'cy')
        : title.find((t: any) => !t['@_lang']);
      const value = preferred ?? title[0];
      return typeof value === 'string' ? value : value?.['#text'] || '';
    }
    if (typeof title === 'object' && title !== null) {
      return title['#text'] || '';
    }
    return title || '';
  }

  private convertSource(e: any, prefix: 'Affected' | 'Affecting', welsh: boolean | null): EffectSource {
    const uri = e[`@_${prefix}URI`] || '';
    const parsed = parseLegislationUri(uri);
    const id = parsed ? `${parsed.type}/${parsed.year}/${parsed.number}` : '';

    const longType = e[`@_${prefix}Class`] || '';
    const type = longToShortTypeMap.get(longType) || '';

    const extent = this.parseExtent(e[`@_${prefix}Extent`]);

    return {
      id,
      type,
      year: parseInt(e[`@_${prefix}Year`], 10) || 0,
      number: parseInt(e[`@_${prefix}Number`], 10) || 0,
      title: this.extractEffectTitle(e[`${prefix}Title`], welsh),
      provisions: e[`@_${prefix}Provisions`] || undefined,
      refs: this.parseProvisionRefs(e[`${prefix}Provisions`]),
      extent,
    };
  }

  private parseProvisionRefs(container: any): ProvisionRef[] | undefined {
    if (!container || typeof container !== 'object') return undefined;

    const refs: ProvisionRef[] = [];

    if (container.Section) {
      const sections = Array.isArray(container.Section) ? container.Section : [container.Section];
      for (const s of sections) {
        const ref = this.uriToElementId(s['@_URI']);
        if (ref) refs.push({ type: 'section', ref });
      }
    }

    if (container.SectionRange) {
      const ranges = Array.isArray(container.SectionRange) ? container.SectionRange : [container.SectionRange];
      for (const r of ranges) {
        const start = this.uriToElementId(r['@_URI']);
        const end = this.uriToElementId(r['@_UpTo']);
        if (start && end) refs.push({ type: 'range', start, end });
      }
    }

    return refs.length > 0 ? refs : undefined;
  }

  /** Extract an element ID from a provision URI (e.g. ".../section/40B" → "section-40B"). */
  private uriToElementId(uri: string | undefined): string | undefined {
    if (!uri) return undefined;
    return parseLegislationUri(uri)?.fragment?.replace(/\//g, '-');
  }

  private convertInForce(inForceDates: any): InForceDate[] {
    if (!inForceDates?.InForce) return [];
    const items = Array.isArray(inForceDates.InForce) ? inForceDates.InForce : [inForceDates.InForce];
    return items.map((inf: any) => ({
      date: inf['@_Date'] || undefined,
      description: inf['@_Qualification'] || undefined,
    }));
  }

  private extractCommencementText(ca: any): string | undefined {
    if (!ca) return undefined;
    const sections = ca.Section;
    if (!sections) return undefined;

    const sectionList = Array.isArray(sections) ? sections : [sections];
    const texts = sectionList
      .map((s: any) => typeof s === 'string' ? s : s['#text'] || '')
      .filter(Boolean);
    return texts.length > 0 ? texts.join(' ') : undefined;
  }

  /**
   * Extract navigation links from atom:link elements in the Metadata.
   * These indicate which structural sections (introduction, signature, etc.) exist.
   */
  parseNavigationLinks(xml: string): NavigationLinks {
    const obj = this.parser.parse(xml);
    const metadata = obj?.Legislation?.Metadata;

    const rels = new Set<string>();

    if (metadata?.link) {
      const links = Array.isArray(metadata.link) ? metadata.link : [metadata.link];
      for (const link of links) {
        const rel = link['@_rel'];
        if (typeof rel === 'string' && rel.startsWith(NAV_REL_PREFIX)) {
          rels.add(rel.substring(NAV_REL_PREFIX.length));
        }
      }
    }

    return {
      hasIntroduction: rels.has('introduction'),
      hasSignature: rels.has('signature'),
      hasExplanatoryNote: rels.has('note'),
      hasEarlierOrders: rels.has('earlier-orders'),
    };
  }
}
