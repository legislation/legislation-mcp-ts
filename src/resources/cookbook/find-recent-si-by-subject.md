# Find the Most Recent SI on a Subject

**Question:** "What's the most recent Statutory Instrument about [topic]?"

This recipe shows how to use subject-based filtering with sort-by-date to find the latest Statutory Instrument in a given policy area (e.g. banking, aviation, pensions, housing).

Subject filtering is a feature of Statutory Instrument (SI) metadata — Acts and other primary legislation don't carry subject headings, so this recipe is specific to SIs.

## Prerequisites

You need:
- A **subject** keyword (e.g. `banking`, `housing`, `pensions`). Subjects come from a controlled vocabulary maintained by the publisher; a single keyword like `banking` is usually enough.
- Optionally, a jurisdiction (for Welsh, Scottish, or Northern Ireland SIs).

## Step 1: Search with Subject and Sort by Publication Date

**Tool:** `search_legislation`

**Parameters:**
```json
{
  "subject": "banking",
  "sort": "published"
}
```

**What this does:**
- `subject` filters results to SIs tagged with the `banking` subject heading.
- `sort: "published"` orders results newest first, so the top result is the most recent.
- Because `subject` is set without a `type`, the tool defaults `type` to `secondary` (the aggregate over all SI families).

**Result:** JSON with the most recent SI first:
```json
{
  "documents": [
    {
      "id": "uksi/2025/1024",
      "type": "uksi",
      "year": 2025,
      "number": 1024,
      "title": "The Banking Act 2009 (...) Regulations 2025",
      "date": "2025-09-30"
    },
    {
      "id": "uksi/2025/812",
      "type": "uksi",
      "year": 2025,
      "number": 812,
      "title": "...",
      "date": "2025-07-15"
    }
  ],
  "meta": { "morePages": 4 }
}
```

## Step 2 (Optional): Narrow by Jurisdiction

If you want the most recent SI on a subject that applies in a specific jurisdiction, add an `extent` filter:

```json
{
  "subject": "banking",
  "sort": "published",
  "extent": ["W"]
}
```

This returns SIs tagged with `banking` whose extent includes Wales. For legislation that applies *only* to Wales (and nowhere else), add `exactExtent`:

```json
{
  "subject": "housing",
  "sort": "published",
  "extent": ["W"],
  "exactExtent": true
}
```

## Step 3 (Optional): Narrow by SI Type

If you want Scottish SIs specifically, set `type` to `["ssi"]`:

```json
{
  "subject": "housing",
  "type": ["ssi"],
  "sort": "published"
}
```

To combine multiple SI types in one query, pass them all — e.g. `["uksi", "ssi"]` returns both UK and Scottish SIs.

Valid SI-family types for this workflow:
- `uksi` — UK Statutory Instruments
- `ssi` — Scottish Statutory Instruments
- `wsi` — Welsh Statutory Instruments
- `nisr` — Northern Ireland Statutory Rules
- `secondary` — aggregate over all SI types (the default when `subject` is set)

Setting a non-SI type (e.g. `["ukpga"]`) alongside `subject` returns an error — Acts don't carry subject metadata.

## Step 4 (Optional): Confirm the SI Is In Force

The most recent SI by publication date isn't guaranteed to be in force — some are made but have a deferred commencement date, and a small number are revoked before coming into force. To confirm:

**Tool:** `get_legislation_metadata`

**Parameters:**
```json
{
  "type": "uksi",
  "year": "2025",
  "number": "1024"
}
```

Check the response's `status` and commencement information.

## Worked Example: Latest Banking SI

**Step 1 — Search:**
```json
{
  "subject": "banking",
  "sort": "published"
}
```

**Step 2 — Pick the top document** from the response and extract its `type`, `year`, and `number`.

**Step 3 — Confirm in force:**
```json
{
  "type": "uksi",
  "year": "2025",
  "number": "1024"
}
```

## Decision Logic (Pseudocode)

```
search_legislation {
  subject: <topic>,
  sort: "published",
  type: <SI-family type or omit for all SIs>,
  extent: <optional jurisdiction>,
  exactExtent: <optional, to match only that jurisdiction>
}

pick documents[0]

(optional) get_legislation_metadata { type, year, number }
  check status / commencement
```

## Notes and Limitations

- **Subject vocabulary**: subjects are drawn from a controlled list embedded in the SI metadata. Single-word keywords (`banking`, `housing`, `africa`) work reliably. Multi-word phrases may not match unless they correspond exactly to a subject heading.
- **SI-only**: this recipe cannot find primary legislation (Acts) by subject. For Act-level searches, use `title` or `text` keyword search instead.
- **Sort defaults**: if you omit `sort`, the default is `relevance` when `q` is set, `subject` (alphabetical by subject heading) when `subject` is set without `q`, and otherwise `basic`. The `basic` ordering groups by document category in alphabetical order (so `euretained` falls above `primary` and `secondary`, which means EU content tends to dominate the top of mixed results — to exclude EU-retained legislation from any search, pass `type: ["primary", "secondary"]`), then year descending, then number descending. For "most recent first", always set `sort: "published"` explicitly. To bypass relevance ranking on a keyword search, set `sort: "basic"`.
- **Pagination**: results are 20 per page. If the most recent SI is missing from the first page, check `meta.morePages` and paginate.

## Related Resources

- `json://search-response` — response field details
- `types://guide` — legislation type codes (including SI families)
- `cookbook://check-extent` — interpreting extent codes on a specific piece of legislation
