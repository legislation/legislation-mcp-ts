# Postgres Migration Plan (Sequencing Ahead of App Runner Sunset)

**Date:** 2026-05-29 (target architecture revised 2026-06-01)
**Status:** Phases 1–5 implemented. Phase 4 (cutover) confirmed in production 2026-06-03; Phase 5 (SQLite removed) code-complete 2026-06-04, committed 2026-06-05 (`887e397`), awaiting deploy; search-operator docs (`OR`/`-negation`) committed 2026-06-05 (`8828c90`), awaiting deploy. Follow-on trigram indexing (roadmap #7) scoped 2026-06-05, not yet implemented. Phase 6 (App Runner → Lambda) not started.
**Supersedes (in part):** [2026-05-26 — Powers-and-duties on SQLite](./2026-05-26-powers-and-duties-sqlite.md)

## Context

The powers-and-duties dataset is currently served from an on-instance SQLite database baked into the MCP container image (see prior ADR).

**Dataset scale (as of 2026-06-01):**

- **1,760,275 rows** across 32 source CSV files (~1.1 GB on disk as CSV).
- **~2.0 GB SQLite** all-in: ~1.3 GB row data + ~200 MB FTS5 index + ~500 MB other indexes.
- Row shape: legislation URI + provenance + actor + modality/priority/inference flags + an `action` text field (the main FTS target, average a sentence or two) + an optional `condition` text field.

This is bigger than earlier drafts of this ADR assumed and is the reason capacity and ingest sizing get explicit attention below.

That on-instance SQLite decision was correct for shipping the first dataset, but two pressures have emerged:

1. **App Runner is being deprecated**, forcing a compute-layer migration in any case. The realistic targets are Fargate (App Runner without App Runner) or Lambda (serverless, thin, scale-to-zero — well-suited to the MCP's bursty chatbot traffic and the fact that the HTTP transport is already in stateless mode using `WebStandardStreamableHTTPServerTransport`).
2. **More datasets are coming.** An email from the Director of Digital Services on 2026-05-29 explicitly named Tables of Origins and Destinations as a near-term candidate for MCP exposure, on the same "CSV-on-research-site → MCP" pattern as powers-and-duties. The MCP is becoming TNA's de facto release channel for research-grade datasets that would otherwise sit on the password-protected research site for years awaiting RDF integration.

Together these push toward moving data off-instance. The architectural target is **Lambda + Aurora Serverless v2 (Postgres) accessed via the Data API**, with each dataset owning its own adapter behind a uniform tool-layer interface. (Earlier drafts of this ADR targeted RDS-in-VPC; the revision is captured below in [Why this target](#why-this-target).)

The question this document addresses is **sequencing**: should we do the data move and the Lambda migration in one cut, or sequence them?

## Decision

Sequence them. **Do the data move first, while still on App Runner.** Then do the App Runner → Lambda migration as a separate, later step.

The compute deadline is on App Runner; the data move is architecturally larger but not on a clock. Doing them sequentially keeps each migration single-variable: if something regresses after the data move, we know it is the data layer; if something regresses after the Lambda move, we know it is the compute layer. The data-move step also gets validated under the known-quantity compute environment we already understand.

## Why this target

The choice between candidate targets came down to a five-axis constraint set:

1. AWS-native (procurement / client-facing reasons).
2. Postgres (real FTS, clean abstraction for future datasets).
3. Cheap (low traffic doesn't justify always-on compute cost).
4. No VPC (operational simplicity — the project has no VPC today).
5. Engine separate from MCP process (the project's stated preference for clean separation of concerns).

No option on AWS satisfies all five. The trade matrix:

| Relax | Result |
|---|---|
| #1 (AWS-native) | Neon — cheap, scale-to-zero, no VPC, HTTPS, real Postgres |
| #2 (Postgres) | DynamoDB — cheap, no VPC, but no FTS |
| #3 (cheap) | **Aurora Serverless v2 + Data API — ~$45/mo always-warm, AWS, no VPC** |
| #4 (no VPC) | RDS + fck-nat — ~$32/mo, VPC overhead, manual NAT instance |
| #5 (separation) | SQLite + S3 — ~$1/mo, no VPC, but engine in-process |

We relaxed #3 (cheap). $45/mo for an always-warm Aurora Serverless v2 cluster at 0.5 ACU is more expensive than the alternatives that relax other constraints, but the constraint we kept — no VPC — buys us out of all the operational complexity that drove the previous draft (VPC, NAT Gateway, App Runner VPC Connector, Secrets Manager rotation, security groups). For TNA-scale spending, $45/mo is a non-issue; the simpler operational shape pays back every time anyone touches the system.

## Phased plan

### Phase 1 — Provision the Aurora Serverless v2 cluster

A single Aurora Serverless v2 (Postgres-compatible) cluster in `eu-west-2`, configured with:

- **Minimum capacity: 0.5 ACU** (kept always-warm — no scale-to-zero, no cold-start penalty in interactive use).
- **Maximum capacity: ~2 ACU** for headroom.
- **Data API enabled** — HTTPS access via `rds-data.eu-west-2.amazonaws.com`, no VPC required.
- **Single-AZ.** The dataset is reproducible from the CSV source, so backup/failover concerns are lighter than for a system of record.
- **~~IAM database authentication.~~ IAM-authorised Data API.** The MCP App Runner instance role gets `rds-data:ExecuteStatement` ~~(and related actions)~~ scoped to this cluster's ARN. ~~No DB password to manage, no Secrets Manager rotation to wire up.~~ **Corrected 2026-09-24:** this is not RDS IAM database authentication. The IAM grant authorises the Data API call; the Data API then logs in to Postgres with a `{username, password}` read from the Secrets Manager secret named on every request. There is a database password — Secrets Manager generates and holds it — and rotating it is a manual step, covered in the infra copy of this ADR.

No VPC, no NAT Gateway, no App Runner VPC Connector. App Runner stays on `egressType: 'DEFAULT'` and reaches the cluster over HTTPS to the AWS API plane, exactly the way it already reaches every other AWS service.

Cost: ~$45/mo at 0.5 ACU sustained.

### Phase 2 — Ingest pipeline as a separate, scheduled thing

The ingest is **not** part of the MCP. This is the most important Lambda-anticipating decision in the whole plan: a separate Fargate task (triggered by EventBridge) reads the CSVs and loads them into the cluster — also via the Data API. Initial bootstrap can be a script run from a developer machine; Data API needs no SSM port-forward or jump host, just IAM credentials with the right role.

Note that Data API doesn't support `COPY` (it is a request/response RPC, not a streaming protocol). For ingest, that means batched `INSERT`s via `BatchExecuteStatement` (up to 1,000 parameter sets per call). For 1.76M rows that's ~1,760 batch calls — wall-clock around 4–6 minutes at ~150 ms per call. The ingest script needs to be resumable so a network blip doesn't restart from row zero (a `bootstrap_progress` table is enough). As built, resumption is **per-file atomic**, not file-plus-row-offset: the script pre-aggregates each CSV in memory (folding multi-alias rows into one `actor_aliases` array), so a file is either marked complete or reprocessed from scratch on restart — `ON CONFLICT DO NOTHING` makes the replay idempotent.

This decoupling survives every subsequent compute migration unchanged. When the MCP becomes a Lambda, the ingest pipeline does not care.

### Phase 3 — Build the Postgres data adapter alongside SQLite

Both adapters live in the codebase during the transition. A new `duties-db-pg.ts` next to `duties-db.ts`, same exported interface, different backing store. Uses `@aws-sdk/client-rds-data` (the Data API client) rather than `pg` — calls go over HTTPS, not a TCP connection, which means no connection pool to size or warm. Concrete work:

- `tsvector` column with GIN index on duty description text.
- Port `buildFtsExpression` from FTS5 syntax to `tsquery` syntax.
- Port `validateDutyFilters` (mostly unchanged — types and bounds are the same).
- Port the queries themselves; ranking uses `ts_rank` (as built — see divergence #4).
- Confirm result sizes stay under Data API's 1 MB response cap. Our queries are already paginated, so this should hold — worth verifying once on real data.

A feature flag (environment variable) chooses which adapter the MCP wires up at module load. This lets us flip back instantly if the Postgres path reveals a surprise.

### Phase 4 — Cut over duties tools to Postgres in production

Flip the flag in deployed config. Watch for regressions. Leave the SQLite adapter compilable but unused. The container image still ships with `duties.db` for the moment.

#### Known behavioural differences between the two backends

> **Resolved at Phase 5 (2026-06-04):** SQLite has been removed, so the differences below are now historical — Postgres is the single behaviour. They are kept here as the record of what changed for anyone comparing against the pre-cutover SQLite results.

The Postgres adapter is not a byte-identical reimplementation of the SQLite one. The following differences existed during the SQLite→Postgres overlap; all were **transient** — they vanished at Phase 5 when SQLite was removed, leaving a single behaviour — and mattered only if the two backends were A/B-compared meanwhile.

1. **Actor-alias matching: both backends, but Postgres is lossless.** Both match the actor term as written (e.g. "NHS body") *or* a resolved alias (e.g. "Local Health Board"). Postgres scans the full `actor_aliases` JSON array, so it matches *any* alias. SQLite matches only the alias that survived its build dedup — `INSERT OR IGNORE` on `duty_id` keeps the first of a multi-alias duty's rows — so for the ~2.3% of duties with several aliases it can miss the dropped ones. (Surfaced by review: the tool description promises alias matching, so the SQLite actor filter was extended from term-only to term-or-surviving-alias; full fidelity still requires Postgres.)
2. **Full-text query operators (Postgres only).** SQLite's `buildFtsExpression` strips FTS5 metacharacters and treats every token as a required literal (implicit AND). Postgres uses `websearch_to_tsquery`, which additionally honours `OR`, `-negation`, and `"quoted phrases"`. `licence OR permit` is three AND-ed literals on SQLite but a real disjunction on Postgres.
3. **Case-insensitivity reached differently.** Both match actors case-insensitively (SQLite `LIKE` is ASCII-case-insensitive by default; Postgres uses `ILIKE`), so they agree for ASCII. They can differ only on non-ASCII case folding (e.g. accented Welsh names) — a negligible edge.
4. **Result ordering: Postgres ranks free-text searches.** When a `query` is supplied, Postgres orders results by `ts_rank` relevance (best match first), with `enactment_uri, order_key, duty_id` retained as a deterministic tiebreaker. SQLite keeps that provision order for *every* search, because its query FTS is a subquery (`duty_id IN (SELECT rowid FROM duties_fts WHERE MATCH …)`) and the `bm25` rank isn't reachable without a subquery→join restructure. Filter-only searches — and the `get_powers_and_duties` path, which carries no query — order identically on both backends. Transient: converges when SQLite is removed; SQLite could adopt `bm25` ranking earlier if the divergence proves to matter.

The `search_powers_and_duties` tool description deliberately did **not** advertise the operator syntax (#2) while SQLite remained a selectable (and default) backend: on SQLite, `OR` and a leading `-` were sanitised into required literal terms, which silently narrowed or inverted results rather than erroring (`licence OR permit` became "must contain licence AND or AND permit"; `report -annual` became "must contain report AND annual"). With SQLite removed, the description now documents the `OR`/`-negation` syntax (2026-06-05) — see the "Still open" note above.

### Phase 5 — Stop baking SQLite into the image ✅ done 2026-06-04 (code; not yet deployed)

Done as a single reversible commit, after Phase 4 was confirmed in production (prod on `pg`, Aurora-only data signatures present, duties tools working end-to-end):

- `src/api/duties-db.ts` renamed (`git mv`) to `src/api/duties-types.ts` and pared down to the shared, backend-agnostic contract: the row/filter/result types, the `DutiesDbApi` interface, and the two boundary helpers (`normalizeEnactmentUri`, `validateDutyFilters`). The SQLite-specific parts — the `DutiesDb` class, `openDuties`, `buildFtsExpression`, `buildWhere`, `SELECT_COLUMNS`/`RawRow`/`rowToDuty`, and all `node:sqlite` usage — were deleted. (Kept as a rename rather than a fresh file so blame survives on the retained helpers.)
- `server.ts` is now pg-only: `openDutiesPg()` is wired in directly and the `DUTIES_DB_BACKEND ?? "sqlite"` switch is gone, removing the silent-fallback footgun. The duties tools still self-disable (unregister) when the cluster ARNs are absent.
- `Dockerfile`: removed the `data/duties.db` precondition check and the production-stage `COPY data/duties.db` (image drops ~2 GB).
- Deleted `scripts/build-duties-db.js` and its `build-duties-db` npm script; deleted the two SQLite-only tests (`duties-db.test.ts`, `duties-fts-expression.test.ts`). The pg `buildWhere`/`buildOrderBy`, URI-normalisation, input-validation, and tool-layer tests remain (429 pass, `npm run check` clean).
- Stale references swept (`.env.example`, `src/index.ts` comment, `ingest-duties-pg.js` comment).

Note: the local `data/duties.db` file is left on disk (it is gitignored, so not part of the commit) as a convenience; it is no longer referenced by any code path.

**Infra follow-up (2026-08-25).** The stack side has caught up with this phase. `DUTIES_DB_BACKEND` was still being set by `McpStack` for a server that had stopped reading it, and `sqlite` was still an accepted value — which passed both cluster ARNs to the runtime while withholding the Data API IAM grant, so the duties tools would have been advertised and then failed `AccessDenied` on every call. The selector is now gone from `bin/app.ts`, `McpStack`, and `.env.example`, and the stack rejects a half-configured cluster at synth. At the same time the runtime stopped receiving the cluster's master credentials: it authenticates as a dedicated read-only role (`mcp_ro`) provisioned by `scripts/apply-readonly-role.js`. Details in the infra copy of this ADR under *Database credentials*.

**Still open (deliberately deferred, not blockers):**
- The `idx_duties_actor_aliases` GIN index (`jsonb_path_ops`) only accelerates `@>` containment queries, but the actor filter runs `jsonb_array_elements` + `ILIKE` (case-insensitive substring, which `@>` cannot do). So the index is unused by any query path. Decide whether to drop it or add an exact-match alias path that uses it. Touching it means a live Aurora DDL change, so it is left for the pg_trgm/indexing follow-up rather than this code-only commit. Harmless to leave: the actor filter is normally combined with btree-indexed filters (modality, type, year) that narrow the row set first.
- ~~The `search_powers_and_duties` description still does not advertise the `OR`/`-negation`/`"phrase"` operator syntax (see divergence #2 below).~~ **Resolved 2026-06-05:** with Postgres the only backend, `websearch_to_tsquery` always honours those operators, so the tool description (prose + the `query` field) now documents `OR` (match either) and `-` (exclude a term) alongside the already-advertised `"quoted phrase"` adjacency. Doc-only change; no behaviour change.

### Phase 6 — App Runner → Lambda (separate migration, on App Runner's deadline)

By this point the code is already cloud-data-aware and the container image is small. The Lambda migration becomes mostly a deployment-shape change:

- Hono Lambda adapter (or AWS Lambda Web Adapter).
- No connection-pooling infrastructure needed. Data API is HTTPS-stateless, so many short-lived Lambda containers cause no contention. (This is why RDS Proxy — which would otherwise be the obvious addition here — is not needed.)
- Function URL or API Gateway HTTP API in front.
- The Lambda execution role gets the same `rds-data:ExecuteStatement` permission the App Runner instance role had.

The MCP code itself probably needs zero substantive changes at this phase.

## Follow-on work — trigram fuzzy actor matching & indexing

> **Naming:** this is the duties-tool hardening roadmap's item **#7** (sometimes called "Phase 2" of that roadmap). It is **not** this ADR's Phase 2 (which is the ingest pipeline). It is post-migration enhancement work, scoped here because it is database-side and builds on the schema above. It is **independent of Phase 6** (Lambda) and can land before or after it. Scoped 2026-06-05; not yet implemented.

### Motivation

The actor filter (`duties-db-pg.ts` `buildWhere`) matches the legislation actor term with `actor ILIKE '%term%'` plus a stemmed `to_tsvector @@ plainto_tsquery` disjunct. The `%term%` substring form **cannot use** the existing btree `idx_duties_actor` (btree only helps anchored/prefix matches), so it is a **sequential scan** over 1.76M rows. Two goals:
- **2a — index the substring match** so `actor ILIKE '%term%'` is index-driven (pure performance, no behaviour change).
- **2b — add true fuzzy matching** (typo tolerance via trigram similarity) as an opt-in feature on top of 2a (behaviour + tool-description change).

### Live facts (probed read-only 2026-06-05)

| Metric | Value |
| --- | --- |
| Rows | 1,760,275 |
| `pg_trgm` extension | **not installed** |
| Table total / heap | 2,449 MB / 1,722 MB |
| `idx_duties_search_tsv` (GIN) | 102 MB |
| `idx_duties_actor` (btree) | 23 MB |
| `idx_duties_actor_aliases` (GIN, dead) | 6.5 MB |
| Postgres version | 16.13 |

### The build constraint and the chosen mechanism

The existing GIN indexes were all built on an **empty** table pre-ingest (Phase 1). A `CREATE INDEX` on the now-populated 1.76M-row table will likely exceed the **RDS Data API's ~45 s statement timeout**. That is the unknown that blocked this work.

**Chosen approach: Data API with `--continue-after-timeout`, then poll for completion.** AWS's documented pattern for long DDL over the Data API — the statement keeps running server-side after the call times out. Needs no new access (no VPC/bastion/`psql`); uses the same tooling as the ingest scripts.

- **Plain `CREATE INDEX`, not `CONCURRENTLY`.** `CONCURRENTLY` cannot run inside a transaction and can leave an *invalid* index on failure; plain `CREATE INDEX` is transactional (clean rollback, no partial index). Its `SHARE` lock blocks **writes** but not **reads** for the build's duration — fine here, because the table is read-mostly and batch-ingested (no live writes) and the MCP tools only read. Run it in a quiet window regardless.
- A non-concurrent index only becomes visible to other sessions when its build transaction commits, so "the index name appears in `pg_class`" *is* the completion signal.

**Fallbacks — note we do _not_ currently have `psql` access** to the cluster (Serverless v2, effectively VPC-only — Data API exists precisely to avoid that networking). So the realistic plan B stays **Data-API-only**: add `idx_duties_actor_trgm` to `duties-schema.sql`, then `TRUNCATE` + re-ingest (`DUTIES_INGEST_RESET=1`, an already-supported flag) so the index is created on the empty table (fast) and filled during load. Heavier — a full re-load of 1.76M rows, slower per-insert with a GIN index present — but proven tooling, no new access. Plan C (direct `psql` + `CREATE INDEX CONCURRENTLY`) would require standing up access we don't have (bastion/SSM tunnel) and isn't worth it unless A and B both fail. Net: `continue-after-timeout` is not just preferred, it's the only in-place option without new infra — and a server-side statement, once detached from the timed-out call, runs to completion subject only to Postgres's own `statement_timeout` (0/unlimited on Aurora by default), so the build should finish regardless of duration.

### DDL — the 2a change set (one maintenance session)

All three use the scripts' env-var ARNs (`$DUTIES_DB_CLUSTER_ARN`, `$DUTIES_DB_SECRET_ARN`, `--profile jd-tna`, `--database duties`):

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;` — fast, prerequisite. (Aurora master user has the privilege.)
2. `CREATE INDEX idx_duties_actor_trgm ON duties USING GIN (actor gin_trgm_ops);` — **fire with `--continue-after-timeout`**, then poll. This is what makes `actor ILIKE '%term%'` index-driven.
3. `DROP INDEX idx_duties_actor_aliases;` — drops the 6.5 MB dead GIN (see "Still open" under Phase 5). Metadata-only, no timeout risk; folded in here.

Poll loop after firing step 2 (expect the call itself to return a timeout while the build continues):

```sql
-- in progress (one row per active build):
SELECT phase, round(100.0 * blocks_done / NULLIF(blocks_total, 0), 1) AS pct
FROM pg_stat_progress_create_index;
-- done when this returns a row with indisvalid = t:
SELECT i.indisvalid
FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.relname = 'idx_duties_actor_trgm';
```

### Verification

`EXPLAIN (ANALYZE, BUFFERS)` on a representative `actor ILIKE '%authority%'` query **before and after** — confirm the plan switches from a seqscan to a `Bitmap Index Scan` on `idx_duties_actor_trgm`, and capture the timing delta. The `count_powers_and_duties` / `search_powers_and_duties` actor-filtered paths are the consumers to re-check.

### Deferred to Phase 3 — alias-name fuzzy indexing

Indexing the **alias names** inside the `actor_aliases` JSONB array is **not** in this change. Trigram can't index unnested array elements, and a generated column can't call `jsonb_array_elements` (not `IMMUTABLE` — same limit noted at the `search_tsv` definition). It needs a real maintained `alias_names_text` column populated by the ingest plus a **full re-ingest** of all 1.76M rows — a bigger, riskier change kept separate. Until then the alias disjunct stays a seqscan, acceptable because it is normally combined with the now-indexed `actor` predicate and the btree filters (modality/type/year) that narrow the row set first.

### Honest note on `ts_rank`

The roadmap folds in "`ts_rank` ordering is unindexed." `ts_rank` is **inherently non-indexable** — the rank depends on the query and is computed per matching row. The `search_tsv` GIN already drives the `@@` predicate (only matched rows are ranked) and the empty/stopword pathological cases are already guarded in `buildOrderBy`. So 2a adds **no** "rank index"; the honest task is to *measure* the common-term worst case (e.g. `report` → ~60k matches all ranked) and decide whether to bound it — likely verify-and-leave.

### Rollback

`DROP INDEX idx_duties_actor_trgm;` (fast). The dropped `idx_duties_actor_aliases` is recreatable from `duties-schema.sql:70` if ever needed. `pg_trgm` can stay installed harmlessly.

## What "Lambda-anticipating" means concretely during Phases 1–5

The code is already mostly Lambda-shaped:

- Streamable HTTP transport in stateless mode (`sessionIdGenerator: undefined`) — each request gets a fresh transport and `Server` instance.
- No per-request session state.
- Module-level `dutiesDb` init, fine on both App Runner and Lambda.

Things to be careful about going forward:

- **No connection pool to size.** Data API is HTTPS-stateless. This is a deliberate benefit of the architecture choice — Lambda's "many short-lived containers" pattern doesn't exhaust a pool. Don't write code that assumes a persistent connection (no `BEGIN; … COMMIT;` patterns spanning multiple round-trips; use Data API transactions explicitly via `BeginTransaction`/`CommitTransaction` if needed).
- **Per-query timeouts.** Data API has its own statement timeout. Set application-level timeouts too for queries that could legitimately run long.
- **Stay under Data API's 1 MB response cap.** Page query results explicitly. Watch out for this in any future analytical queries.
- **No filesystem writes that assume persistence.** Logs to stdout only, no temp files between requests, no caches in `/tmp`.
- **Keep module-load init fast.** Lambda cold-start cost is roughly the time from container boot to first response. Data API is stateless — no DB connection to open at startup, just an SDK client to instantiate, which is sub-millisecond.
- **No background timers or in-process cron.** Anything periodic is external (EventBridge → ingest task), not `setInterval` inside the MCP process.
- **Avoid native deps that don't compile for Lambda's runtime.** `node:sqlite` is being removed anyway; for new dependencies, prefer pure-JS or known-Lambda-compatible packages. `@aws-sdk/client-rds-data` is pure-JS and Lambda-friendly.

## Cost during the overlap

Running App Runner and the Aurora Serverless v2 cluster in parallel from Phase 1 onwards adds roughly:

- **~$45/month** for the cluster at 0.5 ACU sustained (`eu-west-2` pricing). Bump to 1 ACU is ~$90/month if cold-page latency turns out to bite.
- **~$1/month** for Aurora storage (~5–10 GB once loaded, including indexes, at $0.10/GB-month Standard).
- **~$0.05/month** for Data API requests. (Aurora Serverless v2 Data API is **not** free — it's $0.35 per million requests metered at 32 KB per billable unit, with 1M free/month in the first year. At our query volume the cost is rounding error, but it's a real line item and worth knowing.)

More than a `db.t4g.small` RDS instance (~$28/month) would have cost, but in exchange we avoid all VPC infrastructure — no VPC Connector the app needs to reason about, no NAT Gateway, no Secrets Manager rotation code we have to write. For the operational simplicity that buys, ~$17/month is a good trade. Negligible in absolute terms.

## What this plan does not save us from

The full Postgres migration cost — FTS rewrite, ingest pipeline, behavioural validation — has to happen regardless. The sequencing decision does not reduce that work; it only reduces the risk of doing it. The reward is that each migration changes one variable.

## Reconnaissance (2026-06-01)

Reading the existing CDK project at `../infra/` confirmed:

- **There is no VPC anywhere in the CDK project.** No `aws-ec2` imports in `mcp-stack.ts`, `lex-stack.ts`, `bridge-stack.ts`, or any sibling stack. Every workload runs on AWS-managed public surfaces (App Runner default egress, S3/CloudFront, Route53, Cognito, DynamoDB).
- **App Runner has no VPC Connector.** `mcp-stack.ts` uses `networkConfiguration.egressConfiguration.egressType: 'DEFAULT'`.
- **Secrets are plaintext env vars** sourced from `infra/.env` → CDK props → App Runner `runtimeEnvironmentVariables`. No Secrets Manager today.
- **Region is `eu-west-2`** (London).
- **App Runner is not scaling to zero.** Current auto-scaling config is `minSize: 1, maxSize: 2` — a warm instance is always running.

These findings drove two changes from earlier drafts:

1. Originally Phase 1 would have **introduced a VPC** with private subnets, an RDS instance, an App Runner VPC Connector, and (once we realised the MCP makes outbound calls to public APIs like `research.legislation.gov.uk`) a NAT Gateway. Total cost would have risen to ~$60/mo, and the project would have acquired a VPC it has to start reasoning about. We changed the target architecture instead — see [Why this target](#why-this-target) — to **Aurora Serverless v2 + Data API**, which needs no VPC at all.
2. The "Secrets Manager vs IAM" open question ~~collapsed: Aurora Data API authenticates via IAM directly, with no DB password to store or rotate.~~ **Corrected 2026-09-24:** did not collapse — the answer is both. IAM authorises each Data API call, and the Data API authenticates to Postgres with a Secrets Manager secret, so there has been a database password from the start.

## Open questions before Phase 1 (resolved)

Kept as the record of what these resolved to:

- **Schema** — ✅ resolved. Settled in `scripts/duties-schema.sql`: a stored generated `search_tsv` column over action+condition+actor, a GIN index on it, btree indexes on the filter columns, and a `jsonb_path_ops` GIN on `actor_aliases` (the last since found unused — see Phase 5 "Still open" and the trigram follow-on).
- **Result-size sanity check** — ✅ resolved. Queries are paginated (default 25, max 100 results) and have run in production since the 2026-06-03 cutover without hitting the Data API 1 MB cap.
- **Ingest cadence** — ⚠️ partially open. Bootstrap and reloads are run manually via `scripts/ingest-duties-pg.js` from a developer machine (Data API, resumable). The scheduled EventBridge → Fargate automation described in Phase 2 has **not** been built — deferred until the source-CSV refresh frequency justifies it. Not blocking.

## Future datasets

The architectural principle this plan defends is "data lives off-instance, swappable per dataset" — not "Postgres is the only answer". The next dataset (e.g. Tables of Origins/Destinations) gets its own adapter, possibly with a different backing store if its shape warrants it. After two or three concrete cases the actual shape of a generic data-source abstraction will be visible; trying to design it ahead of that is premature.
