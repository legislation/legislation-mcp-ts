# Advanced Query Syntax

Complete reference for the query language used by `search_legislation_advanced` and `count_legislation_advanced`. Pass queries as the `query` parameter.

## Keyword Searches

Enter bare terms — a **single word** or an **exact phrase** (just type the words with spaces between them; do **not** wrap phrases in quotes). Separate terms with commas to require all of them (comma = low-precedence AND).

```
licence, appeal, Secretary of State
```

→ documents containing the word `licence`, the word `appeal`, and the exact phrase `Secretary of State`.

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

## Escaping Special Characters

These characters are part of the query syntax and must be prefixed with `\` to use them literally inside a search term:

`,`  `(`  `)`  `[`  `]`  `!`  `<`  `>`  `=`

```
title(Secretary, State)        → titles containing "Secretary" AND "State"
title(Secretary\, State)       → titles containing the literal phrase "Secretary, State"
title(a\<b)                    → titles containing the literal string "a<b"
schedule(Schedule 2\(a\))      → schedules mentioning the literal "Schedule 2(a)"
```

Other punctuation (`.`  `;`  `:`  `?`  `-`  `'`  `"`  `/` …) is not query syntax and needs no escaping — the tokenizer passes it through unchanged.

**Note.** Escaping a character only keeps it out of the query grammar. Whether the search engine actually *matches* punctuation in indexed text is a separate question, controlled by the `punctuation` parameter (see Matching Modes below). With the default `punctuation=false`, the comma in `Secretary\, State` suppresses the AND split but does not itself have to appear in the matched text.

## Proximity Searches

Search for terms appearing near each other. A number before brackets/parentheses sets the word distance.

- **Square brackets** `[]` — match regardless of order
- **Parentheses** `()` — match only in the given order

```
20[licence,appeal]             → "licence" and "appeal" within 20 words (any order)
20(licence,appeal)             → "licence" precedes "appeal" by at most 20 words
```

## Element Searches

Search within a specific document element. Element name followed by terms in brackets or parentheses. The same keyword rules apply inside: each comma-separated term is a single word or an exact phrase (spaces form the phrase — no quotes).

```
title(finance)                 → documents whose title contains "finance"
subject[police,England]        → subject contains both "police" and "England"
chapter(appeal, Secretary of State)  → chapters containing the word "appeal" AND the phrase "Secretary of State"
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
- `all` — everything except drafts (default)

Drafts are excluded by default.

## Document Versions and Languages

**`version=`** targets a specific version:
- `version=original` — as enacted / as made
- `version=current` — current version (default)
- `version=2014-01-01` — as it stood on that date

**`language=`** targets a language:
- `language=welsh` or `language=cymraeg` — Welsh versions
- Default is English
- Welsh searches target original versions by default (only original versions available in Welsh)

## Matching Modes

Three boolean flags control how terms in the query are matched against indexed text. They are passed as separate tool parameters (not inside the query string):

| Parameter | Default | Effect when `true` |
|---|---|---|
| `case` | `false` | Case-sensitive matching: `Pension` no longer matches `pension`. |
| `stem` | `true` | Stemmed matching: `commit` also matches `commits`, `committed`, etc. Set to `false` for exact word-form matches. |
| `punctuation` | `false` | Punctuation-sensitive matching: punctuation adjacent to a term (e.g. the `.` in `Act.`) must be present in the matched text. Pair this with backslash-escaped punctuation in the query when you want a specific punctuation character required. |

All three echo back in the response `meta` (except `punctuation`, which only appears in the search response, not the count response).

## Query Execution Options

The underlying Research API also supports an `amendments` option, not currently exposed as an MCP input parameter, though its value appears in tool response metadata.

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

## When Queries Fail

The Research API has two failure modes, only one of which is signalled as an error.

### Non-JSON responses (most often parse errors)

When the API can't parse a query, it returns HTTP 200 with an HTML page instead of the expected JSON envelope. The tool detects that content-type swap and surfaces it as `Likely query syntax error: …`. The qualifier matters: although in practice the overwhelming majority of non-JSON responses are parse errors, other API-level issues (a maintenance page, an upstream proxy rendering HTML) could produce the same shape. If the query looks well-formed and you still see the error, the API itself may be returning an error page.

Typical parse-error triggers:

- Unbalanced or mismatched brackets: `title(pension`, `part[para[licence`
- Unknown element name used as an element: `foo(pension)`
- Using a range field as an element: `year(pension)` — `year` is a numeric field, not a container; write `year=2020` instead.
- Unknown type code: `type=zzz`
- Unknown counter name: `count(not-a-real-counter)`
- Unknown `orderby=` field
- Non-numeric value on a numeric field: `year=banana`
- Empty value on a range field: `year=`
- Negative or non-numeric proximity distance: `-5[apple,pear]`
- Invalid `version=` (must be `original`, `current`, or `YYYY-MM-DD`)
- Invalid `language=` (must be `welsh`/`cymraeg` or omitted)
- Typos in reserved words: `orderbi=`, `groubpy=`

### Silent-accept pitfalls

These parse successfully and return results, but probably not the results you intended. The API can't flag them — watch out for them yourself.

- **Empty or whitespace-only query** returns the entire corpus (hundreds of thousands of documents).
- **A bare range-field name with no operator** is treated as a keyword search for that word. `year` searches for the literal word "year" in document text (~31k hits), not "any document with a year field".
- **Unknown `groupby=` field** is silently ignored and an ungrouped search is run. (`orderby=` with an unknown field errors, but `groupby=` does not — the asymmetry is real.)
- **Invalid `extent=` value** (e.g. `extent=ZZ`) returns zero results rather than erroring. Valid values are `E`, `W`, `S`, `NI`, combined with `+`.
- **Nested elements that violate the hierarchy** (e.g. `title[schedule[…]]`) return zero results rather than erroring. See the Nesting Hierarchy table above.
- **Dangling boolean operators** (`pension &&`, `,pension`) are tolerated and mostly silently ignored, so a malformed expression can still "work" with misleading results.
- **Unbracketed proximity** — `5 apple pear` is searched as the literal phrase "5 apple pear", not as a proximity query. Use `5[apple,pear]` or `5(apple,pear)`.

If you're getting zero results from a query you expect to match, check the list above before assuming the index has no matches.

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
