# Metadata Response Format

JSON format for `get_legislation_metadata` tool responses.

This tool returns structured metadata for a specific piece of legislation, parsed from the underlying XML into clean JSON.

## LegislationMetadata

### Core Identification

- **id** (string) - Simplified document identifier
  - Format: `{type}/{year}/{number}`
  - Example: `"ukpga/2020/2"`
  - Note: Strips `http(s)://www.legislation.gov.uk/` and `/id/` prefixes for cleaner JSON

- **type** (string) - Legislation type code
  - Example: `"ukpga"`
  - Use this with `get_legislation` tool
  - See `types://guide` for complete list of type codes

- **year** (number) - Year of enactment or making
  - Example: `2020`
  - Extracted from `<ukm:Year>` element (calendar year, not regnal year)

- **number** (number) - Legislation number
  - Example: `2`
  - Extracted from `<ukm:Number>` element

- **title** (string) - Human-readable title
  - Example: `"Direct Payments to Farmers (Legislative Continuity) Act 2020"`

### Version Status

- **status** (string, optional) - Document version status
  - Values: `"draft"`, `"final"`, `"revised"`, `"proposed"`
  - `"final"` = original published version before editorial processing
  - `"revised"` = version processed by editorial system

### Geographical Extent

- **extent** (array of strings, optional) - Jurisdictions where legislation applies
  - Values: `"E"` (England), `"W"` (Wales), `"S"` (Scotland), `"NI"` (Northern Ireland)
  - Example: `["E", "W"]` (England and Wales only)
  - Example: `["E", "W", "S", "NI"]` (United Kingdom-wide)
  - Note: Normalized from `N.I.` to `NI` for consistency
  - See `clml://metadata/extent` for detailed extent information

### Important Dates

All date fields use **ISO 8601 date format** (YYYY-MM-DD).

- **enactmentDate** (string, optional) - When the Act received Royal Assent (primary legislation only)
  - Format: ISO 8601 date (YYYY-MM-DD)
  - Example: `"2020-01-22"`

- **madeDate** (string, optional) - When the instrument was made (secondary legislation only)
  - Format: ISO 8601 date (YYYY-MM-DD)
  - Example: `"2020-12-15"`

### Version and Language

- **version** (string, optional) - Label identifying the returned representation
  - Values: a first-version keyword (`"enacted"`, `"made"`, `"created"`, `"adopted"`), an ISO date (`"2024-01-01"`), or `"prospective"` for prospective revised content
  - Populated on every response the parser can derive it for, not only when the request specified a version
  - Derivation:
    - revised prospective content → `"prospective"`
    - no `dct:valid` → type-specific first-version keyword
    - otherwise → the latest first-version keyword or ISO-date label in `versions` that is not after `dct:valid`, falling back to `dct:valid` itself if no eligible label exists

- **pointInTime** (string, optional) - Requested point-in-time date
  - Format: ISO 8601 date (YYYY-MM-DD)
  - Populated only when the request URL contained a dated version segment AND the response is not final
  - Absent for `enacted`/`made`/`created`/`adopted` URL segments (use `version` to identify those) and for final-status responses
  - May differ from `version` on fragment responses: `pointInTime` is what the caller asked for, `version` is the fragment milestone actually selected

- **language** (string, optional) - Language of the response
  - Values: `"english"`, `"welsh"`
  - Present when a specific language was requested

### Prospective Status

- **prospective** (boolean, optional) - Whether the content is prospective (not yet in force)
  - `true` when the document or fragment has `Status="Prospective"`
  - For fragment requests, reflects the fragment's status, not the document's
  - Absent when the content is in force

### Available Versions

- **versions** (array of strings, optional) - Available milestone version labels
  - Usually usable as the `version` parameter in subsequent requests
  - Exception: `"prospective"` is not resolvable as a `version` parameter for `get_legislation` or `get_legislation_fragment`
  - When `"prospective"` is present, it is the last and most recent version in the list
  - Fetch that version by omitting the `version` parameter altogether (use the versionless URL)
  - Sorted: first-version keyword (`enacted`/`made`/`created`/`adopted`), then dates chronologically, then `"prospective"`
  - Example: `["enacted", "2020-01-30", "2022-06-01", "2024-01-01"]`
  - Example (final/original plus current prospective): `["enacted", "prospective"]`
  - For fragment requests, scoped to the fragment — lists only versions where that provision changed
  - Populated on both unversioned and versioned requests

### Up-to-Date Status

- **upToDate** (boolean, optional) - Whether the legislation text is current
  - `true` = all in-force effects have been applied; the text is up to date
  - `false` = some effects are outstanding (enacted and in force but not yet applied)
  - Only present when no `version` parameter was specified (i.e. the latest version)

### Unapplied Effects

- **unappliedEffects** (array, optional) - Amendments enacted but not yet applied to the text
  - Each effect has:
    - **type** (string) - e.g. `"substituted"`, `"words repealed"`, `"inserted"`
    - **applied** (boolean) - Whether this effect has been applied
    - **required** (boolean) - Whether application is required
    - **outstanding** (boolean) - Whether the effect should have been applied but wasn't (required, not applied, and in force on or before today)
    - **notes** (string, optional) - Editorial notes
    - **target** (object) - The affected legislation:
      - `id`, `type`, `year`, `number`, `title` - Identification fields
      - `provisions` (string, optional) - Plain-text citation, e.g. `"s. 12(7)(a)"`
      - `refs` (array, optional) - Structured provision refs (element IDs) for matching against fragments. Each is either `{ type: "section", ref }` or `{ type: "range", start, end }`
      - `extent` (array, optional) - Geographical extent, e.g. `["E","W","S"]`
    - **source** (object) - The affecting legislation (same shape as target)
    - **commencement** (string, optional) - Commencement authority provisions
    - **inForce** (array) - In-force dates, each with:
      - **date** (string, optional) - ISO date when the effect comes into force
      - **description** (string, optional) - e.g. `"wholly in force"`
  - An effect is **outstanding** if it is not applied, is required, and has at least one in-force date on or before today

### Additional Metadata

- **isbn** (string, optional) - ISBN for published version
  - Example: `"9780105700203"`
  - Status: TODO - Not yet extracted

## Complete Example (Primary Legislation - Revised Version)

```json
{
  "id": "ukpga/2020/2",
  "type": "ukpga",
  "year": 2020,
  "number": 2,
  "title": "Direct Payments to Farmers (Legislative Continuity) Act 2020",
  "status": "revised",
  "extent": ["E", "W", "S", "NI"],
  "enactmentDate": "2020-01-30",
  "version": "2024-01-01",
  "versions": ["enacted", "2020-01-30", "2022-06-01", "2024-01-01"],
  "upToDate": true
}
```

## Complete Example (Secondary Legislation)

```json
{
  "id": "nisr/2026/1",
  "type": "nisr",
  "year": 2026,
  "number": 1,
  "title": "The Shellfish Gathering (Conservation) Regulations (Northern Ireland) 2026",
  "status": "revised",
  "extent": ["NI"],
  "madeDate": "2026-01-06"
}
```

## Date Field Comparison

**Metadata vs Search:**
- Search results use a single **date** field (simplified for lists)
- Metadata uses separate **enactmentDate** and **madeDate** fields (precise legal terminology)

This reflects different use cases:
- Search: Scanning and sorting documents
- Metadata: Detailed information requiring legal precision

## Using with Other Tools

```javascript
// Search for legislation
search_legislation(title="Fire Safety")

// Get detailed metadata for a result
get_legislation_metadata(type="ukpga", year="2021", number="24")

// Get full document
get_legislation(type="ukpga", year="2021", number="24")

// Get metadata for a specific version (as it stood on a date)
get_legislation_metadata(type="ukpga", year="2021", number="24", version="2023-01-01")

// Get original enacted version
get_legislation_metadata(type="ukpga", year="2021", number="24", version="enacted")

// Get metadata for a specific fragment (Part, Chapter, section, etc.)
get_legislation_metadata(type="ukpga", year="2010", number="15", fragment="part/2/chapter/1")
```

## Fragment-Level Metadata

When a `fragment` parameter is provided (e.g. `"section/12"`, `"part/2/chapter/1"`), the metadata is scoped to that provision:

- `unappliedEffects` and `upToDate` are scoped to the fragment for both revised and enacted/made legislation

All other fields (`id`, `title`, `status`, etc.) describe the parent document.

Use `get_legislation_table_of_contents` to discover valid fragment identifiers.

## Related Resources

- `json://search-response` - Search results format
- `clml://metadata/extent` - Understanding geographical extent
- `clml://schema-guide` - Full CLML XML structure
- `types://guide` - Legislation types reference
- `cookbook://check-extent` - Example workflow using metadata
- `cookbook://point-in-time-version` - Retrieving historical versions
