# Cookbook Index

Step-by-step recipes for common tasks with UK legislation data.

## Available Recipes

### `cookbook://check-extent`
**Check Geographical Extent of Legislation**

Learn how to determine which jurisdictions (England, Wales, Scotland, Northern Ireland) a piece of legislation applies to.

**What you'll learn:**
- Using `get_legislation_metadata` to retrieve extent information
- Interpreting extent codes (E, W, S, NI)
- Understanding UK-wide vs. jurisdiction-specific legislation

**Use cases:**
- "Does this Act apply in Scotland?"
- "Which parts of the UK does this regulation cover?"

---

### `cookbook://check-outstanding-effects`
**Check Outstanding Effects**

Determine whether legislation is up to date, and if not, identify which amendments are outstanding.

**What you'll learn:**
- Using `upToDate` to check if legislation text is current
- Filtering `unappliedEffects` for outstanding amendments
- Understanding the difference between unapplied and outstanding

**Use cases:**
- "Is this Act up to date?"
- "What amendments haven't been applied yet?"

---

### `cookbook://find-recent-si-by-subject`
**Find the Most Recent SI on a Subject**

Use subject-based filtering combined with sort-by-date to find the latest Statutory Instrument in a given policy area.

**What you'll learn:**
- Using the `subject` parameter (SI-only)
- Combining `subject`, `sort`, `extent`, and `exactExtent`
- Why subject doesn't apply to Acts
- Confirming an SI is actually in force

**Use cases:**
- "What's the most recent banking SI?"
- "Find the latest Welsh-only housing regulation"
- "Get the newest Scottish SI about education"

---

### `cookbook://point-in-time-version`
**Point‑in‑Time Retrieval (Versioning)**

Retrieve legislation as it stood on a specific date, or fetch the original enacted/made version.

**What you'll learn:**
- Using the `version` parameter with `get_legislation`
- When to use `enacted` / `made` vs a date
- How to compare versions safely

**Use cases:**
- "Show me this Act as it stood on 2024‑10‑18"
- "Get the original enacted version of this Act"

---

### `cookbook://search-effects`
**Search Legislative Effects**

Find which legislation a given Act amends, or which Acts amend a given piece of legislation.

**What you'll learn:**
- Using `search_effects` to query by source or target legislation
- Understanding effect types, applied status, and in-force dates
- Paginating through large result sets
- Combining source and target for precise queries

**Use cases:**
- "What does this Act amend?"
- "What amends this Act?"
- "What changes does Act X make to Act Y?"

---

### `cookbook://semantic-search-workflow`
**Semantic Search Workflow (Experimental)**

Use semantic search to find relevant legislation by concept, then verify and retrieve full documents.

**What you'll learn:**
- When to use semantic vs standard search
- Understanding similarity scores
- Filtering by type and year
- Verifying semantic results against live data
- Complete workflows for exploration and targeted research

**Use cases:**
- "Find all sections about data subject rights"
- "Explore employment legislation dealing with unfair dismissal"
- "Compare approaches to education standards across jurisdictions"

---

## Recipe Format

Each recipe follows this structure:

1. **Prerequisites** - What information you need before starting
2. **Step-by-step instructions** - Clear, numbered steps
3. **Examples** - Real-world examples with actual data
4. **Complete workflow** - End-to-end demonstration
5. **Decision logic** - Pseudocode for implementing the pattern
6. **Limitations** - Current constraints and future enhancements
7. **Related resources** - Links to relevant documentation

## Contributing

Recipes are based on real-world tasks that AI agents need to accomplish with UK legislation data. As we identify new common patterns, we'll add more recipes to this collection.
