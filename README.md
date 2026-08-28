# legislation.gov.uk MCP Server

Model Context Protocol (MCP) server providing AI assistants with access to UK legislation from [legislation.gov.uk](https://www.legislation.gov.uk).

## Features

### Tools

- **search_legislation** - Search by keyword (`q`), title, or metadata filters: `type` (single or multi-value, including aggregates like `primary`/`secondary`), `year`/`startYear`/`endYear`, `subject`, `department`, `extent` (E/W/S/NI), and `language` (english/welsh). Order results with `sort` (relevance, published, title, type, subject, basic). Returns 20 results per page with pagination support (`page` parameter, `meta.morePages` flag).
- **search_legislation_advanced** *(needs the Research API)* - Advanced structured search over legislation XML via the Research API. Supports proximity queries, element-scoped matching (titles, chapters, paragraphs, footnotes), boolean logic, range queries, and counting. Takes a `query` string in the advanced query syntax (see `advanced://query-syntax`).
- **count_legislation_advanced** *(needs the Research API)* - Count documents or document features (paragraphs, schedules, footnotes, etc.) using the advanced query syntax, with optional grouping by department, subject, year, etc.
- **get_legislation** - Retrieve full legislation documents. Default format is plain text; also supports XML (CLML), Akoma Ntoso, and HTML. Plain-text responses include an up-to-date callout listing any unapplied effects.
- **get_legislation_metadata** - Get structured JSON metadata for a document or a specific fragment (e.g. `section/12`, `part/2/chapter/1`). Returns status, extent, key dates, available versions, and unapplied effects. Supports point-in-time versions and Welsh-language metadata for bilingual legislation.
- **get_legislation_fragment** - Retrieve a specific fragment (section, part, etc.) of a legislation document. Default format is plain text.
- **get_legislation_table_of_contents** - Retrieve the table of contents for a piece of legislation. Default format is structured JSON.
- **search_effects** - Search legislative effects (amendments, repeals, insertions) by source (affecting) and/or target (affected) legislation. Filter by `applied` status to find unapplied amendments.
- **search_legislation_semantic** *(needs the semantic search backend)* - Semantic search across legislation using vector index (experimental)
- **search_legislation_sections_semantic** *(needs the semantic search backend)* - Semantic search across individual sections (experimental)
- **get_resource** - Fetch an MCP resource by URI. Intended for API-connected agents that support tool calls but cannot access MCP resources directly; not needed for local MCP clients.

Tools marked *(needs ...)* are **registered only when their backend is
configured** — they are absent from the tool list otherwise, rather than being
advertised and failing when called. An install with none of the optional
backends offers the seven unmarked tools above; setting the relevant environment
variables and restarting brings the others back. The server logs which backends
are active at startup:

```
[init] Semantic search backend: disabled (needs SEMANTIC_API_BASE_URL)
[init] Research API backend: https://research.legislation.gov.uk
[init] Duties backend: disabled (needs DUTIES_DB_CLUSTER_ARN + DUTIES_DB_SECRET_ARN)
```

#### Powers and Duties

These three tools are **registered only when the duties Postgres backend is configured** (see [Powers and Duties Database](#powers-and-duties-database-optional) below).

- **search_powers_and_duties** - Search The National Archives' powers-and-duties research dataset. Each row identifies a power or duty granted to or imposed on an actor by a specific provision of UK legislation, with the action expressed in plain English. Free-text `query` supports implicit AND, `"quoted phrases"`, `OR` between terms, and `-` negation; combine with filters for `enactment_type`, year range, `actor`, `modality` (duty/power), `priority` (primary/secondary), and `inference` (explicit/implicit).
- **count_powers_and_duties** - Count rows in the dataset, optionally grouped by one dimension (`enactment_type`, `enactment_year`, `actor`, `modality`, `priority`, `inference`, or `enactment_uri`). Grouped results are top-N by count, with a `groupsTruncated` flag.
- **get_powers_and_duties** - Return all powers and duties for a single Act, SI, or Regulation, in best-effort provision order. Paginated, with an optional duty-vs-power `modalityBreakdown`.

The dataset is a research extract: each row carries the date it was captured (`extractedAsOf`) and reflects the legislation as it stood then, not necessarily current law.

### Resources

The server provides documentation resources grouped by namespace:

- `guide://` - Getting started and troubleshooting (`getting-started`, `troubleshooting`)
- `types://` - Legislation type codes (`guide`, `data`)
- `atom://feed-guide` - Search result (Atom feed) parsing guide
- `clml://` - CLML XML reference (`schema-guide`, `metadata/extent`)
- `advanced://query-syntax` - Query syntax for `search_legislation_advanced` / `count_legislation_advanced`
- `text://format-guide` - Plain-text output format reference
- `json://` - Response shape references for the JSON-returning tools (`search-response`, `advanced-search-response`, `metadata-response`, `table-of-contents-response`, `semantic-search-response`, `semantic-section-response`)
- `cookbook://` - Task-oriented recipes: `index` (list of all recipes), `check-extent`, `check-outstanding-effects`, `point-in-time-version`, `search-effects`, `find-recent-si-by-subject`, `semantic-search-workflow`
- `years://regnal` - Regnal-year identifiers for pre-1963 Acts

## Installation

```bash
npm install
npm run build
```

**Note:** The build process generates a resource manifest from files in `src/resources/`. This manifest is required at runtime and is created automatically during the build.

## Configuration

### Environment Variables

The server can be configured using environment variables:

#### Research API (Optional)

`search_legislation_advanced` and `count_legislation_advanced` are registered only when **both** `RESEARCH_API_USERNAME` and `RESEARCH_API_PASSWORD` are set; without them the tools are not offered to the client (every request would be a 401). The standard legislation.gov.uk tools work independently of Research API configuration.

- **`RESEARCH_API_BASE_URL`** - Base URL for the Research API
  - Default: `https://research.legislation.gov.uk`
- **`RESEARCH_API_USERNAME`** - Basic-auth username
- **`RESEARCH_API_PASSWORD`** - Basic-auth password

#### Semantic Search (Optional)

- **`SEMANTIC_API_BASE_URL`** - Base URL for the semantic search API
  - Default: `http://localhost:8000`
  - Example: `https://semantic-api.example.com`

- **`SEMANTIC_API_KEY`** - API key for semantic search authentication
  - Default: None
  - Example: `sk-xxx...`

`search_legislation_semantic` and `search_legislation_sections_semantic` are registered only when `SEMANTIC_API_BASE_URL` is set; without it the tools are not offered to the client. Set it explicitly even when the backend is at the default address — the default applies to the client, not to whether the tools are registered. The standard legislation.gov.uk tools work independently of semantic search configuration.

> **Upgrading:** `SEMANTIC_API_BASE_URL` used to be optional — the client fell back to `http://localhost:8000`, so a server with the variable unset still offered the semantic tools and reached a Lex instance running at that address. It now gates registration, so an install that relied on the implicit default loses the semantic tools with no error beyond one `[init]` line on stderr. If that describes yours, set `SEMANTIC_API_BASE_URL=http://localhost:8000` explicitly and restart.

#### Powers and Duties Database (Optional)

The powers-and-duties tools are backed by an Aurora Serverless v2 Postgres cluster reached over the RDS Data API. Like the Research API and semantic tools, they are registered only when their backend is configured. If `DUTIES_DB_CLUSTER_ARN` or `DUTIES_DB_SECRET_ARN` is missing, the server logs `[init] Duties backend: disabled (needs DUTIES_DB_CLUSTER_ARN + DUTIES_DB_SECRET_ARN)` at startup and `search_powers_and_duties`, `count_powers_and_duties`, and `get_powers_and_duties` are absent from the tool list. All other tools are unaffected.

- **`DUTIES_DB_CLUSTER_ARN`** - ARN of the Aurora cluster (required)
- **`DUTIES_DB_SECRET_ARN`** - ARN of the Secrets Manager secret holding the database credentials (required)
- **`DUTIES_DB_NAME`** - Database name
  - Default: `duties`
- **`AWS_REGION`** - AWS region for the Data API client
  - Default: `eu-west-2`

Standard AWS credentials must also be available to the process (via the usual credential chain — environment variables, shared config, or an instance/task role).

#### Transport Mode

- **`MCP_TRANSPORT`** - Communication transport (stdio or http)
  - Default: `stdio`
  - Options: `stdio`, `http`

When using HTTP transport:
- **`PORT`** - HTTP server port
  - Default: `3000`
- **`MCP_SERVER_KEY`** - Optional bearer token. If set, clients must send `Authorization: Bearer <key>` on the `/mcp` endpoint. If unset, authentication is disabled.

### Example Configurations

**Local Development (stdio):**
```bash
npm start
```

**Local Development with Semantic Search:**
```bash
SEMANTIC_API_BASE_URL=http://localhost:8000 npm start
```

**HTTP Transport (for remote access):**
```bash
MCP_TRANSPORT=http PORT=3000 npm start
```

**Docker:**
```bash
docker build -t legislation-mcp .
docker run -e MCP_TRANSPORT=http -p 3000:3000 legislation-mcp
```

To use semantic search with Docker, pass the semantic API configuration:
```bash
docker run \
  -e MCP_TRANSPORT=http \
  -e SEMANTIC_API_BASE_URL=http://host.docker.internal:8000 \
  -p 3000:3000 \
  legislation-mcp
```

## Usage

### With MCP Inspector

```bash
npm run inspector
```

### As a Standalone Server

```bash
npm start
```

### In Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "legislation-gov-uk": {
      "command": "node",
      "args": ["/path/to/legislation-gov-uk/build/index.js"]
    }
  }
}
```

## Development

```bash
# Watch mode (auto-rebuild on changes)
npm run watch

# Build only
npm run build

# Generate resource manifest
npm run generate-manifest

# Run tests
npm test

# Type-check (run before committing)
npm run check
```

### Test harness

`mcp-harness.mjs` at the repo root drives a running server over HTTP the way a real MCP client does — useful for exercising a tool end-to-end without the Inspector UI. Start the server with `MCP_TRANSPORT=http npm start`, then:

```bash
# List the tools the server currently advertises
node mcp-harness.mjs --list

# Call a tool with JSON arguments
node mcp-harness.mjs search_powers_and_duties '{"query":"local authority","modality":"duty"}'
```

Set `MCP_URL` to point at a different endpoint (default `http://localhost:3000/mcp`).

## Architecture

### Resources

The server uses a convention-based resource system:

- Resources are organized hierarchically in `src/resources/`
- Top-level directories become URI namespaces (e.g., `clml://`, `guide://`)
- Build process generates a manifest mapping URIs to files
- Resources are loaded on-demand at runtime

### Data backends

Most tools proxy the public legislation.gov.uk APIs (`src/api/legislation-client.ts`), with the advanced-search tools going to the Research API and the semantic tools to the Lex vector service.

The powers-and-duties tools are different: they read a research dataset held in an **Aurora Serverless v2 Postgres** cluster, queried over the **RDS Data API** (`src/api/duties-db-pg.ts`). The Data API is HTTPS-stateless, so there is no connection pool to manage and no shutdown step. The tool layer depends only on the `DutiesDbApi` interface in `src/api/duties-types.ts`.

`openDutiesPg()` returns `null` when the cluster environment variables are absent, which disables the duties tools rather than failing startup — so local development without AWS wiring works normally. This was previously a SQLite file; that backend was removed once Postgres was confirmed in production (see `docs/adr/2026-05-29-postgres-migration-plan.md`).

## License

Licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

Contains public sector information licensed under the Open Government Licence v3.0.

## Author

[The National Archives](https://www.nationalarchives.gov.uk/)
