/**
 * Parser for legislation metadata XML
 *
 * Converts XML metadata responses to clean JSON structure with key fields.
 * This is an experimental feature to improve AI agent usability.
 */

import { XMLParser } from 'fast-xml-parser';
import { ISO_DATE_RE, parseLegislationUri } from '../utils/legislation-uri.js';
import { longToShortTypeMap, getFirstVersion } from '../utils/type-codes.js';
import { compareVersions } from '../utils/version-sort.js';

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

  // Whether the content is prospective (not yet in force)
  prospective?: boolean;

  // Available milestone version labels.
  // Most labels are usable as the version parameter; "prospective" is a
  // label-only entry fetched via the versionless URL.
  // Only present for unversioned requests — like upToDate and unappliedEffects
  versions?: string[];

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
   * Parse XML metadata into structured JSON.
   * Always populates all fields. The caller is responsible for suppressing
   * fields that are not meaningful for the request context (e.g. versions
   * and unappliedEffects for versioned requests).
   */
  parse(xml: string): LegislationMetadata {
    const obj = this.parser.parse(xml);

    // Navigate to root Legislation element
    const legislation = obj.Legislation;

    if (!legislation) {
      throw new Error('Unable to find Legislation element in metadata XML');
    }

    const longType = this.extractLongType(legislation);
    const shortType = longToShortTypeMap.get(longType) || '';
    const metadata = legislation?.Metadata;

    const parsed = this.parseDocumentUri(legislation);
    const status = this.extractStatus(legislation);

    const unappliedEffects = this.parseUnappliedEffects(legislation, parsed.language);
    const upToDate = !unappliedEffects.some(e => e.outstanding);

    const fragmentId = this.extractFragmentId(legislation);
    const prospective = this.extractProspective(legislation, fragmentId);
    const responseLanguage = this.extractResponseLanguage(metadata, parsed.language);

    const versions = this.extractVersions(
      legislation, shortType, status, prospective, responseLanguage,
      fragmentId !== undefined
    );

    return {
      id: parsed.id,
      type: shortType,
      year: this.extractYear(legislation),
      number: this.extractNumber(legislation),
      title: this.extractTitle(legislation),
      status,
      extent: this.extractExtent(legislation),
      enactmentDate: this.extractEnactmentDate(legislation),
      madeDate: this.extractMadeDate(legislation),
      version: parsed.version,
      language: parsed.language,
      prospective: prospective || undefined,
      versions,
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

  private extractResponseLanguage(metadata: any, parsedLanguage: string | undefined): 'en' | 'cy' | undefined {
    if (parsedLanguage === 'english') return 'en';
    if (parsedLanguage === 'welsh') return 'cy';

    const raw = metadata?.language;
    // We expect at most one dc:language value here in modern legislation XML.
    const language = Array.isArray(raw) ? raw[0] : raw;
    if (language === 'en' || language === 'english') return 'en';
    if (language === 'cy' || language === 'welsh') return 'cy';

    return undefined;
  }

  private static readonly HAS_VERSION_REL = 'http://purl.org/dc/terms/hasVersion';
  private static readonly REPEALED_SUFFIX = ' repealed';

  /**
   * Build a sorted list of available version labels in the scope of the response
   * (whole-document or fragment), mirroring the Java API's `Metadata.versions()`.
   *
   *  1. Collect `@title` values from `hasVersion` links whose `@hreflang` matches
   *     the response language, plus any untagged links.
   *  2. Strip trailing " repealed" suffixes (e.g. "2020-01-01 repealed" → "2020-01-01").
   *  3. Remove the "current" alias, remembering whether it was present and whether
   *     it was the only retained label.
   *  4. For final-status documents, ensure the first-version keyword is present;
   *     if "current" was the only retained label, also add label-only "prospective".
   *  5. For revised prospective content, add label-only "prospective".
   *  6. Otherwise, for non-final content with `dct:valid`, recover it as a version
   *     label only when "current" was present AND either the response is
   *     whole-document or the retained fragment set has no other dated labels.
   *     (A fragment's `dct:valid` may be a containing-document snapshot date rather
   *     than a fragment milestone.)
   *  7. Sort: first-version keywords, then dates chronologically, then "prospective".
   *
   * Only called for unversioned requests (versions is undefined for versioned requests).
   */
  private extractVersions(
    legislation: any,
    shortType: string,
    status: string | undefined,
    prospective: boolean,
    responseLanguage: 'en' | 'cy' | undefined,
    isFragment: boolean
  ): string[] {
    const metadata = legislation?.Metadata;
    const labels = new Set<string>();
    let sawCurrent = false;

    const links = metadata?.link;
    if (links) {
      const linkList = Array.isArray(links) ? links : [links];
      for (const link of linkList) {
        if (link['@_rel'] !== MetadataParser.HAS_VERSION_REL) continue;
        const hrefLang = link['@_hreflang'];
        if (responseLanguage && hrefLang && hrefLang !== responseLanguage) continue;
        let title: string = link['@_title'];
        if (!title) continue;

        if (title.endsWith(MetadataParser.REPEALED_SUFFIX)) {
          title = title.slice(0, -MetadataParser.REPEALED_SUFFIX.length);
        }

        if (title === 'current') {
          sawCurrent = true;
          continue;
        }

        labels.add(title);
      }
    }

    const isFinal = status === 'final';
    const isRevised = status === 'revised';
    const onlyCurrent = sawCurrent && labels.size === 0;

    if (isFinal) {
      const firstVersion = getFirstVersion(shortType);
      if (firstVersion) labels.add(firstVersion);
      if (onlyCurrent) labels.add('prospective');
    }

    if (prospective && isRevised) {
      labels.add('prospective');
    } else if (!isFinal) {
      const valid = this.extractValid(metadata);
      if (valid && MetadataParser.shouldRecoverValidDate(sawCurrent, labels, isFragment)) {
        labels.add(valid);
      }
    }

    return [...labels].sort(compareVersions);
  }

  /**
   * Non-prospective dct:valid recovery: only treat dct:valid as a version label when
   * "current" was stripped from the scoped links, and either the response is
   * whole-document or the retained fragment set has no other dated labels (in which
   * case dct:valid stands in as the only pointer to the returned representation).
   */
  private static shouldRecoverValidDate(hadCurrent: boolean, labels: Set<string>, isFragment: boolean): boolean {
    if (!hadCurrent) return false;
    if (!isFragment) return true;
    for (const label of labels) {
      if (ISO_DATE_RE.test(label)) return false;
    }
    return true;
  }

  /**
   * Check whether the content is prospective (not yet in force).
   * For fragment requests, checks the fragment element's Status attribute.
   * P1 elements inherit Status from their parent P1group, so when the
   * fragment is a P1 without its own Status, we check the P1group parent.
   * For whole-document requests, checks the root Legislation element.
   */
  private extractProspective(legislation: any, fragmentId: string | undefined): boolean {
    if (fragmentId) {
      const elementId = fragmentId.replace(/\//g, '-');
      const result = this.findElementAndParentById(legislation, elementId);
      if (!result) return false;
      if (result.element?.['@_Status'] === 'Prospective') return true;
      if (result.parentTag === 'P1group' && result.parent?.['@_Status'] === 'Prospective') return true;
      return false;
    }
    return legislation?.['@_Status'] === 'Prospective';
  }

  /**
   * Extract the fragment path from dc:identifier (e.g. "section/1" from
   * "http://www.legislation.gov.uk/ukpga/2026/5/section/1").
   */
  private extractFragmentId(legislation: any): string | undefined {
    const raw = legislation?.Metadata?.identifier;
    // Per data engineering guidance, the first dc:identifier is the canonical URI to use here.
    const identifier = Array.isArray(raw) ? raw[0] : raw;
    if (!identifier || typeof identifier !== 'string') return undefined;
    return parseLegislationUri(identifier)?.fragment;
  }

  /**
   * Recursively search the parsed XML tree for an element with a matching @_id attribute.
   * Returns the element together with its immediate parent and the parent's tag name,
   * so callers can check inherited attributes (e.g. P1 inheriting Status from P1group).
   *
   * @param nodeTag - the tag name of `node` (the key its own parent used to store it)
   * @param parentNode - the object containing `node`
   * @param parentTag - the tag name of `parentNode`
   */
  private findElementAndParentById(
    node: any,
    id: string,
    nodeTag?: string,
    parentNode?: any,
    parentTag?: string
  ): { element: any; parent?: any; parentTag?: string } | undefined {
    if (node == null || typeof node !== 'object') return undefined;

    if (node['@_id'] === id) return { element: node, parent: parentNode, parentTag };

    for (const key of Object.keys(node)) {
      if (key.startsWith('@_')) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = this.findElementAndParentById(item, id, key, node, nodeTag);
          if (found) return found;
        }
      } else {
        const found = this.findElementAndParentById(child, id, key, node, nodeTag);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Extract the dct:valid date from metadata (namespace prefix stripped by parser). */
  private extractValid(metadata: any): string | undefined {
    const valid = metadata?.valid;
    if (typeof valid === 'string') return valid;
    return undefined;
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
