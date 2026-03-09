# Search Legislative Effects

**Question:** "What does the Automated Vehicles Act 2024 amend?" or "What amends the Equality Act 2010?"

This recipe shows how to find legislative effects — amendments, repeals, insertions, commencements, etc. — by searching for the source (affecting) or target (affected) legislation.

## Approach

Use `search_effects` to query by source, target, or both. The tool returns a paginated list of effects.

- **Source parameters** find effects made BY a piece of legislation ("what did Act X change?")
- **Target parameters** find effects made TO a piece of legislation ("what changed Act Y?")

---

## Example A: What does an Act amend?

**Question:** "What does the Automated Vehicles Act 2024 amend?"

### 1. Search for the legislation

**Tool:** `search_legislation`

**Parameters:**
```json
{
  "title": "Automated Vehicles Act 2024"
}
```

**Result:**
```json
{
  "documents": [
    {
      "id": "ukpga/2024/10",
      "type": "ukpga",
      "year": 2024,
      "number": 10,
      "title": "Automated Vehicles Act 2024"
    }
  ]
}
```

### 2. Search for effects by source

**Tool:** `search_effects`

**Parameters:**
```json
{
  "sourceType": "ukpga",
  "sourceYear": "2024",
  "sourceNumber": "10"
}
```

**Result includes:**
```json
{
  "meta": {
    "totalResults": 42,
    "page": 1,
    "itemsPerPage": 50,
    "morePages": false
  },
  "effects": [
    {
      "type": "words substituted",
      "applied": false,
      "required": true,
      "target": {
        "id": "ukpga/2010/15",
        "title": "Equality Act 2010",
        "provisions": "s. 12(7)(a)"
      },
      "source": {
        "id": "ukpga/2024/10",
        "title": "Automated Vehicles Act 2024",
        "provisions": "Sch. 2 para. 1"
      },
      "inForce": [
        { "date": "2025-06-01", "description": "wholly in force" }
      ]
    }
  ]
}
```

### 3. Summarise the results

Group the effects by target legislation to give a clear picture:

"The Automated Vehicles Act 2024 makes 42 changes to other legislation, including amendments to the Equality Act 2010, the Road Traffic Act 1988, and the Road Traffic Offenders Act 1988."

---

## Example B: What amends an Act?

**Question:** "What amends the Equality Act 2010?"

### 1. Search for the legislation

**Tool:** `search_legislation`

**Parameters:**
```json
{
  "title": "Equality Act 2010"
}
```

### 2. Search for effects by target

**Tool:** `search_effects`

**Parameters:**
```json
{
  "targetType": "ukpga",
  "targetYear": "2010",
  "targetNumber": "15"
}
```

This returns all effects that change the Equality Act 2010, from any source legislation.

### 3. Paginate if needed

If `meta.morePages` is `true`, fetch the next page:

```json
{
  "targetType": "ukpga",
  "targetYear": "2010",
  "targetNumber": "15",
  "page": 2
}
```

---

## Example C: Effects between two specific Acts

You can combine source and target to find effects between two specific pieces of legislation:

**Question:** "What changes does the Automated Vehicles Act 2024 make to the Road Traffic Act 1988?"

**Tool:** `search_effects`

**Parameters:**
```json
{
  "sourceType": "ukpga",
  "sourceYear": "2024",
  "sourceNumber": "10",
  "targetType": "ukpga",
  "targetYear": "1988",
  "targetNumber": "52"
}
```

---

## Understanding the Results

Each effect tells you:
- **`type`** — what kind of change (e.g. "words substituted", "repealed", "inserted", "coming into force")
- **`applied`** / **`required`** — whether the change has been applied to the English revised text, and whether it needs to be
- **`appliedWelsh`** / **`requiredWelsh`** — same for the Welsh revised text (only present for Welsh legislation)
- **`target`** — the affected legislation, including specific provisions (e.g. "s. 12(7)(a)")
- **`source`** — the affecting legislation, including the provision that makes the change
- **`inForce`** — any in-force dates and qualifications exposed by the feed
- **`commencement`** — the commencement authority, if any

### Applied vs unapplied

- `applied: true` — the change has been incorporated into the revised text on legislation.gov.uk
- `applied: false, required: true` — the change requires application to the English revised text, but `search_effects` alone does not tell you whether it is already outstanding
- `applied: false, required: false` — the change does not need to be applied (e.g. editorial discretion)

To determine whether an unapplied effect is already outstanding, use `get_legislation_metadata` for the affected document and inspect `unappliedEffects[].outstanding`. `search_effects` does not return an `outstanding` field.

### Reading `inForce`

- If `inForce[].date` is present, that is the exposed in-force date
- `inForce[].description` may add qualifications such as "wholly in force"
- If no date is present, the in-force date has not yet been determined

### Relationship to `get_legislation_metadata`

The `unappliedEffects` returned by `get_legislation_metadata` are a subset of what `search_effects` returns — only the unapplied effects for a specific document. `search_effects` returns all effects (applied and unapplied) and can search across legislation.

## Example Queries This Recipe Answers

- "What does this Act amend?"
- "What legislation has been amended by this Act?"
- "What amends this Act?"
- "Which Acts have changed this legislation?"
- "What changes does Act X make to Act Y?"
- "Has this Act been amended by any secondary legislation?"
