# legislation.gov.uk MCP Server

Model Context Protocol (MCP) server providing AI assistants with access to UK legislation from [legislation.gov.uk](https://www.legislation.gov.uk).

## Features

### Tools

- **search_legislation** - Search by keyword (`q`), title, or metadata filters: `type` (single or multi-value, including aggregates like `primary`/`secondary`), `year`/`startYear`/`endYear`, `subject`, `department`, `extent` (E/W/S/NI), and `language` (english/welsh). Order results with `sort` (relevance, published, title, type, subject, basic). Returns 20 results per page with pagination support (`page` parameter, `meta.morePages` flag).
- **search_legislation_advanced** - Advanced structured search over legislation XML via the Research API. Supports proximity queries, element-scoped matching (titles, chapters, paragraphs, footnotes), boolean logic, range queries, and counting. Takes a `query` string in the advanced query syntax (see `advanced://query-syntax`).
- **count_legislation_advanced** - Count documents or document features (paragraphs, schedules, footnotes, etc.) using the advanced query syntax, with optional grouping by department, subject, year, etc.
- **get_legislation** - Retrieve full legislation documents. Default format is plain text; also supports XML (CLML), Akoma Ntoso, and HTML. Plain-text responses include an up-to-date callout listing any unapplied effects.
- **get_legislation_metadata** - Get structured JSON metadata for a document or a specific fragment (e.g. `section/12`, `part/2/chapter/1`). Returns status, extent, key dates, available versions, and unapplied effects. Supports point-in-time versions and Welsh-language metadata for bilingual legislation.
- **get_legislation_fragment** - Retrieve a specific fragment (section, part, etc.) of a legislation document. Default format is plain text.
- **get_legislation_table_of_contents** - Retrieve the table of contents for a piece of legislation. Default format is structured JSON.
- **search_effects** - Search legislative effects (amendments, repeals, insertions) by source (affecting) and/or target (affected) legislation. Filter by `applied` status to find unapplied amendments.
- **search_legislation_semantic** - Semantic search across legislation using vector index (experimental)
- **search_legislation_sections_semantic** - Semantic search across individual sections (experimental)
- **get_resource** - Fetch an MCP resource by URI. Intended for API-connected agents that support tool calls but cannot access MCP resources directly; not needed for local MCP clients.

### Resources

The server provides documentation resources grouped by namespace:

- `guide://` - Getting started and troubleshooting (`getting-started`, `troubleshooting`)
- `types://` - Legislation type codes (`guide`, `data`)
- `atom://feed-guide` - Search result (Atom feed) parsing guide
- `clml://` - CLML XML reference (`schema-guide`, `metadata/extent`)
- `advanced://query-syntax` - Query syntax for `search_legislation_advanced` / `count_legislation_advanced`
- `text://format-guide` - Plain-text output format reference
- `json://` - Response shape references for the JSON-returning tools (`search-response`, `advanced-search-response`, `metadata-response`, `table-of-contents-response`, `semantic-search-response`, `semantic-section-response`)
- `cookbook://` - Task-oriented recipes: `check-extent`, `check-outstanding-effects`, `point-in-time-version`, `search-effects`, `find-recent-si-by-subject`, `semantic-search-workflow`
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

If Research API credentials are not configured, the `search_legislation_advanced` and `count_legislation_advanced` tools will fail with authentication errors. The standard legislation.gov.uk tools work independently of Research API configuration.

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

If semantic search is not configured, the semantic tools will fail with connection errors. The standard legislation.gov.uk tools work independently of semantic search configuration.

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
```

## Architecture

The server uses a convention-based resource system:

- Resources are organized hierarchically in `src/resources/`
- Top-level directories become URI namespaces (e.g., `clml://`, `guide://`)
- Build process generates a manifest mapping URIs to files
- Resources are loaded on-demand at runtime

## License

Licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

Contains public sector information licensed under the Open Government Licence v3.0.

## Author

[The National Archives](https://www.nationalarchives.gov.uk/)
