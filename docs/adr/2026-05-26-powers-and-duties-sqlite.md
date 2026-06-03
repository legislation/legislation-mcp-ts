## ADR: Powers and Duties Dataset via SQLite

**Date**: 2026-05-26
**Status**: Superseded (in part) by [2026-05-29-postgres-migration-plan.md](./2026-05-29-postgres-migration-plan.md) — see that ADR for the current storage decision (Aurora Serverless v2 + Data API). Sections still authoritative for the project as it stands: §3 schema shape, §5 tool surface, §6 snapshot semantics (`extractedAsOf`), §7 graceful-degradation pattern. Sections superseded: §1 storage choice, §2 engine choice, §4 build process.
**Context**: Exposing the "powers and duties" research dataset as MCP tools

## Context

The National Archives has produced a research dataset extracting **powers** and **duties** from UK legislation. Each row identifies a power or duty granted to or imposed on an actor by a specific provision, with the action expressed in plain English, the conditions under which it applies, and metadata describing how it was extracted.

The dataset is delivered as **32 CSV files (~1.1 GB, 1,841,827 rows)**, partitioned by enactment type (`ukpga`, `uksi`, `eur`, `ssi`, `asp`, `nisi`, `nisr`, `wsi`, etc.). All files share a uniform 19-column schema:

```
dutyTempId, duty_uri, enactment, enactmentTitle, enactmentYear, enactmentType,
enactmentNum, section, subsection, actor, actorIsBody, actorIsAlias,
actorDefinition, body_uri, modality, action, condition, inference, priority
```

Key characteristics:

- **`modality`** splits cleanly into `duty` (1.03M rows) and `power` (809K rows).
- **`priority`** is `primary` (1.45M) or `secondary` (390K); **`inference`** is `explicit` (1.45M) or `implicit` (387K).
- **`actor`** is a free-text label (top values: "Secretary of State", "undertaker", "person", "court"). `actorIsBody` and `actorIsAlias` hold normalised forms where available.
- **`action`** and **`condition`** are free-text English (averaging ~130 characters), and are where the dataset's analytical value lives.
- **`enactment` and `section`** are `legislation.gov.uk` URIs, joinable to existing tools.
- **`duty_uri`** embeds a point-in-time date (e.g. `/2026-01-23/`) corresponding to the legislation version the duty was extracted from — not a single extraction date.

Unlike the legislation content surfaced by other tools, this dataset has **no upstream API**; it exists only as files. Standing up a separate service to expose it would mean operating new infrastructure for a bounded, read-only research extract.

### Requirements

- Expose the dataset as MCP tools that LLMs can use to answer questions like "what duties does the Secretary of State have under primary legislation enacted since 2010?"
- Support filtering by enactment, actor, modality, and free-text matching over the action/condition text.
- Support aggregate queries (counts, group-by) without paging through tens of thousands of rows.
- Don't bloat the repository with ~1 GB of CSVs or a multi-hundred-MB binary database.
- Define a graceful-degradation pattern for optional local datasets, so a server without the database still loads and advertises only the tools it can actually serve.

## Decision

We will **ingest the CSVs into a SQLite database** built locally, and expose **three MCP tools** backed by it.

### 1. Storage: embedded SQLite

A single `data/duties.db` file, built from the CSVs by a one-off script. SQLite is well-suited here: the dataset is read-only, bounded, and dominated by indexed-equality and free-text queries — exactly its sweet spot. An external service buys nothing: there is no live data source to wrap, no write path, no multi-consumer concern.

We considered three alternatives:

- **External REST API** — rejected. Standing up, hosting, and maintaining a service whose only consumer is this MCP server is operational overhead with no offsetting benefit. All other tools wrap external APIs because the data behind them is live and centrally maintained; this dataset is neither.
- **Bundled CSVs read at query time** — rejected. Linear scans of 1.84M rows per query are unworkable, and we'd end up reimplementing indexes and FTS in Node.
- **Postgres / DuckDB** — rejected as overkill for a single-process, read-only embedded use.

### 2. SQLite engine: `node:sqlite` on a supported LTS Node

Use Node.js's built-in `node:sqlite`. It has no native compile step, no extra dependency to install or maintain, and avoids the install-time toolchain pain that `better-sqlite3` imposes on contributors and Docker builds.

**Two facts that shape this decision:**

- **`node:sqlite` on the LTS lines we'd target is Stability 1.1 — Active development.** The current Node release line (v25.7.0+) graduated it to Stability 1.2 — Release candidate ([nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)), but that change has not been backported: both Node 22 LTS and Node 24 LTS still document the module at 1.1. We accept the Active-development risk explicitly — the API may change with minimal or no deprecation cycle until the RC graduation reaches an LTS line. The mitigations below contain the blast radius.
- **Node 23 is end-of-life** (ended 2025-05-14 per [nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases)). Node 22 (Jod) and Node 24 (Krypton) are the current LTS lines. `node:sqlite` is available without flags from v22.13.0 and v23.4.0 onwards.

**Required changes to the repository:**

- **`package.json` `engines.node`**: raise from `>=18.0.0` to `>=22.16.0` (current Node 22 LTS patch at time of writing; pick the latest 22.x at implementation time, or move to `>=24.0.0` if there's appetite for a higher floor).
- **`Dockerfile`**: bump the base image from `node:20-alpine` to `node:22-alpine` (or `node:24-alpine`). **Do not pin to `node:23-*`** — that line is EOL.

**Mitigations against the `node:sqlite` API-stability risk:**

- Confine all `node:sqlite` calls to a single adapter module (`src/api/duties-db.ts`). The three tool handlers depend only on functions exported from that adapter, not on `node:sqlite` directly, so any future API change is a one-file edit.
- The test suite includes a smoke test that opens `data/duties.db`, runs one filter query and one FTS query, and asserts a non-empty result. This catches both adapter regressions and Node-side API drift early. The test is skipped when the .db is absent (consistent with §7).

We considered `better-sqlite3` as the stable alternative. It is a mature, fast, synchronous library with a settled API. We reject it because the native build step adds real friction (toolchain in the Docker image, occasional install failures on Apple Silicon and Windows for contributors) for no functional gain on this workload, and the RC-API risk is well-contained behind the adapter. If `node:sqlite` becomes problematic in practice, swapping the adapter to `better-sqlite3` is a contained change — we are not betting the architecture on it.

### 3. Schema

```sql
CREATE TABLE duties (
  duty_id            INTEGER PRIMARY KEY,    -- dutyTempId
  duty_uri           TEXT NOT NULL,
  enactment_uri      TEXT NOT NULL,
  enactment_title    TEXT NOT NULL,
  enactment_year     INTEGER,
  enactment_type     TEXT NOT NULL,
  enactment_num      TEXT NOT NULL,
  section_uri        TEXT,
  subsection         TEXT,
  actor              TEXT,
  actor_is_body      TEXT,
  actor_is_alias     TEXT,
  actor_definition   TEXT,
  body_uri           TEXT,
  modality           TEXT CHECK (modality IN ('duty','power')),
  action             TEXT NOT NULL,
  condition          TEXT,
  inference          TEXT CHECK (inference IN ('explicit','implicit')),
  priority           TEXT CHECK (priority IN ('primary','secondary')),
  version_date       TEXT,                   -- parsed from duty_uri
  order_key          TEXT                    -- sortable provision key, derived at ingest
);

CREATE INDEX idx_duties_enactment ON duties(enactment_uri, order_key);
CREATE INDEX idx_duties_type_year ON duties(enactment_type, enactment_year);
CREATE INDEX idx_duties_actor     ON duties(actor);
CREATE INDEX idx_duties_modality  ON duties(modality, priority, inference);

CREATE VIRTUAL TABLE duties_fts USING fts5(
  action, condition, actor,
  content='duties', content_rowid='duty_id',
  tokenize='porter unicode61'
);
```

Notes:

- `version_date` is parsed out of `duty_uri` at ingest, not stored as a date column the agent can query against (see "Snapshot date" below).
- `order_key` is a sortable representation of `section_uri` (and `subsection` where present) derived at ingest, so that `get_powers_and_duties` can return provisions in legal order rather than lexical order (`section/2` before `section/10`). The naive case is "extract numeric component, zero-pad to a fixed width". Edge cases (`section/2A`, schedules, paragraphs within schedules) are handled best-effort by tokenising the URI tail and zero-padding each numeric token; rows that don't fit the scheme sort to the end. This is best-effort, not authoritative — the table-of-contents API remains the source of truth for legal ordering.
- The handful of malformed rows observed during exploration (≤10 rows total with values like `Missing`, `duty|power`, blank priority, etc.) are dropped at ingest with a logged count; we don't relax the CHECK constraints to accommodate them.
- Approximately 3% of rows have duplicate `duty_uri` values across part files. We deduplicate at ingest by `duty_uri`, keeping the first occurrence and logging the count.

#### FTS5 population

`duties_fts` is an **external-content** FTS table: inserts into `duties` do not populate it automatically. The build script must populate it explicitly, after the main table is fully loaded, with a single bulk insert:

```sql
INSERT INTO duties_fts(rowid, action, condition, actor)
  SELECT duty_id, action, condition, actor FROM duties;
```

We deliberately do not use INSERT/UPDATE/DELETE triggers (the standard external-content sync pattern), because this is a one-shot, write-once ingest — triggers would slow the bulk load without serving any later writes. If the data model ever becomes write-through, revisit.

### 4. Build process

`scripts/build-duties-db.js`, invoked manually:

```
npm run build-duties-db
# Reads:  ./duties/*.csv  (configurable via DUTIES_CSV_DIR)
# Writes: ./data/duties.db
```

**`.gitignore` additions required by this decision** (none of these are currently ignored, and `duties/` is presently untracked rather than ignored):

```
duties/
data/
*.db
```

The CSV source folder is not in the repository and never should be. Measured on the 2026-03-30 extract (1,841,827 input rows, 1,760,275 retained after dedupe): build time ~40 seconds on a modern laptop, DB size **~2.0 GB** — roughly twice the source CSVs, accounted for by the FTS5 index plus the four secondary indexes. Larger than initially anticipated but still well within SQLite's comfortable range.

For hosted deployment, the .db is built into the Docker image. For local development, contributors who have the CSVs can build their own; everyone else falls under graceful degradation.

### 5. Tools

Three tools, all **conditionally registered** at server start (see §7 for the pattern):

#### `search_powers_and_duties`

Filter + free-text search returning a paginated list of duty rows.

Inputs:

- `query` (optional): natural-text search against `action`, `condition`, and `actor`, backed by an FTS5 index. The tool normalises the input rather than exposing FTS5 syntax directly (see "Natural-text query handling" below).
- `enactment_uri` (optional): exact match — get all duties from a specific Act or SI.
- `enactment_type` (optional): one or more codes (e.g. `ukpga`, `uksi`).
- `year_from` / `year_to` (optional).
- `actor` (optional): substring match against the `actor` column.
- `modality` (optional): `duty` or `power`.
- `priority` (optional): `primary` or `secondary`.
- `inference` (optional): `explicit` or `implicit`.
- `page` (optional, default 1).

Output: a `meta` block (totals, page, morePages) plus a `results` array. Each row includes the `enactment` URI and `section` URI in the form already used by other tools, so the agent can pivot directly to `get_legislation_fragment` or `get_legislation_metadata`.

#### `count_powers_and_duties`

Same filters as `search_powers_and_duties`, but returns aggregate counts instead of rows, with an optional `group_by` over one of: `enactment_type`, `enactment_year`, `actor`, `modality`, `priority`, `inference`, `enactment_uri`.

This mirrors `count_legislation_advanced` and is what makes the dataset analytically valuable: "how many powers does the Secretary of State have, grouped by Act, under primary legislation enacted since 2010?" should be answerable in one call rather than by paging through thousands of rows.

#### `get_powers_and_duties`

Keyed on an `enactment_uri` (or `type`/`year`/`number`). Returns all duties for that Act/SI/Regulation, ordered by `order_key` (see Schema notes — provisions sort in legal order on the common case, best-effort beyond). Pure convenience over `search_powers_and_duties` for the most obvious question — "what does this piece of legislation actually require people to do?"

#### Natural-text query handling

The `query` parameter accepted by `search_powers_and_duties` and `count_powers_and_duties` is **deliberately not raw FTS5 syntax**. The tool tokenises the user's input on whitespace, extracts double-quoted segments as phrase literals, strips FTS5 metacharacters (`"`, `(`, `)`, `*`, `:`) from bare tokens, wraps every surviving token in double quotes, and joins them with implicit AND. If the input cleans to nothing, the FTS clause is dropped entirely rather than passed as `MATCH ''`.

The motivation is robustness against the inputs an LLM (or a user copying from the live site) will actually send: apostrophes in possessives, section references like `s.117`, hyphens, stray parentheses, and stray quotes — all of which previously crashed the tool with a raw `fts5: syntax error`. Treating the input as natural language by default makes the tool reliable on those inputs.

**Trade-off**: the FTS5 operators `OR`, `NOT`, `NEAR/n`, prefix-match `*`, column filters, and parenthesised grouping are **not accessible** in this mode. They are treated as literal words (e.g. `(licence OR permit)` becomes a required-AND search for the words `licence`, `OR`, and `permit`). Users who want disjunction must run two queries; users who want adjacency can use a quoted phrase (`"local authority"`), which is supported.

We accept this trade-off because (a) the dataset's analytical value is in the structured columns (`actor`, `modality`, `enactment_type`, year range, etc.), not in elaborate full-text expressions, and (b) the user population is an LLM-mediated agent that has no reliable way to discover FTS5 syntax. If demand for raw operator access emerges, the right move is to add a separate `fts_query` parameter that bypasses the normaliser — not to expose FTS5 in the default `query` field. (Recorded in Open Questions.)

### 6. Snapshot semantics and the `version_date` field

The dataset is a **per-document snapshot**, not a time series. Empirically (verified across all 1,841,827 rows):

- 29,717 distinct enactments are represented; **every enactment appears at exactly one version date**. No enactment is observed at two or more dates.
- There are 17 distinct dates in total, clustered on a small number of days between 2025-10-07 and 2026-03-27. The pattern matches **batch extraction runs**, each producing duties for a subset of legislation as of that run's date.
- The date appears only in `duty_uri`. The `enactment` URI and `section_uri` are undated.

The most natural reading is that each extraction batch processed legislation **as it stood on the run date** (likely "current version as at that day"), but this is inferred from the data — we do not have explicit documentation from the producer confirming that interpretation. Treat the date as "the version of the document this extraction observed" with the precise selection rule undocumented.

What this means for the tools:

- **The dataset does not show the evolution of powers and duties over time within any one document.** There is no "as at" query axis to expose, because there is no per-document history to query.
- We surface the per-row date as a field — named **`extractedAsOf`** in tool responses (not `version_date`) so its meaning to the agent is "this is when the snapshot was taken, not necessarily the current state". Tool descriptions explicitly note that subsequent amendments to the underlying legislation may not be reflected.
- We do **not** expose the date as a filter. There is nothing useful to query along that dimension.
- A real currency hazard exists: a row extracted on 2025-10-07 reflects the legislation as of that day; if Parliament has amended the section since, the duty text may describe wording that no longer exists. The `section_uri` is undated, so agents calling `get_legislation_fragment` on it will fetch the current version, not the version the duty was extracted from. The tools should make this potential drift visible (the `extractedAsOf` field is the primary signal); we do not attempt to detect drift automatically.

If a refreshed extract arrives, we rebuild the .db.

### 7. Graceful degradation and conditional tool registration

This ADR defines a new pattern that the codebase does not yet implement (the proposed in-force ADR describes the same pattern, but neither it nor any other tool currently registers conditionally — `src/server.ts` registers all tools unconditionally, including the semantic tools that depend on external credentials).

The pattern:

- At startup, `src/api/duties-db.ts` checks for `data/duties.db`. If absent, it exports `null` and logs `"[init] Duties database not found — duties tools disabled"`.
- In `src/server.ts`, the three duties tools are registered only when the database handle is non-null. The `ListTools` response therefore accurately reflects what the agent can call.
- No runtime error path is needed in the tool handlers themselves — they only exist if the database does.
- When the database is present but a specific query fails (corruption, locked file), the tool returns a structured error in its response, not a server-level failure.

Deployment implications:

- **Hosted**: Docker image includes `data/duties.db` built during image construction. All three tools are advertised.
- **Local without CSVs**: Tools simply don't appear. Other tools continue to work.
- **Local with CSVs**: Contributor runs `npm run build-duties-db` once; tools appear from then on.

If, in future, we want to retrofit the same pattern to the semantic tools or other credential-gated tools, this implementation is the reference.

## Consequences

### Positive

- Single-process, single-file deployment of a substantial research dataset.
- Sub-millisecond filter queries; FTS5 over action text is fast and expressive.
- Aggregation tool unlocks analytical questions no other tool in the server can answer.
- Result rows hand directly to existing legislation tools via shared URIs.
- No new infrastructure to operate.

### Negative / Risks

- **Node 22 LTS minimum** (or Node 24): requires bumping `engines.node` and the Docker base image. Any external consumer pinned to Node 18 or 20 would be affected; no such consumer is known.
- **Dependence on a Stability-1.1 (active-development) Node API on the LTS lines**: `node:sqlite` on Node 22/24 LTS may change without a deprecation cycle until the RC graduation (1.2) — already shipped on the current release line — reaches LTS. Mitigated by confining usage to a single adapter and a smoke test (see §2). Revisit when the LTS lines pick up the RC or Stable status, or sooner if a breaking change forces it.
- **~2 GB binary** embedded in the deployment image (roughly 2× the source CSVs, dominated by the FTS5 index). Acceptable, but not trivial — affects image build time, registry transfer, and cold-start disk.
- The CSVs are not in the repo; rebuilding the .db requires obtaining them out-of-band.
- Local OSS users without the .db lose three tools. This is a new behaviour pattern for the server (other tools currently fail at call time when their backing service is unavailable, rather than being absent from the tool list); README needs to document the difference clearly.
- The dataset is a research extract with known imperfections (a handful of malformed rows; duplicate `duty_uri`s across part files; provision-order is best-effort, not authoritative). Tool responses should make the research-extract provenance visible to the agent.

## Open Questions

- [ ] What refresh cadence do we expect for the underlying CSV extract?
- [ ] Should `get_legislation_metadata` optionally include a duty count for the enactment? (Cheap to compute; useful signal when summarising an Act.)
- [ ] Should the FTS index also cover `actor_definition`, or is that too noisy?
- [ ] Do we want a separate small lookup table of canonical actors (derived from `actor_is_alias` → `actor_is_body`) to support faceted UI later?
- [ ] If users start asking for FTS5 operators (`OR`, `NEAR/n`, prefix `*`), add a separate `fts_query` parameter that bypasses the natural-text normaliser, rather than weakening the safety guarantees of `query`.

## References

- **In-Force Status via SQLite** (proposed ADR, dated 2026-02-07, not yet implemented in this codebase) — independently arrives at `node:sqlite`, a build-script-based ingest, and conditional tool registration. This ADR adopts the same approach for the same reasons; neither depends on the other.
- [Advanced Legislation Search via Research API](2026-04-06-advanced-legislation-search.md) — count/search tool pairing precedent.
