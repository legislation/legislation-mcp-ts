# Advanced Search Response Formats

JSON formats for `search_legislation_advanced` and `count_legislation_advanced` tool responses.

## search_legislation_advanced

### Envelope

```json
{
  "meta": {
    "query": "title(pension) && type=ukpga",
    "case": false,
    "stem": false,
    "punctuation": false,
    "amendments": "include",
    "page": 1,
    "resultsPerPage": 10,
    "morePages": false
  },
  "documents": [...]
}
```

#### Meta Fields

- **query** (string) — The query as interpreted by the server
- **case** (boolean) — Whether matching was case-sensitive
- **stem** (boolean) — Whether stemming was enabled
- **punctuation** (boolean) — Whether punctuation-sensitive matching was enabled
- **amendments** (string) — Amendment-text matching mode: `include` (search all text), `exclude` (ignore inserted text), or `within` (search only inserted text)
- **page** (number) — Current page number
- **resultsPerPage** (number) — Number of results per page
- **morePages** (boolean) — Whether more pages of results exist

### Document Fields

#### Core Identification

- **id** (string) — Simplified identifier, format: `{type}/{year}/{number}` (e.g., `"ukpga/2022/33"`)
- **type** (string) — Short legislation type code (e.g., `"ukpga"`)
- **year** (number) — Document year
- **number** (number) — Document number
- **title** (string) — Document title
- **link** (string) — Full URL on legislation.gov.uk

#### Dates (present only when applicable)

- **enacted** (string) — Enactment date (primary legislation), YYYY-MM-DD
- **made** (string) — Made date (secondary legislation)
- **laid** (string) — Laid before Parliament date
- **cif** (string) — Coming into force date
- **valid** (string) — Valid-to date
- **modified** (string) — Last modified date

#### Optional Fields

- **ISBN** (string) — ISBN when available
- **snippets** (string[]) — Matching text excerpts (plain text, no markup)
- **matches** (array) — Structural element matches (when query targets elements like chapters, parts, etc.)
- **counts** (object) — Per-document count values (when query includes `count()`)

#### Reduced Shape When Ordering by a Counter

When the query includes `orderby=<counter>` (e.g., `orderby=-schedules`), the upstream API returns a minimal "top-N by metric" shape: only `title`, `counts`, and the document id. The MCP wrapper re-derives `id`, `type`, `number`, and `link` from the document URI, and `year` for calendar-year legislation. Date fields, `ISBN`, and `year` for regnal-year legislation will be absent.

### Matches

When a query targets structural elements, each document includes a `matches` array:

```json
{
  "matches": [
    {
      "name": "Chapter",
      "number": "Chapter 3",
      "heading": "The Private Rented Sector Database",
      "link": "http://www.legislation.gov.uk/ukpga/2025/26/part/2/chapter/3"
    }
  ]
}
```

### Per-Document Counts

When the query includes `count()`, each document includes a `counts` object. This does not change `search_legislation_advanced` into an aggregate response; it still returns normal document hits, augmented with per-document count values.

```json
{
  "counts": {
    "schedules": 6
  }
}
```

### Complete Example

```json
{
  "meta": {
    "query": "type=uksi && year=2015 && count(schedules) && schedules>=5",
    "case": false,
    "stem": false,
    "punctuation": false,
    "amendments": "include",
    "page": 1,
    "resultsPerPage": 10,
    "morePages": true
  },
  "documents": [
    {
      "id": "uksi/2015/17",
      "type": "uksi",
      "year": 2015,
      "number": 17,
      "title": "The Company, Limited Liability Partnership and Business (Names and Trading Disclosures) Regulations 2015",
      "link": "http://www.legislation.gov.uk/uksi/2015/17",
      "made": "2015-01-07",
      "cif": "2015-01-31",
      "valid": "2024-03-04",
      "modified": "2024-04-11",
      "counts": {
        "schedules": 6
      }
    }
  ]
}
```

### With vs Without `count()`

Without `count()`, search results contain normal document fields only:

```json
{
  "meta": {
    "query": "type=uksi && year=2015",
    "page": 1,
    "resultsPerPage": 10,
    "morePages": true
  },
  "documents": [
    {
      "id": "uksi/2015/17",
      "title": "The Company, Limited Liability Partnership and Business (Names and Trading Disclosures) Regulations 2015"
    }
  ]
}
```

With `count(schedules)`, the same search results include per-document counter values:

```json
{
  "meta": {
    "query": "type=uksi && year=2015 && count(schedules)",
    "page": 1,
    "resultsPerPage": 10,
    "morePages": true
  },
  "documents": [
    {
      "id": "uksi/2015/17",
      "title": "The Company, Limited Liability Partnership and Business (Names and Trading Disclosures) Regulations 2015",
      "counts": {
        "schedules": 6
      }
    }
  ]
}
```

## count_legislation_advanced

### Simple Count

```json
{
  "meta": {
    "query": "type=uksi && year=2015",
    "case": false,
    "stem": false,
    "amendments": "include"
  },
  "counts": {
    "documents": 1742
  }
}
```

### Grouped Count

When the query includes `groupby=`, counts are keyed by group value:

```json
{
  "meta": {
    "query": "type=uksi && year>2005 && year<=2015 && groupby=department && orderby=-documents",
    "case": false,
    "stem": false,
    "amendments": "include"
  },
  "counts": {
    "Department for Transport": {
      "documents": 899
    },
    "Ministry of Justice": {
      "documents": 887
    },
    "Department of Health": {
      "documents": 801
    }
  }
}
```

## Related Resources

- `advanced://query-syntax` — Full query syntax reference
- `types://guide` — Legislation type codes
- `json://search-response` — Standard search response format (for comparison)
