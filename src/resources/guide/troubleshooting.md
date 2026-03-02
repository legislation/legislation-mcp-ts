# Troubleshooting Common Issues

Solutions to common errors and edge cases when working with UK legislation data.

## Connection and Configuration Errors

### Error: "Failed to fetch" (Semantic Search)

**Symptoms:**
```
Error searching legislation (semantic): Failed to fetch http://localhost:8000/legislation/search: ...
```

**Cause:** Semantic search API is not configured or not running.

**Solutions:**

1. **Check if semantic API is required:**
   - Semantic search tools are optional
   - Standard tools (`search_legislation`, `get_legislation`, `get_legislation_metadata`) work independently

2. **Configure semantic API:**
   ```bash
   export SEMANTIC_API_BASE_URL=http://localhost:8000
   export SEMANTIC_API_KEY=your-key-here  # if required
   npm start
   ```

3. **Verify API is running:**
   ```bash
   curl http://localhost:8000/health  # or your API endpoint
   ```

4. **Use standard search instead:**
   - `search_legislation` for keyword search
   - `get_legislation` for full documents

---

## Search Result Errors

### Error: "404 Not Found" (Get Legislation)

**Symptoms:**
```
Error: Failed to fetch legislation: 404 Not Found
```

**Causes:**
1. Invalid type/year/number combination
2. Legislation doesn't exist
3. Typo in parameters

**Solutions:**

1. **Verify the citation exists:**
   ```json
   {
     "tool": "search_legislation",
     "arguments": {
       "title": "Data Protection Act 2018"
     }
   }
   ```

2. **Check common mistakes:**
   - Using `2018` as a string instead of number (both work, but be consistent)
   - Wrong legislation type (e.g., `uksi` instead of `ukpga`)
   - Incorrect year format for regnal years

3. **Try metadata first:**
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

   Metadata requests sometimes provide better error messages.

---

### Empty Search Results

**Symptoms:** Search returns 0 results when you expect to find legislation.

**Common Causes:**

1. **Too specific query:**
   - Try broader keywords
   - Remove quote marks for exact matching

2. **Wrong year filter:**
   - Regnal-year legislation can't be filtered reliably by year
   - Try searching without year filter first

3. **Wrong legislation type:**
   - Check if it's primary (`ukpga`) vs secondary (`uksi`)
   - See `types://guide` for all type codes

4. **Very recent legislation:**
   - Standard search: Allow a few hours for indexing
   - Semantic search: May take days/weeks to appear in vector index

**Solutions:**

```json
// Too specific
{
  "title": "The Data Protection Act 2018 (Amendment) Regulations"
}

// Better - broader
{
  "title": "Data Protection"
}

// Or use keyword search
{
  "q": "data protection"
}
```

---

## Historical Legislation Issues

### Regnal Year Confusion

**Symptoms:**
- Year filter returns unexpected results
- Can't find historical Acts by year

**Explanation:**

Historical UK legislation uses regnal years (monarch's reign years) instead of calendar years:
- "1 & 2 Eliz. 2 c. 3" = Year 1-2 of Elizabeth II's reign (not 1952-1953)
- These don't map directly to calendar years
- Year filters don't work reliably for this legislation

**Solutions:**

1. **Search by title instead:**
   ```json
   {
     "tool": "search_legislation",
     "arguments": {
       "title": "Customs and Excise Act 1952"
     }
   }
   ```

2. **Browse by type without year filter:**
   ```json
   {
     "tool": "search_legislation",
     "arguments": {
       "type": "ukpga"
     }
   }
   ```

3. **Use the legislation.gov.uk website** for complex historical searches

---

### Missing Historical Data

**Symptoms:** Legislation exists on legislation.gov.uk but returns 404 from API.

**Explanation:**

Not all historical legislation is available via all formats:
- XML (CLML): Most comprehensive coverage
- Akoma Ntoso: Limited to recent legislation
- HTML: Varies by date range
- Metadata: May not exist for very old legislation

**Solutions:**

1. **Try different formats:**
   ```json
   {
     "tool": "get_legislation",
     "arguments": {
       "type": "ukpga",
       "year": "1925",
       "number": "86",
       "format": "xml"  // Try xml first, then html
     }
   }
   ```

2. **Check on website first:**
   Visit `https://www.legislation.gov.uk/ukpga/1925/86` to see what's available

---

## Point-in-Time Version Issues

### Version Not Found

**Symptoms:**
```
Error: Version not available for this date
```

**Causes:**
1. Date is before legislation was enacted
2. Date format is wrong (must be `YYYY-MM-DD`)
3. No version exists for that specific date

**Solutions:**

1. **Check enactment date first:**
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

   Look for `enactmentDate` in the response.

2. **Use "enacted" instead:**
   ```json
   {
     "tool": "get_legislation",
     "arguments": {
       "type": "ukpga",
       "year": "2018",
       "number": "12",
       "version": "enacted"
     }
   }
   ```

3. **Try a later date:**
   Point-in-time versions may not be available for every single day.

---

## Metadata and Parsing Issues

### Missing Extent Information

**Symptoms:** `extent` field is `undefined` or missing from metadata.

**Explanation:**

Some older legislation doesn't include extent metadata:
- May not have `RestrictExtent` attributes in XML
- Extent information might not be structured in older documents

**Solutions:**

1. **Assume UK-wide extent as fallback:**
   ```javascript
   const extent = metadata.extent || ["E", "W", "S", "NI"];
   ```

2. **Check the full document:**
   ```json
   {
     "tool": "get_legislation",
     "arguments": {
       "type": "ukpga",
       "year": "1925",
       "number": "86",
       "format": "xml"
     }
   }
   ```

   Look for `RestrictExtent` attributes in specific sections.

3. **Refer to Explanatory Notes** (if available):
   Search for "extent" in the document text.

---

### Parsing CLML XML Issues

**Symptoms:** Can't find expected elements or attributes in XML.

**Common Mistakes:**

1. **Wrong namespace:**
   - CLML uses XML namespaces
   - Must use proper namespace prefixes when parsing

2. **Looking in wrong section:**
   - Some metadata is in `<Metadata>` section
   - Content is in `<Body>` section
   - Different elements for primary vs secondary legislation

**Solutions:**

1. **Read the schema guide:**
   See `clml://schema-guide` for structure reference

2. **Inspect the XML first:**
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

   Review actual structure before parsing.

3. **Check the XSD:**
   Visit https://www.legislation.gov.uk/schema/legislation.xsd

---

## Semantic Search Specific Issues

### Low Scores / Irrelevant Results

**Symptoms:** Semantic search returns results with low scores or seemingly irrelevant sections.

**Causes:**
1. Query too broad or vague
2. Using very domain-specific terminology
3. Legislation uses different terminology than query

**Solutions:**

1. **Refine your query:**
   ```json
   // Too vague
   { "query": "rights" }

   // Better - more specific
   { "query": "data subject rights access erasure portability" }
   ```

2. **Add filters:**
   ```json
   {
     "query": "unfair dismissal",
     "types": ["ukpga"],
     "yearFrom": 1990,
     "yearTo": 2010
   }
   ```

3. **Try alternative terminology:**
   - "unfair dismissal" vs "wrongful termination"
   - "data protection" vs "privacy rights"

4. **Set a score threshold** when processing results:
   ```javascript
   const relevant = results.filter(r => r.score > 0.7);
   ```

---

### Semantic Results Don't Match Standard Search

**Symptoms:** Semantic search finds different legislation than standard keyword search.

**Explanation:** This is expected behavior:
- **Standard search:** Exact keyword matching, real-time data
- **Semantic search:** Conceptual matching, may lag behind live data

**Solutions:**

1. **Use both tools:**
   - Semantic for discovery
   - Standard for verification

2. **Cross-check important results:**
   ```json
   // Found via semantic search
   {
     "tool": "search_legislation",
     "arguments": {
       "title": "Data Protection Act 2018"
     }
   }
   ```

3. **Understand the trade-offs:**
   - Semantic: Better at understanding meaning, but may be outdated
   - Standard: Authoritative and current, but requires exact keywords

---

## Performance Issues

### Slow Response Times

**Symptoms:** Requests take more than a few seconds to complete.

**Common Causes:**

1. **Including section text:**
   ```json
   {
     "tool": "search_legislation_sections_semantic",
     "arguments": {
       "query": "data protection",
       "includeText": true,  // This slows down the request
       "limit": 50  // Large limit makes it worse
     }
   }
   ```

2. **Large result sets:**
   Requesting 100+ results at once

3. **Complex XML documents:**
   Very large Acts (1000+ sections)

**Solutions:**

1. **Omit text when possible:**
   ```json
   {
     "includeText": false  // Much faster
   }
   ```

   Get text only for the specific sections you need later.

2. **Use pagination:**
   ```json
   {
     "limit": 10,
     "offset": 0  // First page
   }
   ```

3. **Request metadata first, then full document:**
   ```json
   // Fast: metadata only
   { "tool": "get_legislation_metadata" }

   // Slower: full document
   { "tool": "get_legislation" }
   ```

---

## Getting Help

If you encounter an issue not covered here:

1. **Check the relevant resource guide:**
   - `guide://getting-started` - Tool selection and workflows
   - `clml://schema-guide` - XML parsing
   - `types://guide` - Legislation types
   - `cookbook://index` - Step-by-step recipes

2. **Verify on legislation.gov.uk:**
   Visit the official website to confirm data exists

3. **Check UK legislative concepts:**
   https://www.legislation.gov.uk/understanding-legislation

4. **Review tool parameters:**
   Check the tool's `inputSchema` description for parameter requirements
