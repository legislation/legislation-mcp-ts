/**
 * Tool: search_legislation_advanced
 *
 * Advanced structured search over legislation XML via the Research API.
 */

import {
  ResearchClient,
  ResearchDocument,
  ResearchMatch,
  ResearchSearchResponse,
} from "../api/research-client.js";
import { parseLegislationUri } from "../utils/legislation-uri.js";

export const name = "search_legislation_advanced";

export const description = `Advanced structured search over legislation using a powerful query syntax. Supports keyword search, proximity search, element-scoped search (title, chapter, paragraph, footnote, etc.), nested element queries, boolean logic, range queries, counting, and ordering.

Pass a \`query\` string in the query syntax. Returns paginated document results with optional snippets and structural element matches. Use \`page\` to paginate; check \`meta.morePages\`.
If the query includes \`count(...)\`, each result also includes per-document counter values in \`counts\`.

Example: \`title(pension) && type=ukpga && year>=2020\`

Query syntax reference: \`advanced://query-syntax\`

See also: \`json://advanced-search-response\`, \`types://guide\``;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Query in the advanced search syntax (see advanced://query-syntax)",
    },
    page: {
      type: "number",
      description: "Page number (default: 1, 10 results per page)",
    },
  },
  required: ["query"],
};

/** Strip <mark> tags from snippet text. */
function stripMark(text: string): string {
  return text.replace(/<\/?mark>/g, "");
}

function shapeDocument(doc: ResearchDocument): Record<string, unknown> {
  // The API returns a minimal shape (only id, title, counts) when results are
  // ordered by a counter field. Re-derive id/type/number/link from the URI,
  // and year for calendar-year legislation (regnal years like "Vict/57"
  // can't be parsed numerically, so year is omitted in that case).
  //
  // We always prefer the URI-parsed type because the API's `doc.type` field
  // uses long-form names (e.g., "UnitedKingdomStatutoryInstrument") while the
  // MCP response is documented to use short codes (e.g., "uksi").
  const parsed = parseLegislationUri(doc.id);
  const yearFromUri = parsed ? Number(parsed.year) : NaN;
  const numberFromUri = parsed ? Number(parsed.number) : NaN;

  const result: Record<string, unknown> = {
    id: parsed
      ? `${parsed.type}/${parsed.year}/${parsed.number}`
      : doc.id,
    type: parsed?.type ?? doc.type,
    year: doc.year ?? (Number.isFinite(yearFromUri) ? yearFromUri : undefined),
    number:
      doc.number ?? (Number.isFinite(numberFromUri) ? numberFromUri : undefined),
    title: doc.title,
    link:
      doc.link ??
      (parsed
        ? `http://www.legislation.gov.uk/${parsed.type}/${parsed.year}/${parsed.number}`
        : undefined),
  };

  if (doc.enacted) result.enacted = doc.enacted;
  if (doc.made) result.made = doc.made;
  if (doc.laid) result.laid = doc.laid;
  if (doc.cif) result.cif = doc.cif;
  if (doc.valid) result.valid = doc.valid;
  if (doc.modified) result.modified = doc.modified;
  if (doc.ISBN) result.ISBN = doc.ISBN;

  if (doc.snippets && doc.snippets.length > 0) {
    result.snippets = doc.snippets.map((s) => stripMark(s.text));
  }

  if (doc.matches && doc.matches.length > 0) {
    result.matches = doc.matches.map((m: ResearchMatch) => {
      const match: Record<string, unknown> = {
        name: m.name,
        number: m.number,
        heading: m.heading,
        link: m.link,
      };
      if (m.snippets && m.snippets.length > 0) {
        match.snippets = m.snippets.map((s) => stripMark(s.text));
      }
      return match;
    });
  }

  if (doc.counts) {
    result.counts = doc.counts;
  }

  return result;
}

export async function execute(
  args: { query: string; page?: number },
  client: ResearchClient
) {
  try {
    const response: ResearchSearchResponse = await client.search(
      args.query,
      args.page
    );

    const shaped = {
      meta: {
        query: response.q,
        case: response.case,
        stem: response.stem,
        punctuation: response.punctuation,
        amendments: response.amendments,
        page: response.page,
        resultsPerPage: response.count,
        morePages: response.more,
      },
      documents: response.documents.map(shapeDocument),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(shaped, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching legislation (advanced): ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
