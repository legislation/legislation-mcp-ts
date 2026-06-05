/**
 * Adapter for the powers-and-duties Aurora Postgres database via Data API.
 *
 * Implements the shared DutiesDbApi contract (duties-types.ts); the tool layer
 * depends only on that interface. This is the sole duties backend — server.ts
 * wires it in via openDutiesPg().
 *
 * Data API is HTTPS-stateless — no connection to open, no pool to manage,
 * no close() to call. The Aurora cluster is provisioned by the CDK DataStack
 * and reached via cluster ARN + secret ARN + database name from env vars.
 */

import {
  RDSDataClient,
  ExecuteStatementCommand,
  type Field,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import type {
  ActorAlias,
  CountOptions,
  CountResult,
  DutiesDbApi,
  DutyRow,
  GroupBy,
  Inference,
  Modality,
  Priority,
  ProvisionFilters,
  SearchFilters,
  SearchResult,
} from "./duties-types.js";

const SELECT_COLUMNS = `
  duty_id, duty_uri, enactment_uri, enactment_title, enactment_year,
  enactment_type, enactment_num, section_uri, subsection, actor,
  actor_definition, actor_aliases, modality,
  action, condition, inference, priority, version_date
`;

const GROUP_BY_COLUMN: Record<GroupBy, string> = {
  enactment_type: "enactment_type",
  enactment_year: "enactment_year",
  actor: "actor",
  modality: "modality",
  priority: "priority",
  inference: "inference",
  enactment_uri: "enactment_uri",
};

interface PgConfig {
  clusterArn: string;
  secretArn: string;
  databaseName: string;
  region: string;
}

export class DutiesDbPg implements DutiesDbApi {
  private client: RDSDataClient;
  private clusterArn: string;
  private secretArn: string;
  private databaseName: string;

  constructor(cfg: PgConfig) {
    this.client = new RDSDataClient({ region: cfg.region });
    this.clusterArn = cfg.clusterArn;
    this.secretArn = cfg.secretArn;
    this.databaseName = cfg.databaseName;
  }

  async search(filters: SearchFilters, page: number, pageSize: number): Promise<SearchResult> {
    const { whereSql, params } = buildWhere(filters);
    const total = await this.countTotal(whereSql, params);
    const offset = (page - 1) * pageSize;

    const queryParams = [
      ...params,
      pNum("p_limit", pageSize),
      pNum("p_offset", offset),
    ];
    const r = await this.exec(`
      SELECT ${SELECT_COLUMNS}
      FROM duties
      ${whereSql}
      ORDER BY ${buildOrderBy(filters)}
      LIMIT :p_limit OFFSET :p_offset
    `, queryParams);

    const rows = (r.records ?? []).map(recordToRow);
    return {
      total,
      page,
      pageSize,
      morePages: offset + rows.length < total,
      rows,
    };
  }

  async count(
    filters: SearchFilters,
    groupBy: GroupBy | null,
    options: CountOptions = {},
  ): Promise<CountResult> {
    const { whereSql, params } = buildWhere(filters);
    const total = await this.countTotal(whereSql, params);

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
    // enactment_uri, so min() picks the (single) title deterministically and
    // leaves GROUP BY / ORDER BY / truncation unaffected.
    const selectsTitle = groupBy === "enactment_uri";
    const titleSelect = selectsTitle ? ", min(enactment_title) AS title" : "";
    // Fetch groupLimit + 1 to detect truncation without a separate
    // COUNT(DISTINCT) round-trip.
    const queryParams = [...params, pNum("p_group_limit_plus_one", groupLimit + 1)];
    const r = await this.exec(`
      SELECT ${col} AS key, COUNT(*) AS count${titleSelect}
      FROM duties
      ${whereSql}
      GROUP BY ${col}
      ORDER BY count DESC, key
      LIMIT :p_group_limit_plus_one
    `, queryParams);

    const fetched = (r.records ?? []).map(rec => {
      const g: { key: string | number | null; count: number; title?: string } = {
        key: keyField(rec[0], groupBy),
        count: numField(rec[1])!,
      };
      if (selectsTitle) g.title = strField(rec[2]) ?? undefined;
      return g;
    });
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
    // Delegate to the paginated search path (a single enactment_uri makes
    // search's leading sort key constant, so its order is identical to
    // ORDER BY order_key, duty_id). This bounds the Data API response — an
    // unpaginated fetch blows the 1 MB cap on large enactments (e.g.
    // nisr/1980/346 has 6,213 duties ≈ 6 MB) — and shares one query path.
    // Optional modality/priority/inference filters layer on through search.
    return this.search({ enactmentUri, ...filters }, page, pageSize);
  }

  async smokeTest(): Promise<{ filterRows: number; ftsRows: number }> {
    const filter = await this.exec(
      "SELECT COUNT(*) FROM duties WHERE modality = 'duty'",
    );
    const fts = await this.exec(
      "SELECT COUNT(*) FROM duties WHERE search_tsv @@ websearch_to_tsquery('english', 'court')",
    );
    return {
      filterRows: numField(filter.records![0][0])!,
      ftsRows: numField(fts.records![0][0])!,
    };
  }

  /** No-op. Data API is stateless — there's nothing to close. */
  close(): void {
    // intentionally empty
  }

  private async countTotal(whereSql: string, params: SqlParameter[]): Promise<number> {
    const r = await this.exec(`SELECT COUNT(*) FROM duties ${whereSql}`, params);
    return numField(r.records![0][0])!;
  }

  private async exec(sql: string, parameters: SqlParameter[] = []) {
    return await this.client.send(new ExecuteStatementCommand({
      resourceArn: this.clusterArn,
      secretArn: this.secretArn,
      database: this.databaseName,
      sql,
      parameters,
      includeResultMetadata: false,
    }));
  }
}

/**
 * Open the Postgres adapter using env-var-supplied cluster wiring.
 * Returns null if required env vars are missing — caller (server.ts) treats
 * that the same as the SQLite path missing data/duties.db: log and disable
 * the duties tools.
 */
export function openDutiesPg(): DutiesDbPg | null {
  const clusterArn = process.env.DUTIES_DB_CLUSTER_ARN;
  const secretArn = process.env.DUTIES_DB_SECRET_ARN;
  const databaseName = process.env.DUTIES_DB_NAME ?? "duties";
  const region = process.env.AWS_REGION ?? "eu-west-2";

  if (!clusterArn || !secretArn) {
    console.warn(
      "[init] DUTIES_DB_CLUSTER_ARN / DUTIES_DB_SECRET_ARN not set — Postgres duties backend disabled",
    );
    return null;
  }
  return new DutiesDbPg({ clusterArn, secretArn, databaseName, region });
}

// --- WHERE builder ---

export function buildWhere(filters: SearchFilters): { whereSql: string; params: SqlParameter[] } {
  const conditions: string[] = [];
  const params: SqlParameter[] = [];

  if (filters.query && filters.query.trim().length > 0) {
    // websearch_to_tsquery handles "quoted phrases", -negation, OR, and is
    // safe against syntax errors by design. This replaces the SQLite-side
    // buildFtsExpression sanitiser.
    //
    // A query of only punctuation or stop-words reduces to an EMPTY tsquery,
    // and `search_tsv @@` an empty tsquery matches nothing — a false
    // zero-result. The first disjunct (`numnode(...) = 0`, i.e. the query tree
    // has no nodes) makes the FTS clause no-op in that case, matching the
    // SQLite path which drops the FTS clause when the cleaned query is empty.
    // websearch_to_tsquery over a constant param is evaluated once, so
    // referencing it twice is not a per-row cost.
    conditions.push(
      "(numnode(websearch_to_tsquery('english', :p_query)) = 0" +
        " OR search_tsv @@ websearch_to_tsquery('english', :p_query))",
    );
    params.push(pStr("p_query", filters.query.trim()));
  }
  if (filters.enactmentUri) {
    conditions.push("enactment_uri = :p_enactment_uri");
    params.push(pStr("p_enactment_uri", filters.enactmentUri));
  }
  if (filters.enactmentType && filters.enactmentType.length > 0) {
    const placeholders = filters.enactmentType.map((_, i) => `:p_et_${i}`).join(",");
    conditions.push(`enactment_type IN (${placeholders})`);
    filters.enactmentType.forEach((t, i) => {
      params.push(pStr(`p_et_${i}`, t));
    });
  }
  if (filters.yearFrom !== undefined) {
    conditions.push("enactment_year >= :p_year_from");
    params.push(pNum("p_year_from", filters.yearFrom));
  }
  if (filters.yearTo !== undefined) {
    conditions.push("enactment_year <= :p_year_to");
    params.push(pNum("p_year_to", filters.yearTo));
  }
  if (filters.actor) {
    // Two complementary matches on the actor term and any resolved alias name
    // (from the actor_aliases JSON array, e.g. "Local Health Board"):
    //
    //   1. Substring ILIKE (:p_actor) — catches partial tokens ("authorit")
    //      and longer-term containment ("Secretary of State" matches
    //      "Secretary of State for Health").
    //   2. Stemmed FTS (:p_actor_raw) — to_tsvector @@ plainto_tsquery makes
    //      the match inflection-aware, so "local authorities" also finds
    //      "local authority" (both stem alike). plainto_tsquery is safe
    //      against arbitrary input; an all-stopword/punctuation operand
    //      reduces to an empty tsquery that matches nothing, leaving the
    //      ILIKE disjunct to carry the result. This closes the recall cliff
    //      pure substring leaves between singular/plural phrasings.
    //
    // No explicit `ESCAPE '\'`: Postgres's default LIKE/ILIKE escape character
    // is already backslash, which is exactly what likeEscape() produces, so
    // behaviour is unchanged. An explicit ESCAPE '\' breaks the Data API's
    // named-parameter pre-parser — the backslash-before-quote confuses its
    // string-literal tracking and it mis-parses the following :p_actor.
    //
    // Index notes: this is a seqscan (no functional/trigram index yet — that's
    // the planned pg_trgm follow-up), and both the ILIKE and the per-row
    // to_tsvector run unindexed. In practice the actor filter is usually
    // combined with btree-backed filters (modality, enactment_type, year),
    // which reduce the working set first.
    conditions.push(`(
      actor ILIKE :p_actor
      OR to_tsvector('english', coalesce(actor, '')) @@ plainto_tsquery('english', :p_actor_raw)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(actor_aliases) AS a
        WHERE a->>'name' ILIKE :p_actor
           OR to_tsvector('english', a->>'name') @@ plainto_tsquery('english', :p_actor_raw)
      )
    )`);
    params.push(pStr("p_actor", `%${likeEscape(filters.actor)}%`));
    params.push(pStr("p_actor_raw", filters.actor));
  }
  if (filters.modality) {
    conditions.push("modality = :p_modality");
    params.push(pStr("p_modality", filters.modality));
  }
  if (filters.priority) {
    conditions.push("priority = :p_priority");
    params.push(pStr("p_priority", filters.priority));
  }
  if (filters.inference) {
    conditions.push("inference = :p_inference");
    params.push(pStr("p_inference", filters.inference));
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { whereSql, params };
}

/**
 * ORDER BY for search(). A free-text query ranks results by relevance
 * (best match first); everything else — including the get_powers_and_duties
 * path, which has no query — keeps provision order (enactment_uri, order_key,
 * duty_id). Without this, every search fell back to enactment order, so the
 * first page of a free-text search was whichever enactment sorted first by
 * URI rather than the closest matches.
 *
 * The ranking branch reuses :p_query, which buildWhere binds for any non-blank
 * query (a looser condition than this guard), so no extra parameter is needed.
 * The provision-order tail is kept as a deterministic tiebreaker for equal
 * ranks and for stable pagination.
 *
 * Note: this is a deliberate Postgres-only behaviour. The SQLite adapter keeps
 * provision order for all searches (its query FTS is a subquery, so bm25 rank
 * isn't reachable without a join restructure). See
 * docs/adr/2026-05-29-postgres-migration-plan.md.
 */
export function buildOrderBy(filters: SearchFilters): string {
  // Rank only when the query carries a letter or digit. A punctuation-only
  // query (e.g. "***") reduces to an empty tsquery: buildWhere already makes it
  // a WHERE no-op (numnode(...) = 0), but ts_rank over an empty tsquery is a
  // computed (non-indexable) sort key, which forces a full sort of every
  // matched row — measured ~14.5s over the whole table — instead of an
  // index-ordered read. Keeping content-less queries on the provision-order
  // path avoids that cliff. (Pure stop-word queries still slip through — only
  // Postgres can tell they reduce to empty — but they're rarer; the general
  // unindexed-ts_rank cost is a separate follow-up.) This guard is strictly
  // narrower than buildWhere's :p_query binding (trim().length > 0), so
  // whenever it ranks, :p_query is bound.
  const ranked = !!filters.query && /[\p{L}\p{N}]/u.test(filters.query);
  return ranked
    ? "ts_rank(search_tsv, websearch_to_tsquery('english', :p_query)) DESC, enactment_uri, order_key, duty_id"
    : "enactment_uri, order_key, duty_id";
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

// --- Field/parameter helpers ---

function pStr(name: string, value: string): SqlParameter {
  return { name, value: { stringValue: value } };
}

function pNum(name: string, value: number): SqlParameter {
  return { name, value: { longValue: value } };
}

function strField(f: Field): string | null {
  if (f.isNull) return null;
  return f.stringValue ?? null;
}

function numField(f: Field): number | null {
  if (f.isNull) return null;
  if (typeof f.longValue === "number") return f.longValue;
  if (typeof f.doubleValue === "number") return f.doubleValue;
  return null;
}

function keyField(f: Field, groupBy: GroupBy): string | number | null {
  if (f.isNull) return null;
  return groupBy === "enactment_year" ? numField(f) : strField(f);
}

function recordToRow(rec: Field[]): DutyRow {
  // Column order matches SELECT_COLUMNS.
  return {
    dutyId: numField(rec[0])!,
    dutyUri: strField(rec[1])!,
    enactmentUri: strField(rec[2])!,
    enactmentTitle: strField(rec[3])!,
    enactmentYear: numField(rec[4]),
    enactmentType: strField(rec[5])!,
    enactmentNum: strField(rec[6])!,
    sectionUri: strField(rec[7]),
    subsection: strField(rec[8]),
    actor: strField(rec[9]),
    actorDefinition: strField(rec[10]),
    actorAliases: parseAliases(strField(rec[11])),
    modality: strField(rec[12])! as Modality,
    action: strField(rec[13])!,
    condition: strField(rec[14]),
    inference: strField(rec[15])! as Inference,
    priority: strField(rec[16])! as Priority,
    extractedAsOf: strField(rec[17]),
  };
}

/**
 * Data API returns JSONB columns as a string. Parse and normalise to the
 * ActorAlias shape; treat malformed JSON or unexpected shapes as empty.
 */
function parseAliases(raw: string | null): ActorAlias[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ActorAlias[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object") continue;
    const it = item as { name?: unknown; body_uri?: unknown };
    if (typeof it.name !== "string") continue;
    out.push({
      name: it.name,
      bodyUri: typeof it.body_uri === "string" ? it.body_uri : null,
    });
  }
  return out;
}
