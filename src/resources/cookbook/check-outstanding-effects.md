# Check Outstanding Effects

**Question:** "Is the Equality Act 2010 up to date, and if not, what amendments are outstanding?"

This recipe shows how to determine whether legislation has been fully updated with all enacted amendments, and how to identify any outstanding effects.

## Approach

Use `get_legislation_metadata` to check the `upToDate` flag and, if needed, inspect the `unappliedEffects` array for effects marked `outstanding`.

---

## 1. Search for the legislation

**Tool:** `search_legislation`

**Parameters:**
```json
{
  "title": "Equality Act 2010"
}
```

**Result:**
```json
{
  "documents": [
    {
      "id": "ukpga/2010/15",
      "type": "ukpga",
      "year": 2010,
      "number": 15,
      "title": "Equality Act 2010",
      "date": "2010-04-08"
    }
  ]
}
```

**What to extract:** The `type`, `year`, and `number` fields.

## 2. Get metadata (latest version)

**Tool:** `get_legislation_metadata`

**Parameters:**
```json
{
  "type": "ukpga",
  "year": "2010",
  "number": "15"
}
```

**Important:** Do not pass a `version` parameter. The `upToDate` field is only computed for the latest version.

**Result includes:**
```json
{
  "id": "ukpga/2010/15",
  "title": "Equality Act 2010",
  "upToDate": true,
  "unappliedEffects": [
    {
      "type": "inserted",
      "applied": false,
      "required": true,
      "outstanding": false,
      "target": {
        "id": "ukpga/2010/15",
        "title": "Equality Act 2010",
        "provisions": "s. 40(1A)-(1C)"
      },
      "source": {
        "id": "ukpga/2025/36",
        "title": "Employment Rights Act 2025",
        "provisions": "s. 21"
      },
      "commencement": "s. 159(3)",
      "inForce": []
    }
  ]
}
```

## 3. Check the `upToDate` flag

- `true` — All in-force effects have been applied. The text is current.
- `false` — Some effects are outstanding. The text does not reflect all enacted amendments.
- Absent — No unapplied effects data available, or a specific version was requested.

## 4. If not up to date, find outstanding effects

Filter the `unappliedEffects` array for entries where `outstanding` is `true`:

```
outstanding effects = unappliedEffects.filter(e => e.outstanding)
```

Each outstanding effect tells you:
- **What changed:** `type` (e.g. "words substituted", "repealed")
- **What's affected:** `target.provisions` (e.g. "s. 12(7)(a)")
- **What made the change:** `source.title` and `source.provisions`
- **When it came into force:** `inForce[].date`

## 5. Formulate the answer

**If up to date:**
"The Equality Act 2010 is up to date. There are 44 unapplied effects, but none are currently outstanding — they are either not yet in force or not required to be applied."

**If not up to date:**
"The Equality Act 2010 is not up to date. There are 3 outstanding effects that have not yet been applied to the text:
1. s. 12(7)(a) — substituted by the Automated Vehicles Act 2024 (Sch. 2 para. 1), in force since 2025-06-01
2. ..."

## Key Concepts

### What makes an effect "outstanding"?

An effect is outstanding when all three conditions are met:
1. It has **not been applied** (`applied` is `false`)
2. It is **required** to be applied (`required` is `true`)
3. It has at least one **in-force date on or before today** (`inForce[].date <= today`)

Effects that are prospective (no in-force date yet) or future-dated are not outstanding — they represent amendments that have been enacted but are not yet in force.

### Unapplied vs outstanding

- **Unapplied** = the amendment has not been incorporated into the text (broad category)
- **Outstanding** = the amendment should have been incorporated by now but hasn't been (subset of unapplied)

A document can have many unapplied effects and still be "up to date" if none of them are outstanding.

## Checking a Specific Section

You can scope the check to a specific fragment (Part, Chapter, section, etc.) using the `fragment` parameter. This is useful when you only care about whether a particular provision is up to date, rather than the whole document.

**Question:** "Is Part 2 Chapter 1 of the Equality Act 2010 up to date?"

**Tool:** `get_legislation_metadata`

**Parameters:**
```json
{
  "type": "ukpga",
  "year": "2010",
  "number": "15",
  "fragment": "part/2/chapter/1"
}
```

The response has the same structure as a whole-document request, but `upToDate` and `unappliedEffects` are scoped to the fragment.

Use `get_legislation_table_of_contents` to discover valid fragment identifiers.

## Example Queries This Recipe Answers

- "Is this Act up to date?"
- "Are there any outstanding amendments to this legislation?"
- "What changes haven't been applied to this Act yet?"
- "Has the Theft Act 1968 been fully updated?"
- "Which amendments to this Act are still pending?"
- "Is section 12 of this Act up to date?"
- "Are there outstanding effects on Part 2 of the Equality Act?"
