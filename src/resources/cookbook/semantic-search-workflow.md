# Semantic Search Workflow

**Requires the semantic search backend.** Step-by-step guide for using semantic search to find relevant legislation. The recipe below calls `search_legislation_semantic` and `search_legislation_sections_semantic`, which are advertised only when that backend is configured — if they are not in your tool list, use `search_legislation` instead.

## When to Use Semantic Search

Use semantic search when:
- Searching by concept or meaning rather than exact keywords
- Exploring legislation on a topic without knowing specific titles
- Finding sections across all legislation related to a concept
- Research is exploratory rather than citing specific documents

Use standard search when:
- You know the exact title or citation
- You need guaranteed current results
- You're doing critical legal research that must be authoritative

## Example: Find Sections About Data Subject Rights

**Goal:** Find all sections in UK legislation that deal with data subject rights, even if they use different terminology.

### Step 1: Semantic Section Search

Start with a broad conceptual query:

```json
{
  "tool": "search_legislation_sections_semantic",
  "arguments": {
    "query": "data subject rights access personal information",
    "limit": 10,
    "includeText": true
  }
}
```

**Result:** Returns sections ranked by relevance with full text:

```json
[
  {
    "provisionId": "section/45",
    "provisionType": "section",
    "number": 45,
    "legislation": {
      "id": "ukpga/2018/12",
      "type": "ukpga",
      "year": 2018,
      "number": 12
    },
    "title": "Confirmation of erasure",
    "text": "(1) Where personal data relating to a data subject have been erased...",
    "extent": ["E", "W", "S", "NI"]
  }
]
```

### Step 2: Identify Relevant Legislation

From the results, note which Acts appear most frequently:
- `ukpga/2018/12` (Data Protection Act 2018)
- `ukpga/1998/29` (Data Protection Act 1998 - if still indexed)

### Step 3: Verify Against Live Data

**Important:** Semantic results may be out of date. Verify using standard search:

```json
{
  "tool": "search_legislation",
  "arguments": {
    "title": "Data Protection Act 2018"
  }
}
```

Check that:
- The Act exists and matches what semantic search found
- No recent amendments have changed the sections
- The Act is still in force

### Step 4: Get Full Context

For the relevant sections, retrieve the complete Act:

```json
{
  "tool": "get_legislation",
  "arguments": {
    "type": "ukpga",
    "year": "2018",
    "number": "12",
    "format": "xml"
  }
}
```

Or get just metadata:

```json
{
  "tool": "get_legislation_metadata",
  "arguments": {
    "type": "ukpga",
    "year": "2018",
    "number": "12"
  }
}
```

This gives you:
- Full Act title: "Data Protection Act 2018"
- Extent: Which parts of UK it applies to
- Enactment date: When it became law
- Status: Whether it's been amended

## Example: Find Relevant Acts First

**Goal:** Find Acts dealing with employment rights, then explore their sections.

### Step 1: Search for Relevant Acts

```json
{
  "tool": "search_legislation_semantic",
  "arguments": {
    "query": "unfair dismissal employment protection tribunal",
    "limit": 5
  }
}
```

**Result:** Returns Acts with best-matching sections and scores:

```json
{
  "results": [
    {
      "id": "ukpga/1996/18",
      "title": "Employment Rights Act 1996",
      "sections": [
        {
          "number": "94",
          "provisionType": "section",
          "score": 0.92
        },
        {
          "number": "95",
          "provisionType": "section",
          "score": 0.89
        }
      ]
    }
  ]
}
```

### Step 2: Get Specific Sections

Note that `search_legislation_semantic` only returns section *identifiers*, not text. To get the actual text:

```json
{
  "tool": "search_legislation_sections_semantic",
  "arguments": {
    "query": "unfair dismissal",
    "types": ["ukpga"],
    "yearFrom": 1990,
    "yearTo": 2000,
    "includeText": true,
    "limit": 5
  }
}
```

This returns the full section text for the most relevant sections.

## Understanding Scores

Semantic search returns similarity scores (0.0-1.0):

| Score Range | Interpretation |
|-------------|----------------|
| 0.85 - 1.0 | Highly relevant, strong semantic match |
| 0.70 - 0.84 | Moderately relevant, good conceptual match |
| 0.50 - 0.69 | Possibly relevant, weak match |
| < 0.50 | Likely not relevant |

**Note:** There's no fixed threshold for "relevant" - it depends on your use case and how broad your query is.

## Filtering Results

### By Legislation Type

Focus on primary legislation (Acts):

```json
{
  "query": "data protection",
  "types": ["ukpga", "asp", "asc", "nia"]
}
```

Focus on secondary legislation (Regulations):

```json
{
  "query": "data protection",
  "types": ["uksi", "ssi", "wsi", "nisr"]
}
```

### By Year Range

Find recent legislation only:

```json
{
  "query": "data protection",
  "yearFrom": 2015,
  "yearTo": 2025
}
```

**Warning:** Year filters don't work reliably for regnal-year legislation (historical Acts).

## Common Patterns

### Pattern 1: Broad Exploration

1. Start with `search_legislation_sections_semantic` with broad query
2. Review top 10-20 results to understand the landscape
3. Note which Acts appear most frequently
4. Use `get_legislation_metadata` to learn more about key Acts
5. Verify critical findings with `search_legislation` (standard search)

### Pattern 2: Targeted Research

1. Use `search_legislation_semantic` to find relevant Acts
2. Review section identifiers and scores
3. Use `search_legislation_sections_semantic` with filtered types/years
4. Retrieve full documents with `get_legislation`
5. Cross-check against live data

### Pattern 3: Comparative Research

1. Search for a concept across different jurisdictions (England vs Scotland):
   ```json
   {
     "query": "education standards assessment",
     "types": ["ukpga"]  // England & Wales
   }
   ```

   Then:
   ```json
   {
     "query": "education standards assessment",
     "types": ["asp"]  // Scotland
   }
   ```

2. Compare results to see different legislative approaches

## Important Limitations

1. **Data Freshness:** The semantic index is a snapshot. Legislation passed in the last few days/weeks may not be indexed yet.

2. **Amendments:** Recent amendments may not be reflected. Always verify important results.

3. **No Act Titles in Section Results:** When using `search_legislation_sections_semantic`, you only get the legislation ID (e.g., "ukpga/2018/12"), not the title. Use `get_legislation_metadata` to get "Data Protection Act 2018".

4. **Performance:** Setting `includeText=true` significantly slows down section searches. Only use when you need the actual text.

5. **Regnal Years:** Historical legislation using regnal years (e.g., "1 & 2 Eliz. 2") can't be reliably filtered by year.

## Best Practices

1. **Start Broad:** Begin with a broad query to understand the landscape
2. **Refine Gradually:** Use filters (types, years) to narrow results
3. **Always Verify:** Cross-check semantic results against `search_legislation` for critical research
4. **Use Scores Wisely:** Don't ignore results with scores below 0.7 - they may still be relevant
5. **Combine Tools:** Use semantic search for discovery, standard tools for verification
6. **Check Metadata:** Always get Act metadata to ensure you're citing correctly

## Related Resources

- **`json://semantic-search-response`** - Response format for Act-level search
- **`json://semantic-section-response`** - Response format for section-level search
- **`guide://getting-started`** - Tool selection decision tables
- **`types://guide`** - Legislation type codes reference
