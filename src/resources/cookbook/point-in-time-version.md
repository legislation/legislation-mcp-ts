# Point‑in‑Time Retrieval (Versioning)

**Question:** "Show me this Act as it stood on a specific date."

This recipe shows how to retrieve historical versions of legislation using the `version` parameter. It works for Acts, SIs, and other legislation types that provide point‑in‑time versions.

## Prerequisites

You need the legislation's:
- **type** (e.g., "ukpga", "uksi")
- **year** (e.g., 2024)
- **number** (e.g., 1)

If you don't have these, start with `search_legislation` to find the document.

## Step 1: Identify the Document (Optional)

**Tool:** `search_legislation`

**Parameters:**
```json
{
  "title": "Sample Act Title"
}
```

**What to extract:** The `type`, `year`, and `number` fields.

**Resource:** See `json://search-response` for field details.

## Step 2: Retrieve the Original Version

Use a **version keyword** to get the original published version:

```json
{
  "type": "ukpga",
  "year": "2024",
  "number": "1",
  "version": "enacted"
}
```

**Version keywords:**
- `enacted` – Original version for UK primary legislation
- `made` – Original version for UK secondary legislation
- `created` – Original version for certain uncommon UK types
- `adopted` – Original version for EU legislation

**Result:** CLML XML (default) for the original published version.

## Step 3: Retrieve a Point‑in‑Time Version

Use a **date** to get the legislation as it stood on that date:

```json
{
  "type": "ukpga",
  "year": "2024",
  "number": "1",
  "version": "2024-10-18"
}
```

**Result:** the text as it stood on that date.

## Worked Example: UKPGA 2024/1

This Act has multiple versions:

### 1) Original enacted version (as published)
```json
{
  "type": "ukpga",
  "year": "2024",
  "number": "1",
  "version": "enacted"
}
```

### 2) First revised version (same text, editorial metadata added)
```json
{
  "type": "ukpga",
  "year": "2024",
  "number": "1",
  "version": "2024-01-25"
}
```

### 3) Later revised version (incorporates amendments)
```json
{
  "type": "ukpga",
  "year": "2024",
  "number": "1",
  "version": "2024-10-18"
}
```

**Note:** The enacted version and the first revised version often have identical text. The revised version usually adds editorial metadata (such as extent or status attributes).

## Understanding Version Types

### What is "Enacted" vs "Revised"?

**Enacted Version (`version="enacted"` or `version="made"`):**
- The original text as passed by Parliament (for Acts) or made (for SIs)
- Published immediately after Royal Assent or making
- May lack some editorial enhancements
- Sometimes missing extent or status information that's added later
- For primary legislation, use `"enacted"`
- For secondary legislation (SIs), use `"made"`

**Latest Version (no version parameter):**
- The latest version of the legislation: usually the text as it stands today
- When metadata `versions` ends with `"prospective"`, it is the prospective version, which includes provisions not yet in force
- The text may have outstanding amendments: in force, but not yet applied. Check `upToDate` in `get_legislation_metadata`
- Has complete editorial metadata (extent, status, etc.)
- This is what most users need for current legal research

**Point-in-Time Version (`version="YYYY-MM-DD"`):**
- Snapshot of legislation as it stood on a specific date
- Shows the amendments in force on that date, as far as they have been applied to the text
- Useful for historical research or understanding how law evolved

### Why Are Enacted and First Revised Often Identical?

When legislation is first enacted:
1. **Enacted version** is published immediately with the original text
2. **First revised version** is published shortly after with editorial improvements:
   - Added `RestrictExtent` attributes showing geographical scope
   - Added `Status` attributes ("Prospective", "In Force", etc.)
   - Enhanced cross-reference links
   - Improved XML structure

The *text* is usually identical, but the *metadata* is more complete in the revised version.

**Example:** Data Protection Act 2018
- **Enacted version:** Published May 23, 2018 - basic XML structure
- **First revised version:** Published a few days later - same text, but with:
  - Extent codes on each provision
  - Commencement status markers
  - Enhanced table of contents

### Status Field Values

The `status` field in metadata can have these values:

| Status | Meaning | When to Expect |
|--------|---------|---------------|
| `"final"` | Legislation is enacted and available | Most common status |
| `"revised"` | Legislation has been editorially enhanced | After initial publication |
| `"draft"` | Proposed legislation not yet enacted | Pre-enactment only |
| `"proposed"` | Under consideration | Pre-enactment only |

**Note:** Despite the name, "revised" status doesn't mean the law has been amended - it means the *XML document* has been editorially improved.

## Interpreting Versions

### When to use `enacted` / `made`

Use when you want:
- The **original published text** exactly as passed/made
- To cite the original unamended version
- To compare original text against current version
- Historical research showing Parliament's original intent

**Example use case:** "What did section 10 say when the Act was first passed?"

### When to use a date

Use when you want:
- The legislation **as it stood** on a specific historical date
- To see what amendments were in force at that time
- To reconstruct past legal landscape
- Comparative analysis over time

**Example use case:** "What did the data protection law say on January 1, 2020, before GDPR changes?"

### When to use no version parameter (latest)

Use when you want:
- The **latest version**: usually the law as it stands today, or the prospective version (see above)
- The amendments applied so far (check `upToDate` for outstanding ones)
- Most common use case for legal research
- Complete metadata and editorial enhancements

**Example use case:** "What does the law say now?"

## Decision Logic (Pseudocode)

```
if you need the original published version:
  use version="enacted" (or "made" for SIs)

if you need a historical snapshot:
  use version="YYYY-MM-DD"

if you need the latest version (including a prospective one):
  omit the version parameter
```

## Notes and Limitations

- You can request a date without knowing when versions were created: you get the legislation as it stood on that day.
- Dates **before the first available version** return **an error**, which is indistinguishable from "document not found."
- Point‑in‑time versions only exist after editorial processing. Very recent legislation may return only the original version.
- To confirm which version you received, call `get_legislation_metadata` with the same `version` (and `fragment`, if any) and check its `version` field, the label of the version returned. For a fragment it can be earlier than the date requested. The `status` field says whether that is the original text (`final`) or a revised version (`revised`).
- When `versions` ends with `"prospective"`, don't pass it as `version`: leave `version` out to fetch that version.
- For human‑readable output, use `format: "html"` instead of CLML XML.

## Related Resources

- `clml://schema-guide` – CLML XML structure
- `json://metadata-response` – Metadata response format
- `types://guide` – Legislation type codes
