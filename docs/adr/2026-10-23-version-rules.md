# Version Rules for Metadata

**Date:** 2026-10-23
**Status:** Proposed — implemented on the `fragment-version-dates` branch, not yet merged.
**Follows:** two LGU2 API decisions: ADR 2026-10-19, reading a fragment's version from its content (API PR #49, issue #45), and ADR 2026-09-04, the prospective-provisions field (API PR #33).

## Context

`get_legislation_metadata`, and the `meta` object of a table of contents, report three fields that depend on how versions are read from a legislation.gov.uk payload: `version`, `versions` and `prospective`. The LGU2 API reads the same payloads and reports fields with the same names. Two API decisions changed how it reads them:

- **ADR 2026-10-19.** The `hasVersion` links can't be relied on to name a fragment's version. On a dated request they leave out the requested version, and they can miss a change altogether. The API now also reads dates from the fragment's content.
- **ADR 2026-09-04.** This corrected when a version is labelled `"prospective"` and added a field saying whether a response contains provisions not yet in force. A partly commenced Act has a dated version and still contains such provisions.

The MCP followed the earlier rules. It also found the element a response is about by `@id` alone. So it found nothing for `/body`, `/introduction`, `/signature`, `/note`, `/schedules` or `/annexes`, and treated a treaty's `/attachments` as the whole document.

This ADR keeps four things apart: what follows the API, where the MCP goes beyond it, the MCP's own contract, and a question left open. Known limitations come last.

## Decision

### 1. Follow the API's reading

| Rule | In the API | In the MCP |
|---|---|---|
| Dates from a fragment's content | ADR 2026-10-19; the `start-date` and `content-date` templates in `simplify/metadata.xsl` | `src/parsers/fragment-dates.ts` |
| A version that can't be dated | ADR 2026-09-04; the `prospective` template | `isUndateableVersion` in `src/parsers/metadata-parser.ts` |
| The `prospective` field | ADR 2026-09-04 | `hasProspectiveProvisions` |
| Finding the requested element | `$target` in `simplify/metadata.xsl` | `findFragment`, steps 1 and 2 |

- **Dates from a fragment's content.** For a fragment that isn't final, and whose version can be dated, up to two dates read from its content are added to `versions`. One is the date the returned version started, no later than `dct:valid` when there is one. The other, only when there is a `dct:valid`, is a later version's date after it. `version` is still chosen from `versions` against `dct:valid`, so a date from the links can be chosen over the content's.
- **A version that can't be dated.** A revised version is labelled `"prospective"` when the requested element is itself marked prospective with no start date. That means the token `Prospective` in `@Status` and no `@RestrictStartDate`. For a `P1`, its `P1group` counts too. A marking inside the element doesn't count. The MCP also tests the section holding a sub-provision (§2).
- **The `prospective` field.** It is `true` when the version can't be dated, or when anything inside the requested element is marked in the same way, whatever its `@Match`. It is never `false`, and it is left out on final text.
- **Finding the requested element.** For a fragment, first by `@DocumentURI`: the element whose URI is `dc:identifier` with any `/contents` removed, keeping its version and language. An `InternalLink`'s URI names its destination, so it never matches. Failing that, the `Schedules` container for `/schedules` or `/annexes`, and the first `Attachments` container for `/attachments`.

### 2. Beyond the API

**The request's scope.** Each tool passes the parser whether it requested a whole document or a fragment, as the API's endpoint does. A request for the `contents` fragment is the whole document's. A whole document's element is its root, even when the root's `@DocumentURI` differs from `dc:identifier`. The API looks the root up by its URI, so it would find nothing then. The response alone can't say reliably which was requested. Deciding from the lookup, for example, would read a whole treaty whose root's URI differs from its identifier as a fragment that wasn't found.

**The `@id` fallback.** When the steps in §1 find no element for a fragment, the MCP takes the element whose `@id` matches the fragment path, outside alternative versions (`Versions`). It reads the path with `parseLegislationUri`. This finds `ukpga/1990/43/section/34`, whose only `@DocumentURI`s carry an extent. The API can't find it (API issue #50).

The fallback needs the identifier and the root's `@DocumentURI` to parse as the same document: the same type, year and number. The parser misreads treaty identifiers. It reads `eut/euratom/article/9/paragraph/2` as paragraph 2 of a document `eut/euratom/article/9`. Without the check, such a request would take any element with the id `paragraph-2`.

When no element is found for a fragment, nothing is inspected: no content dates are read, and `prospective` is left out.

**A sub-provision of a prospective section.** The test for a version that can't be dated also covers the elements from the requested element up to its nearest `P1`, and that `P1`'s `P1group`. The API tests only the requested element and, for a `P1`, its `P1group`. So it gives `ukpga/2026/19/section/2/1`, a subsection of a prospective section, the version `enacted` and publishes `prospective: false`. Markings above the section, on a Part, Schedule or crossheading, still don't count. In the payloads checked, a section inside a marked container was always marked itself. A matching change to the API is to be reviewed separately. Until then, the two differ here.

### 3. The MCP's own contract

- **Inputs.** `get_legislation`, `get_legislation_fragment`, `get_legislation_metadata` and `get_legislation_table_of_contents` add `version` to the request URL as written. The documented forms are a first-version keyword and an ISO date. `prospective` is not an input. When `versions` ends with it, the caller leaves `version` out.
- **Output.** The JSON is the MCP's own format (`json://metadata-response`), not the API's. It shares these field names and rules, but chooses its own fields and when they appear.
- **Versioned requests.** On a request with a `version`, `get_legislation_metadata` and `get_legislation_table_of_contents` leave out `upToDate` and `unappliedEffects`. `get_legislation` and `get_legislation_fragment` show no up-to-date callout.

### 4. Deferred: when `upToDate` is computed

The MCP and the API compute `upToDate` under different conditions:

| | MCP | API |
|---|---|---|
| Computed | on every request without a `version` | only when `version` is the last label in `versions`, and the text is revised, or final with its effects fetched |
| An effect is in force if its date is on or before | today in UTC | the requested `pointInTime`, or else today in Europe/London |

So:
- A fragment requested without a `version`, whose `versions` lists a date later than its `version`, gets `upToDate` from the MCP but not from the API.
- A dated request for the latest version gets `upToDate` from the API but not from the MCP.
- During British Summer Time, the MCP's "today" is a day behind the API's for an hour each night.

This is left unchanged here. What `upToDate` should mean for the MCP's callers is a separate decision.

## Known limitations

These are not decisions.

- **Treaty identifiers.** `parseLegislationUri` can't read them. The lookup's first two steps don't rely on it, so a treaty's attachments and provisions with a matching URI are found. Fields read from the identifier, such as `pointInTime`, can still be missing or wrong for treaties.
- **Several elements with the requested URI.** The MCP takes the first it meets. The API's lookup would fail. No payload checked has had one.
- **No target found.** Then `prospective`'s absence means nothing was checked. `json://metadata-response` says that a non-final fragment's text was checked. That holds when the element is found, as it was in every real payload tried: sections, subsections, articles, schedules, chapters, crossheadings, the body, introduction, signature and note, schedules, annexes and attachments.
- **Numeric character references.** The table-of-contents, Atom and effects parsers don't decode them (`&#9;`). The metadata parser does (`htmlEntities`), so the `meta` of a table of contents is not affected.

## Tests

Constructed payloads, following the API's tests where they exist:

- `src/test/parsers/fragment-dates.test.ts`: content dates
- `src/test/parsers/prospective.test.ts`: the undateable version and the field, including a sub-provision of a prospective section
- `src/test/parsers/fragment-target.test.ts`: finding the requested element, including the treaty and regnal-year cases
- `src/test/tools/get-legislation-metadata.test.ts` and `src/test/parsers/toc-parser.test.ts`: the scope each caller passes
