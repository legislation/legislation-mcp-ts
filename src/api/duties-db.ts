/**
 * Adapter for the powers-and-duties SQLite database.
 *
 * Single point of `node:sqlite` usage in the codebase. If the API surface
 * changes in a future Node release, this is the only file affected.
 *
 * The database is built by `scripts/build-duties-db.js` from CSV files.
 * If `data/duties.db` is not present at startup, this module returns null
 * from the openDuties() factory and the related tools are not registered.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname is build/api/ at runtime; the DB lives at data/duties.db two
// levels up from build/api/.
const DEFAULT_DB_PATH = join(__dirname, "..", "..", "data", "duties.db");

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

const SELECT_COLUMNS = `
  duty_id, duty_uri, enactment_uri, enactment_title, enactment_year,
  enactment_type, enactment_num, section_uri, subsection, actor,
  actor_is_alias, actor_definition, body_uri, modality,
  action, condition, inference, priority, version_date
`;

interface RawRow {
  duty_id: number;
  duty_uri: string;
  enactment_uri: string;
  enactment_title: string;
  enactment_year: number | null;
  enactment_type: string;
  enactment_num: string;
  section_uri: string | null;
  subsection: string | null;
  actor: string | null;
  actor_is_alias: string | null;
  actor_definition: string | null;
  body_uri: string | null;
  modality: Modality;
  action: string;
  condition: string | null;
  inference: Inference;
  priority: Priority;
  version_date: string | null;
}

function rowToDuty(r: RawRow): DutyRow {
  // SQLite schema stores the per-row alias inline (one row per alias). The
  // build script deduped to "first row encountered", so we only ever see one
  // alias here. Synthesise the single-element actorAliases array to match
  // the shared DutyRow shape used by the Postgres backend.
  const actorAliases: ActorAlias[] = r.actor_is_alias
    ? [{ name: r.actor_is_alias, bodyUri: r.body_uri }]
    : [];
  return {
    dutyId: r.duty_id,
    dutyUri: r.duty_uri,
    enactmentUri: r.enactment_uri,
    enactmentTitle: r.enactment_title,
    enactmentYear: r.enactment_year,
    enactmentType: r.enactment_type,
    enactmentNum: r.enactment_num,
    sectionUri: r.section_uri,
    subsection: r.subsection,
    actor: r.actor,
    actorDefinition: r.actor_definition,
    actorAliases,
    modality: r.modality,
    action: r.action,
    condition: r.condition,
    inference: r.inference,
    priority: r.priority,
    extractedAsOf: r.version_date,
  };
}

const GROUP_BY_COLUMN: Record<GroupBy, string> = {
  enactment_type: "enactment_type",
  enactment_year: "enactment_year",
  actor: "actor",
  modality: "modality",
  priority: "priority",
  inference: "inference",
  enactment_uri: "enactment_uri",
};

/**
 * Translate natural-text input into a safe FTS5 MATCH expression.
 *
 * The raw user query cannot be passed to FTS5 directly: apostrophes,
 * parentheses, unbalanced quotes, hyphens-touching-letters, and stray
 * operators all raise "fts5: syntax error". We treat the input as plain
 * natural language by default:
 *
 * 1. Extract double-quoted segments as phrase tokens (preserving them).
 * 2. Tokenise the remainder on whitespace.
 * 3. Within each token, strip FTS5 metacharacters (`"`, `(`, `)`, `*`, `:`)
 *    and reject the token if nothing alphanumeric remains.
 * 4. Wrap each surviving token in double quotes (an FTS5 phrase literal,
 *    safe even when the token contains hyphens or apostrophe-like chars
 *    that the unicode61 tokenizer would otherwise split on).
 * 5. Join with implicit AND (space-separated, which FTS5 treats as AND).
 *
 * Returns null if the cleaned input is empty (caller should treat as
 * "no FTS clause"), avoiding the no-rows surprise of MATCH ''.
 */
export function buildFtsExpression(raw: string): string | null {
  const phrases: string[] = [];
  let remainder = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1);
      if (end < 0) {
        // unterminated quote — treat the rest as a phrase
        const inner = raw.slice(i + 1).trim();
        if (inner) phrases.push(inner);
        break;
      }
      const inner = raw.slice(i + 1, end).trim();
      if (inner) phrases.push(inner);
      i = end + 1;
    } else {
      remainder += raw[i];
      i++;
    }
  }

  const wordTokens = remainder
    .split(/\s+/)
    .map(t => t.replace(/["()*:]/g, "").trim())
    .filter(t => /[a-zA-Z0-9]/.test(t));

  const allTokens = [...phrases, ...wordTokens]
    .map(t => t.replace(/"/g, "")) // any stray quotes inside phrases
    .filter(t => t.length > 0)
    .map(t => `"${t}"`);

  if (allTokens.length === 0) return null;
  return allTokens.join(" ");
}

/** Escape LIKE metacharacters so user input matches literally under `LIKE … ESCAPE '\'`. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
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

/** SQL fragments for the filter set, plus the parameters they bind. */
function buildWhere(filters: SearchFilters): { sql: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.query) {
    const expr = buildFtsExpression(filters.query);
    if (expr !== null) {
      conditions.push(`duty_id IN (SELECT rowid FROM duties_fts WHERE duties_fts MATCH ?)`);
      params.push(expr);
    }
  }
  if (filters.enactmentUri) {
    conditions.push("enactment_uri = ?");
    params.push(filters.enactmentUri);
  }
  if (filters.enactmentType && filters.enactmentType.length > 0) {
    const placeholders = filters.enactmentType.map(() => "?").join(",");
    conditions.push(`enactment_type IN (${placeholders})`);
    params.push(...filters.enactmentType);
  }
  if (filters.yearFrom !== undefined) {
    conditions.push("enactment_year >= ?");
    params.push(filters.yearFrom);
  }
  if (filters.yearTo !== undefined) {
    conditions.push("enactment_year <= ?");
    params.push(filters.yearTo);
  }
  if (filters.actor) {
    // Match the actor term OR a resolved alias, mirroring the Postgres backend,
    // via two complementary mechanisms:
    //   1. Substring LIKE (escaped) on the term and the surviving alias —
    //      catches partial tokens ("authorit") and longer-term containment
    //      ("Secretary of State" matches "Secretary of State for Health").
    //   2. A stemmed match on the actor column through the porter-tokenized
    //      duties_fts index, scoped with the `{actor}:` column filter so it
    //      matches the actor term only, NOT action/condition text. This makes
    //      the filter inflection-aware: "local authorities" now also finds
    //      "local authority" (both stem alike). buildFtsExpression keeps the
    //      operand safe; a null result (punctuation-only input) drops the FTS
    //      disjunct, leaving the escaped LIKE to carry the result.
    // FTS covers the term only (aliases aren't indexed in duties_fts); the
    // alias LIKE above still matches alias names. The SQLite build dedupes a
    // multi-alias duty to its first row (INSERT OR IGNORE on duty_id), so only
    // the surviving alias is matchable here — Postgres keeps the full alias
    // array and is lossless. See docs/adr/2026-05-29-postgres-migration-plan.md.
    const pattern = `%${likeEscape(filters.actor)}%`;
    const actorConds = ["actor LIKE ? ESCAPE '\\'", "actor_is_alias LIKE ? ESCAPE '\\'"];
    params.push(pattern, pattern);
    const ftsExpr = buildFtsExpression(filters.actor);
    if (ftsExpr !== null) {
      actorConds.push("duty_id IN (SELECT rowid FROM duties_fts WHERE duties_fts MATCH ?)");
      params.push(`{actor}:(${ftsExpr})`);
    }
    conditions.push(`(${actorConds.join(" OR ")})`);
  }
  if (filters.modality) {
    conditions.push("modality = ?");
    params.push(filters.modality);
  }
  if (filters.priority) {
    conditions.push("priority = ?");
    params.push(filters.priority);
  }
  if (filters.inference) {
    conditions.push("inference = ?");
    params.push(filters.inference);
  }

  const sql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { sql, params };
}

/**
 * Public surface shared by the SQLite and Postgres-via-Data-API adapters.
 * Tool code takes this type so either backend can be wired in.
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

export class DutiesDb implements DutiesDbApi {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  async search(filters: SearchFilters, page: number, pageSize: number): Promise<SearchResult> {
    const { sql: whereSql, params } = buildWhere(filters);
    const total = this.countTotal(whereSql, params);
    const offset = (page - 1) * pageSize;
    const stmt = this.db.prepare(`
      SELECT ${SELECT_COLUMNS}
      FROM duties
      ${whereSql}
      ORDER BY enactment_uri, order_key, duty_id
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(...params, pageSize, offset) as unknown as RawRow[];
    return {
      total,
      page,
      pageSize,
      morePages: offset + rows.length < total,
      rows: rows.map(rowToDuty),
    };
  }

  async count(
    filters: SearchFilters,
    groupBy: GroupBy | null,
    options: CountOptions = {},
  ): Promise<CountResult> {
    const { sql: whereSql, params } = buildWhere(filters);
    // Compute total structurally: "total rows matching the filters", derived
    // independently of how groups are presented. Future changes to the
    // grouped query (HAVING, COUNT(col), WHERE col IS NOT NULL) cannot
    // affect this number.
    const total = this.countTotal(whereSql, params);

    if (groupBy === null) {
      return {
        total,
        groupBy: null,
        groupLimit: null,
        groupsReturned: 0,
        groupsTruncated: false,
        groups: [],
      };
    }

    const groupLimit = options.groupLimit ?? 100;
    const col = GROUP_BY_COLUMN[groupBy];
    // For enactment_uri grouping, also surface the title so the URI key is
    // human-readable. enactment_title is functionally dependent on
    // enactment_uri, so MIN() picks the (single) title deterministically and
    // leaves GROUP BY / ORDER BY / truncation unaffected.
    const titleSelect = groupBy === "enactment_uri" ? ", MIN(enactment_title) AS title" : "";
    // Fetch groupLimit + 1 to detect truncation without a separate
    // COUNT(DISTINCT) round-trip.
    const stmt = this.db.prepare(`
      SELECT ${col} AS key, COUNT(*) AS count${titleSelect}
      FROM duties
      ${whereSql}
      GROUP BY ${col}
      ORDER BY count DESC, key
      LIMIT ?
    `);
    const fetched = stmt.all(...params, groupLimit + 1) as unknown as Array<{
      key: string | number | null;
      count: number;
      title?: string;
    }>;
    const groupsTruncated = fetched.length > groupLimit;
    const groups = groupsTruncated ? fetched.slice(0, groupLimit) : fetched;
    return {
      total,
      groupBy,
      groupLimit,
      groupsReturned: groups.length,
      groupsTruncated,
      groups,
    };
  }

  async getForEnactment(
    enactmentUri: string,
    page: number,
    pageSize: number,
    filters: ProvisionFilters = {},
  ): Promise<SearchResult> {
    // Scoping search to a single enactment_uri makes its leading sort key
    // constant, so search's ORDER BY (enactment_uri, order_key, duty_id) is
    // identical to (order_key, duty_id) — legal-provision order. Delegating
    // keeps a single paginated/counted query path rather than a second copy.
    // Optional modality/priority/inference filters layer on through search.
    return this.search({ enactmentUri, ...filters }, page, pageSize);
  }

  /** Smoke-test helper: runs one filter query and one FTS query. */
  async smokeTest(): Promise<{ filterRows: number; ftsRows: number }> {
    const filter = this.db
      .prepare("SELECT COUNT(*) AS n FROM duties WHERE modality = 'duty' LIMIT 1")
      .get() as { n: number };
    const fts = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM duties_fts WHERE duties_fts MATCH 'court' LIMIT 1",
      )
      .get() as { n: number };
    return { filterRows: filter.n, ftsRows: fts.n };
  }

  close(): void {
    this.db.close();
  }

  private countTotal(whereSql: string, params: (string | number)[]): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS n FROM duties ${whereSql}`);
    const row = stmt.get(...params) as { n: number };
    return row.n;
  }
}

/**
 * Opens the duties database if it exists, otherwise returns null.
 * Call once at server startup.
 */
export function openDuties(dbPath: string = DEFAULT_DB_PATH): DutiesDb | null {
  if (!existsSync(dbPath)) {
    console.warn(`[init] Duties database not found at ${dbPath} — duties tools disabled`);
    return null;
  }
  try {
    return new DutiesDb(dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[init] Failed to open duties database at ${dbPath}: ${msg} — duties tools disabled`);
    return null;
  }
}
