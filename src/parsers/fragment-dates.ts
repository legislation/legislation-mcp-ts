/**
 * A fragment's start date and later date, read from its content.
 *
 * The hasVersion links can't be relied on to name a fragment's own version.
 * On a dated request legislation.gov.uk leaves the requested version out of
 * them, as the response's own address, and lists `current` instead; a whole
 * document gets the date back from `dct:valid`, but a fragment's `dct:valid`
 * is its document's snapshot date, which can be a date on which only another
 * part changed. The links also miss some changes altogether:
 * ukpga/2010/15/schedule/1 gained paragraph 5A on 2024-01-01, and none of its
 * links carries that date. The parser adds the dates read here to `versions`,
 * as if links had named them.
 *
 * This follows the LGU2 API (ADR 2026-10-19, "fragment version from content";
 * the `start-date` and `content-date` templates in its simplify/metadata.xsl),
 * which ports the legacy site's `$startDate` from toc_xhtml.xsl:
 *
 * - The provision is the target's nearest ancestor-or-self P1, else its
 *   nearest ancestor P1group, else the target. A sub-provision is read as its
 *   provision, because a provision is versioned as a whole (this step is the
 *   API's own).
 * - The section is the provision's parent if that is a P1group, so a P1 is
 *   read with its heading, else the provision.
 * - The date is the latest @RestrictStartDate on the section or anything in
 *   it, and on the alternative versions named by its @AltVersionRefs (other
 *   extents' versions of the same provision). An element marked
 *   Match="false" doesn't count, but the elements inside it still do.
 * - Failing that, the section's own @RestrictStartDate, even if the section is
 *   marked Match="false".
 * - A table (Tabular or Subtable) takes the date of its nearest ancestor that
 *   carries one.
 *
 * The start date is held to `dct:valid`, since the returned version can't have
 * started later (also the API's own step). The later date is the date read
 * without that limit, kept when it is after `dct:valid`: a later version, as
 * the legacy timeline lists it.
 */

import { TreeElement, attribute, childElements, descendantsOrSelf, hasAttribute } from './xml-tree.js';

export interface FragmentDates {
  /** The date the returned version started. Absent if no date is left once the limit applies. */
  startDate?: string;
  /** A date after `dct:valid`, read without the limit: a later version. */
  laterDate?: string;
}

/**
 * Read the dates for the fragment at the end of `path`, the path from the
 * document root to the fragment's element. `valid` is the response's
 * `dct:valid`, if any.
 */
export function readFragmentDates(path: TreeElement[], valid: string | undefined): FragmentDates {
  const limit = calendarDate(valid);
  const startDate = contentDate(path, limit);
  const unlimited = contentDate(path, undefined);
  const laterDate = limit !== undefined && unlimited !== undefined && unlimited > limit
    ? unlimited
    : undefined;
  return { startDate, laterDate };
}

/** The date read from the content by the rule above, held to `limit` if there is one. */
function contentDate(path: TreeElement[], limit: string | undefined): string | undefined {
  const t = path.length - 1;
  const target = path[t];

  if (target.tag === 'Tabular' || target.tag === 'Subtable') {
    const dated = path.slice(0, t).reverse().find(e => hasAttribute(e, 'RestrictStartDate'));
    return notAfter(dated && calendarDate(attribute(dated, 'RestrictStartDate')), limit);
  }

  let provision = lastIndexOfTag(path, 'P1', t);
  if (provision < 0) provision = lastIndexOfTag(path, 'P1group', t - 1);
  if (provision < 0) provision = t;
  const section = provision > 0 && path[provision - 1].tag === 'P1group'
    ? path[provision - 1]
    : path[provision];

  let latest: string | undefined;
  for (const scope of [section, ...alternatives(section, path[0])]) {
    for (const element of descendantsOrSelf(scope)) {
      if (attribute(element, 'Match') === 'false') continue;
      const date = notAfter(calendarDate(attribute(element, 'RestrictStartDate')), limit);
      if (date !== undefined && (latest === undefined || date > latest)) latest = date;
    }
  }
  return latest ?? notAfter(calendarDate(attribute(section, 'RestrictStartDate')), limit);
}

/** The index of the last element in path[0..from] with the tag, or -1. */
function lastIndexOfTag(path: TreeElement[], tag: string, from: number): number {
  for (let i = from; i >= 0; i--) {
    if (path[i].tag === tag) return i;
  }
  return -1;
}

/**
 * The alternative versions named by the section's @AltVersionRefs: the child
 * elements of each element whose @id is one of its tokens (in practice a
 * Versions/Version element).
 */
function alternatives(section: TreeElement, root: TreeElement): TreeElement[] {
  const refs = new Set((attribute(section, 'AltVersionRefs') ?? '').split(/\s+/).filter(Boolean));
  if (refs.size === 0) return [];
  const result: TreeElement[] = [];
  for (const element of descendantsOrSelf(root)) {
    const id = attribute(element, 'id');
    if (id !== undefined && refs.has(id)) result.push(...childElements(element.node));
  }
  return result;
}

function notAfter(date: string | undefined, limit: string | undefined): string | undefined {
  return date !== undefined && (limit === undefined || date <= limit) ? date : undefined;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The value as a calendar date (`YYYY-MM-DD`), if it is a valid date with or
 * without a timezone. The timezone is dropped and the date kept as written.
 */
function calendarDate(value: string | undefined): string | undefined {
  const match = value === undefined ? null : DATE_RE.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (month < 1 || month > 12 || day < 1 || day > days) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
