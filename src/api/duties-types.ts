/**
 * Shared contract for the powers-and-duties tools.
 *
 * Backend-agnostic surface: the row/filter/result types, the `DutiesDbApi`
 * interface the adapter implements, and the two boundary helpers the tool
 * layer calls before touching a backend (`normalizeEnactmentUri`,
 * `validateDutyFilters`). The Aurora Postgres adapter (`duties-db-pg.ts`) and
 * the tools import from here. There is no SQLite adapter — it was removed once
 * Postgres was confirmed in production (docs/adr/2026-05-29-postgres-migration-plan.md
 * §Phase 5).
 */

export type Modality = "duty" | "power";
export type Inference = "explicit" | "implicit";
export type Priority = "primary" | "secondary";

/**
 * One resolution of an actor term.
 *
 * Source CSVs encode "duty applies to NHS body, where NHS body means a Local
 * Health Board or an NHS trust" as two near-identical rows differing only in
 * `actorIsAlias`. We collapse those into one DutyRow whose `actorAliases`
 * array carries one entry per resolved instance. For ~97.7% of duties this
 * has one entry; ~2.3% have 2–43.
 */
export interface ActorAlias {
  name: string;
  /**
   * Canonical legislation.gov.uk organisation URI for this resolved instance
   * (e.g. .../id/organisation/FoodStandardsAgency_UnitedKingdom) when the
   * source links one; null otherwise (~91% of entries). Dereferenceable
   * linked data.
   */
  bodyUri: string | null;
}

export interface DutyRow {
  dutyId: number;
  dutyUri: string;
  enactmentUri: string;
  enactmentTitle: string;
  enactmentYear: number | null;
  enactmentType: string;
  enactmentNum: string;
  sectionUri: string | null;
  subsection: string | null;
  actor: string | null;
  actorDefinition: string | null;
  actorAliases: ActorAlias[];
  modality: Modality;
  action: string;
  condition: string | null;
  inference: Inference;
  priority: Priority;
  extractedAsOf: string | null;
}

export interface SearchFilters {
  query?: string;
  enactmentUri?: string;
  enactmentType?: string[];
  yearFrom?: number;
  yearTo?: number;
  actor?: string;
  modality?: Modality;
  priority?: Priority;
  inference?: Inference;
}

/**
 * The subset of SearchFilters that get_powers_and_duties can layer on top of a
 * single enactment (the enactment itself is supplied separately).
 */
export type ProvisionFilters = Pick<SearchFilters, "modality" | "priority" | "inference">;

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  morePages: boolean;
  rows: DutyRow[];
}

/**
 * Canonicalise an enactment reference to the form stored in the DB:
 * `http://www.legislation.gov.uk/id/<type>/<year>/<number>` (no trailing slash).
 *
 * The tools advertise the short document-identifier form (`ukpga/2010/15`),
 * matching the rest of the server, but accept essentially any form a user or
 * model might supply and converge it on the stored URI:
 *
 * - Bare identifier: `ukpga/2010/15` (or a regnal tail like `aep/Ann/6/11`,
 *   or one with a leading `id/`) → prefixed with the canonical host + `/id/`.
 * - Live document URL: `https://www.legislation.gov.uk/ukpga/2010/15` → `/id/`
 *   segment inserted, scheme lowered to http.
 * - Full `/id/` URI: passed through (host/scheme/trailing-slash normalised).
 * - Bare domain (no `www`) or mixed-case host → canonical lowercase `www` host.
 *
 * It does NOT parse the identifier's internal structure, so multi-segment
 * regnal-year forms work too — it only ensures the `…/id/<tail>` shape.
 * Unrecognised absolute URLs are returned as-is (defensive: the exact-match
 * filter simply won't find them).
 */
export function normalizeEnactmentUri(uri: string): string {
  let u = uri.trim();
  // Scheme → http (the stored form is http, not https).
  u = u.replace(/^https?:\/\//i, "http://");
  // Canonicalise the legislation.gov.uk host (any case, optional www) to the
  // stored lowercase www form.
  u = u.replace(/^http:\/\/(?:www\.)?legislation\.gov\.uk\//i, "http://www.legislation.gov.uk/");
  if (/^http:\/\/www\.legislation\.gov\.uk\//.test(u)) {
    // A legislation.gov.uk URL: insert the /id/ segment if the live form
    // (without /id/) was supplied.
    u = u.replace(/^(http:\/\/www\.legislation\.gov\.uk)\/(?!id\/)/, "$1/id/");
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    // No scheme → a bare document identifier (e.g. `ukpga/2010/15`), possibly
    // with a leading `id/` or slashes. Prepend the canonical prefix.
    const tail = u.replace(/^\/+/, "").replace(/^id\//i, "");
    u = `http://www.legislation.gov.uk/id/${tail}`;
  }
  // Strip any trailing slashes.
  u = u.replace(/\/+$/, "");
  return u;
}

export type GroupBy =
  | "enactment_type"
  | "enactment_year"
  | "actor"
  | "modality"
  | "priority"
  | "inference"
  | "enactment_uri";

export interface CountResult {
  total: number;
  groupBy: GroupBy | null;
  /** Effective LIMIT applied to the grouped query, or null for ungrouped counts. */
  groupLimit: number | null;
  /** Number of group entries actually returned (always equals `groups.length`). */
  groupsReturned: number;
  /** True if there were strictly more groups than `groupLimit` and the response was cut. */
  groupsTruncated: boolean;
  /**
   * `title` is present only when grouping by `enactment_uri`: the enactment's
   * title, so the otherwise-opaque URI key is human-readable in one call.
   * Other group dimensions have self-describing keys and omit it.
   */
  groups: Array<{ key: string | number | null; count: number; title?: string }>;
}

export interface CountOptions {
  /**
   * Maximum number of groups to return when group_by is set. Groups are
   * returned top-by-count (descending). Ignored when group_by is null.
   *
   * User-supplied values must be normalised at the tool boundary
   * (count-powers-and-duties.ts caps at 200). The adapter trusts whatever it
   * receives — tests and other internal callers may deliberately pass
   * larger values to exercise invariants that the tool cap would hide.
   */
  groupLimit?: number;
}

// Input caps. The dataset has ~25 distinct enactment types; legitimate URIs
// and actor names are short. These limits exist to fail fast on malformed
// or abusive inputs, not to constrain legitimate use.
const MAX_ENACTMENT_TYPES = 32;
const MAX_ENACTMENT_TYPE_ITEM_LEN = 64;
const MAX_STRING_LEN = 500;

const MODALITY_VALUES = new Set<string>(["duty", "power"]);
const PRIORITY_VALUES = new Set<string>(["primary", "secondary"]);
const INFERENCE_VALUES = new Set<string>(["explicit", "implicit"]);

/**
 * Validate user-supplied duty-tool inputs at the MCP boundary.
 *
 * MCP passes tool arguments as `any`, so by the time these reach the
 * adapter, TypeScript's compile-time types are gone. This function performs
 * the runtime checks: type (string / array / number), value membership
 * (enum literals), and size caps. Returns a human-readable error message
 * on the first violation, or null when everything is acceptable.
 */
export function validateDutyFilters(input: unknown): string | null {
  if (input === null || typeof input !== "object") {
    return "tool arguments must be an object";
  }
  const args = input as Record<string, unknown>;

  // Strings
  const stringErr = checkString(args, "query");
  if (stringErr) return stringErr;
  const actorErr = checkString(args, "actor");
  if (actorErr) return actorErr;
  const enactmentErr = checkString(args, "enactment");
  if (enactmentErr) return enactmentErr;

  // enactment_type: array of short strings, capped count
  if (args.enactment_type !== undefined) {
    const arr = args.enactment_type;
    if (!Array.isArray(arr)) return "enactment_type must be an array of strings";
    if (arr.length > MAX_ENACTMENT_TYPES) {
      return `enactment_type has too many values (${arr.length}, max ${MAX_ENACTMENT_TYPES})`;
    }
    for (const t of arr) {
      if (typeof t !== "string") return "enactment_type items must be strings";
      if (t.length === 0) return "enactment_type items must be non-empty";
      if (t.length > MAX_ENACTMENT_TYPE_ITEM_LEN) {
        return `enactment_type item is too long (${t.length} chars, max ${MAX_ENACTMENT_TYPE_ITEM_LEN})`;
      }
    }
  }

  // Numeric year bounds
  const yfErr = checkFiniteNumber(args, "year_from");
  if (yfErr) return yfErr;
  const ytErr = checkFiniteNumber(args, "year_to");
  if (ytErr) return ytErr;
  const glErr = checkFiniteNumber(args, "group_limit");
  if (glErr) return glErr;

  // Enum strings
  const modErr = checkEnum(args, "modality", MODALITY_VALUES);
  if (modErr) return modErr;
  const prErr = checkEnum(args, "priority", PRIORITY_VALUES);
  if (prErr) return prErr;
  const infErr = checkEnum(args, "inference", INFERENCE_VALUES);
  if (infErr) return infErr;

  return null;
}

function checkString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (v === undefined) return null;
  if (typeof v !== "string") return `${key} must be a string`;
  if (v.length > MAX_STRING_LEN) {
    return `${key} is too long (${v.length} chars, max ${MAX_STRING_LEN})`;
  }
  return null;
}

function checkFiniteNumber(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return `${key} must be a finite number`;
  }
  return null;
}

function checkEnum(
  args: Record<string, unknown>,
  key: string,
  allowed: Set<string>,
): string | null {
  const v = args[key];
  if (v === undefined) return null;
  if (typeof v !== "string" || !allowed.has(v)) {
    const allowedList = [...allowed].map(s => `'${s}'`).join(", ");
    return `${key} must be one of ${allowedList}`;
  }
  return null;
}

/**
 * Public surface the Postgres-via-Data-API adapter (`duties-db-pg.ts`)
 * implements. Tool code takes this type so the backend is swappable.
 */
export interface DutiesDbApi {
  search(filters: SearchFilters, page: number, pageSize: number): Promise<SearchResult>;
  count(filters: SearchFilters, groupBy: GroupBy | null, options?: CountOptions): Promise<CountResult>;
  getForEnactment(
    enactmentUri: string,
    page: number,
    pageSize: number,
    filters?: ProvisionFilters,
  ): Promise<SearchResult>;
  smokeTest(): Promise<{ filterRows: number; ftsRows: number }>;
  close(): void;
}
