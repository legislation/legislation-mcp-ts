# Getting Started with UK Legislation

This MCP server provides tools and resources for working with UK legislation from legislation.gov.uk. Use `get_resource` to fetch any resource by URI — see its tool description for the full list.

## Choosing the Right Tool

### Search Tools

| Use Case | Tool | Why |
|----------|------|-----|
| Find by title or keyword | `search_legislation` | Real-time, authoritative, exact matching |
| Search by concept or meaning | `search_legislation_semantic` | Better at understanding intent |
| Find specific sections by concept | `search_legislation_sections_semantic` | Returns individual sections ranked by relevance |
| Search within specific elements (titles, chapters, paragraphs, footnotes, etc.) | `search_legislation_advanced` | Powerful query syntax targeting document structure |
| Count documents or features (paragraphs, schedules, etc.) with grouping | `count_legislation_advanced` | Aggregate statistics and grouped counts |

**Standard search** is live from legislation.gov.uk. **Semantic search** may lag days/weeks behind live data — verify important results with `search_legislation`.

### Retrieval Tools

| Use Case | Tool |
|----------|------|
| Read or summarise legislation | `get_legislation` — returns plain text by default |
| Browse structure of a large document | `get_legislation_table_of_contents`, then `get_legislation_fragment` for specific sections |
| Get title, dates, extent only | `get_legislation_metadata` — fast, lightweight JSON |
| Track amendments or cross-references | `get_legislation` with `format="xml"` — full CLML with semantic markup |
| Compare versions over time | Any retrieval tool with `version` param — date or `enacted`/`made` |

## Important Things to Know

- **Plain text is the default** for `get_legislation` and `get_legislation_fragment`. It's best for reading and summarisation. Use `format="xml"` when you need amendment annotations, cross-references, or in-force status.
- **Pre-1963 legislation uses regnal years** (e.g. `Vict/63`) as canonical identifiers. Calendar years usually work via API redirect, but use regnal years to disambiguate. See `years://regnal`.
- **Legislation types** span multiple jurisdictions — Acts (`ukpga`, `asp`, `asc`, `nia`), Statutory Instruments (`uksi`, `ssi`, `wsi`), retained EU law (`eur`, `eudr`), and more. See `types://guide`.
- For common errors and edge cases, see `guide://troubleshooting`.
- For background on UK legislative structures, see https://www.legislation.gov.uk/understanding-legislation.
