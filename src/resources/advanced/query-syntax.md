# Advanced Query Syntax

Complete reference for the query language used by `search_legislation_advanced` and `count_legislation_advanced`. Pass queries as the `query` parameter.

## Keyword Searches

Enter a word or phrase to search all documents. Separate terms with commas to require all of them (comma = low-precedence AND).

```
licence, appeal, Secretary of State
```

### Wildcards

- `*` matches zero or more non-space characters
- `?` matches exactly one non-space character

```
commit*          → commits, committed, committee, ...
regulat?on       → regulation
```

### Boolean Operators

| Operator | Abbreviation | Precedence |
|----------|-------------|------------|
| AND | `&&` | Higher than OR |
| OR | `\|\|` | Lower than AND |
| NOT | `!` | Prefix |
| `,` (comma) | — | Lowest (acts as AND) |

Precedence: NOT > AND > OR > comma. Use parentheses to override.

```
apple AND NOT banana           → apple && !banana
a OR b AND c OR d              → a OR (b AND c) OR d
(a OR b) AND (c OR d)          → explicit grouping
a OR b, c OR d                 → (a OR b) AND (c OR d)   [comma is low-precedence AND]
```

## Proximity Searches

Search for terms appearing near each other. A number before brackets/parentheses sets the word distance.

- **Square brackets** `[]` — match regardless of order
- **Parentheses** `()` — match only in the given order

```
20[licence,appeal]             → "licence" and "appeal" within 20 words (any order)
20(licence,appeal)             → "licence" precedes "appeal" by at most 20 words
```

## Element Searches

Search within a specific document element. Element name followed by terms in brackets or parentheses.

```
title(finance)                 → documents whose title contains "finance"
subject[police,England]        → subject contains both "police" and "England"
chapter(appeal, Secretary of State)  → chapters containing those terms
```

Structural elements (part, chapter, para, etc.) may appear multiple times in a document. Queries targeting them return individual matching elements with direct links.

### Supported Elements

**Metadata elements** (one per document):
`title`, `longtitle`, `intro`, `headnote`, `subject`, `subsubject`, `made`, `laid`, `CIF`, `signature`, `signee`, `job`, `department`, `explanatory`

**Structural elements** (may appear multiple times):
`part`, `chapter`, `xheading`, `para`, `subpara`, `schedule`, `footnote`, `annotation`

Element searches combine with boolean operators:

```
title(pension) AND subject[police,England]
```

### Element Fields

Some elements support field restrictions:

**`prospective`** — for `part()`, `chapter()`, `xheading()`, `para()`, `schedule()`. Values: `true`, `false`.
```
para(prospective=true, Secretary of State)
```

**`confers-power`** and **`blanket-amendment`** — for `para()` only. Boolean values.
```
para(confers-power=true)
```

**`type`** — for `annotation()`. Values: `F`, `C`, `E`, `I`, `P`, `M`, `X`.
```
annotation(type=F, repealed)   → F Notes (textual amendments) containing "repealed"
annotation(type=C)             → C Notes (non-textual modifications)
```

**`extent`** — for `part()`, `chapter()`, `para()`, `schedule()`. See Extent Restrictions below.
```
para(extent=E)                 → paragraphs extending to England only
```

## Nested Element Searches

Elements can be nested to find structural relationships:

```
part[para[licence,may] AND para[commit*,offence]]
```
→ parts containing one paragraph with "licence" and "may", and another with "commit*" and "offence"

### Nesting Hierarchy

| Parent | Allowed Children |
|--------|-----------------|
| `part` | `number`, `heading`, `chapter`, `xheading`, `para`, `subpara`, `eu-title`, `eu-section` |
| `chapter` | `number`, `heading`, `xheading`, `para`, `subpara`, `eu-section` |
| `xheading` | `heading`, `para`, `subpara` |
| `para` | `number`, `heading`, `subpara` |
| `subpara` | `number` |
| `schedule` | `number`, `heading`, `part`, `chapter`, `xheading`, `para`, `subpara` |
| `eu-title` | `number`, `heading`, `chapter`, `eu-section`, `para` |
| `eu-section` | `number`, `heading`, `eu-subsection`, `para` |
| `eu-subsection` | `number`, `heading`, `para` |

Proximity searches nest inside element searches:

```
title(5[apple,pear])           → title has "apple" and "pear" within 5 words
```

## Type Restrictions

Restrict by document type with `type=`:

```
title(pension) && type=ukpga   → UK Public General Acts only
type=primary                   → all primary legislation
```

### Type Codes

**Primary legislation**: `ukpga`, `ukla`, `asp`, `asc`, `anaw`, `mwa`, `ukcm`, `nia`, `aosp`, `aep`, `aip`, `apgb`

**Secondary legislation**: `uksi`, `wsi`, `ssi`, `nisi`, `nisr`, `ukci`, `ukmo`, `uksro`, `mnia`, `apni`

**EU legislation**: `eur`, `eudn`, `eudr`, `eut`

**Draft legislation**: `ukdsi`, `sdsi`, `nidsr`

**Meta-types**:
- `primary` — all primary legislation
- `secondary` — all secondary legislation
- `uk` — all UK legislation (primary + secondary)
- `eu` — all EU legislation
- `draft` — all drafts
- `all` — everything except drafts (default)

Drafts are excluded by default. To search everything: `type=all OR type=draft`.

## Document Versions and Languages

**`version=`** targets a specific version:
- `version=original` — as enacted / as made
- `version=current` — current version (default)
- `version=2014-01-01` — as it stood on that date

**`language=`** targets a language:
- `language=welsh` or `language=cymraeg` — Welsh versions
- Default is English
- Welsh searches target original versions by default (only original versions available in Welsh)

## Query Execution Options

The underlying Research API also supports execution options outside the query string itself. These are not currently exposed as MCP input parameters, but may appear in tool response metadata.

**`amendments`** controls how inserted amendment text is treated:
- `include` — search all text
- `exclude` — ignore inserted text
- `within` — search only inserted text

## Range Queries

Restrict by numeric or date fields using operators: `=`, `>`, `<`, `>=`, `<=`, `!=`.

```
title(pension) AND year=2000
year>=2010 AND year<=2020
enacted>=2020-01-01
total-paragraphs > 20          → requires count() instruction
```

### Range Fields

| Field | Type | Notes |
|-------|------|-------|
| `year` | integer | Document year |
| `number` | integer | Document number |
| `enacted` | date (YYYY-MM-DD) | Enactment date |
| `made` | date | Made date (SIs) |
| `laid` | date | Laid before Parliament date |
| `CIF` | date | Coming into force date |
| `sifted` | date | Sifted date |
| `modified` | date | Last modified date |
| `ISBN` | string | ISBN |
| Any counter name | integer | See Counting section (requires `count()`) |

### Ordering

Use `orderby=` to sort results. Prefix with `-` for descending. Combine with `&`.

```
type=ukpga && orderby=year                → ascending by year
type=ukpga && orderby=-year&number        → descending year, then ascending number
type=uksi && count(schedules) && orderby=-schedules  → most schedules first
```

Note: when `orderby=` targets a counter field (e.g., `orderby=-schedules`), the API returns a minimal "top-N by metric" document shape. The MCP wrapper re-derives `id`, `type`, `number`, and `link` from each document's URI, and `year` for calendar-year legislation. The date fields (`made`, `cif`, `valid`, `modified`), `ISBN`, and `year` for regnal-year legislation will be absent. Order by `year`, `number`, or another non-counter field if you need the full document metadata.

## Extent Restrictions

Restrict by geographical extent:

```
extent=E                       → England
extent=E+W                     → England and Wales
extent=E+W+S                   → England, Wales and Scotland
extent=E+*                     → any extent that includes England
```

Values: `E`, `W`, `S`, `NI`. Combine with `+`. Wildcards: `E+*`, `E+W+*`.

## Counting

Use `count()` to count features across matching documents.

- With `count_legislation_advanced`, `count(...)` returns aggregate totals across the matching set.
- With `search_legislation_advanced`, `count(...)` keeps the normal search results and adds per-document count values in each result's `counts` object.
- Without `count()`, `count_legislation_advanced` counts matching documents.

Note: when `count(...)` is combined with a structural element search (e.g., `chapter(...)`, `part(...)`), the API drops the per-document `matches` and `snippets` arrays. Run the structural query without `count(...)` if you need the matching elements themselves.

```
type=uksi && year=2015 && count(total-paragraphs)
type=uksi && year=2015 && count(schedules,total-footnotes)
```

### Counters

**Document structure**:
`documents`, `body-paragraphs`, `schedule-paragraphs`, `schedules`, `total-parts`, `total-chapters`, `total-xheadings`, `total-paragraphs`, `total-subparas`

**Content features**:
`total-tables`, `total-tablerows`, `total-tablecolumns`, `total-tablecells`, `total-formulas`, `total-images`

**Amendments**:
`total-blockamendments`, `total-inlineamendments`, `total-amendments`

**Notes and annotations**:
`total-footnotes`, `total-annotations`, `total-f-notes`, `total-c-notes`, `total-e-notes`, `total-i-notes`, `total-p-notes`, `total-m-notes`, `total-x-notes`

**References**:
`total-citations`, `total-definitions`

**Matching elements** (when query targets structural elements):
`matching-elements`, `matching-parts`, `matching-chapters`, `matching-xheadings`, `matching-paragraphs`, `matching-subparas`

**Related documents**:
`total-ENparas`, `total-relatedEN`, `total-relatedEM`, `total-relatedPN`, `total-relatedIA`

**Date intervals** (days between):
`days-made-laid`, `days-made-cif`, `days-laid-cif`

**Status**:
`prospective-paragraphs`, `unapplied-effects`, `unapplied-textual-amendments`

**Versions**:
`total-pit` (total point-in-time versions), `matching-pit` (versions matching query)

**Word counts**:
`total-words`, `matching-words`, `total-unique-words`, `matching-unique-words`

### Using Counters as Range Filters

Any counter name can be used as a range field:

```
type=uksi && count(schedules) && schedules>=5
```

### Using Counters in Ordering

```
type=uksi && count(schedules) && orderby=-schedules
```

## Grouping

Group count data by a field using `groupby=`. Use with `count_legislation_advanced`.

```
type=uksi && year>2005 && year<=2015 && groupby=department
type=uksi && year>2005 && year<=2015 && groupby=department&year
```

### Groupby Fields

`subject`, `subsubject`, `department`, `signee`, `extent`, `year`, `eurovoc`, `eu-subject`, `eu-dir-code`

Grouped counts can be ordered:

```
type=uksi && year=2015 && groupby=department && orderby=-documents
```

## Combining Everything

The query syntax supports arbitrary combinations. Examples:

| Natural language | Query |
|-----------------|-------|
| UK Acts with "pension" in the title | `title(pension) && type=ukpga` |
| SIs from 2015 with 5+ schedules | `type=uksi && year=2015 && count(schedules) && schedules>=5` |
| Chapters mentioning "appeal" near "Secretary of State" | `chapter(10[appeal,secretary of state]) && type=ukpga` |
| Parts with paragraphs about licences and offences | `part[para[licence,may] AND para[commit*,offence]]` |
| F Notes containing "repealed" in Acts from 2020 | `annotation(type=F, repealed) && type=ukpga && year=2020` |
| Prospective paragraphs in Scottish Acts | `para(prospective=true) && type=asp` |
| SIs by department, ordered by count | `type=uksi && year=2015 && groupby=department && orderby=-documents` |
| Documents enacted in January 2024 | `enacted>=2024-01-01 && enacted<2024-02-01` |
| Welsh language documents | `language=welsh` |
| Acts as they stood on 1 Jan 2020 | `type=ukpga && version=2020-01-01` |
| Longest SIs by paragraph count | `type=uksi && year=2024 && count(total-paragraphs) && orderby=-total-paragraphs` |
| Schedules containing "transitional" | `schedule(transitional)` |
| Paragraphs that confer power in England | `para(confers-power=true, extent=E)` |
