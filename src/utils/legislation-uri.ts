/**
 * Parser for legislation.gov.uk URIs
 *
 * Legislation URIs follow the pattern:
 *   [baseUrl/[id/]] type / year / number [/ fragment] [/ version] [/ language]
 *
 * Where:
 *   type     - legislation type code (e.g., "ukpga", "uksi")
 *   year     - 4-digit calendar year (e.g., "2020") or regnal year (e.g., "Geo5/4-5")
 *   number   - legislation number (always a positive integer)
 *   fragment - optional structural path (e.g., "section/1", "part/2/chapter/3")
 *   version  - optional: ISO date (YYYY-MM-DD) or first-version enum (enacted/made/created/adopted)
 *   language - optional: "english" or "welsh"
 *
 * Algorithm:
 *   1. Strip base URL prefix
 *   2. Parse type, year, number from the start (year is 1 or 2 segments)
 *   3. Pop language and version from the end
 *   4. Whatever remains is the fragment
 */

import { FIRST_VERSION_KEYWORDS } from './version-sort.js';

export interface ParsedLegislationUri {
  type: string;
  year: string;
  number: string;
  fragment?: string;
  version?: string;
  language?: string;
}

const OTHER_VERSION_KEYWORDS = ["prospective", "current"];
const LANGUAGES = ["english", "welsh"];
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_YEAR_RE = /^\d{4}$/;

const NUMBER_RE = /^\d+$/;

/**
 * Parse a legislation.gov.uk URI or path into its components.
 *
 * Accepts full URIs (http://www.legislation.gov.uk/id/ukpga/2020/2),
 * id-prefixed paths (id/ukpga/2020/2), or bare paths (ukpga/2020/2).
 *
 * Returns null if the URI doesn't have enough segments to extract
 * type, year, and number.
 */
export function parseLegislationUri(uri: string): ParsedLegislationUri | null {
  // Strip base URL prefix
  let path = uri.replace(/^https?:\/\/www\.legislation\.gov\.uk\//, "");
  path = path.replace(/^\//, "");

  // Strip leading "id/" independently, in case we receive a bare id/... path
  path = path.replace(/^id\//, "");

  const segments = path.split("/").filter(Boolean);
  let i = 0;

  // Need at least 3 segments: type, year (1 or 2 segments), number
  if (segments.length < 3) return null;

  // Type: first segment
  const type = segments[i++];

  // Year: calendar (1 segment) or regnal (2 segments)
  let year: string;
  if (CALENDAR_YEAR_RE.test(segments[i])) {
    year = segments[i++];
  } else {
    // Regnal year needs two segments
    if (i + 1 >= segments.length) return null;
    const reign = segments[i++];
    const regnalYear = segments[i++];
    year = `${reign}/${regnalYear}`;
  }

  // Number: next segment (always purely numeric)
  if (i >= segments.length || !NUMBER_RE.test(segments[i])) return null;
  const number = segments[i++];

  // Remaining segments may include fragment, version, language
  const remaining = segments.slice(i);

  // Pop language from end
  let language: string | undefined;
  if (remaining.length > 0 && LANGUAGES.includes(remaining[remaining.length - 1])) {
    language = remaining.pop()!;
  }

  // Pop version from end
  let version: string | undefined;
  if (remaining.length > 0) {
    const last = remaining[remaining.length - 1];
    if (ISO_DATE_RE.test(last) || FIRST_VERSION_KEYWORDS.has(last) || OTHER_VERSION_KEYWORDS.includes(last)) {
      version = remaining.pop()!;
    }
  }

  // Whatever's left is the fragment
  const fragment = remaining.length > 0 ? remaining.join("/") : undefined;

  return { type, year, number, fragment, version, language };
}
