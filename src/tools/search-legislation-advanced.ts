/**
 * Tool: search_legislation_advanced
 *
 * Advanced structured search over legislation XML via the Research API.
 */

import {
  ResearchClient,
  ResearchDocument,
  ResearchMatch,
  ResearchNonJsonResponseError,
  ResearchSearchResponse,
} from "../api/research-client.js";
import { parseLegislationUri } from "../utils/legislation-uri.js";

export const name = "search_legislation_advanced";

export const description = `Advanced structured search over legislation. Example query: \`title(pension) && type=ukpga && year>=2020\` (UK Acts from 2020 onwards with "pension" in the title).

Supports keyword and proximity search, element-scoped search (title, chapter, paragraph, footnote, etc.), nested element queries, boolean logic, range queries, counting, and ordering. Returns paginated document results with optional snippets and structural element matches. Use \`page\` to paginate; check \`meta.morePages\`. If the query includes \`count(...)\`, each result also includes per-document counter values in \`counts\`.

Full query syntax reference: \`advanced://query-syntax\` (read this before composing anything beyond trivial queries).

For simple metadata-based filtering (by \`type\`, \`year\`, \`subject\`, \`extent\`, etc.) without full-text snippets or element-scoped matching, \`search_legislation\` is lighter-weight.

See also: \`json://advanced-search-response\`, \`types://guide\``;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Query in the advanced search syntax. Key rules: (1) do NOT wrap phrases in quotes — space-separated words inside `()` or `[]` already form an exact phrase; (2) `,` is low-precedence AND — `title(little, pink dress)` means titles containing `little` AND the phrase `pink dress`; (3) the nine metacharacters `, ( ) [ ] ! < > =` must be backslash-escaped to appear literally in a term. Full grammar: advanced://query-syntax",
    },
    page: {
      type: "number",
      description: "Page number (default: 1, 10 results per page)",
    },
    case: {
      type: "boolean",
      description:
        "Case-sensitive matching. If omitted, the API treats this as false (case-insensitive).",
    },
    stem: {
      type: "boolean",
      description:
        "Stemmed matching — treat morphological variants of a word as equivalent (e.g. `commit` also matches `commits`, `committed`). If omitted, the API treats this as true. Set to false for exact word-form matches.",
    },
    punctuation: {
      type: "boolean",
      description:
        "Punctuation-sensitive matching. When true, indexed punctuation must be matched for a hit. Needed if your query contains backslash-escaped punctuation that should be required in the matched text. If omitted, the API treats this as false.",
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
  args: {
    query: string;
    page?: number;
    case?: boolean;
    stem?: boolean;
    punctuation?: boolean;
  },
  client: ResearchClient
) {
  try {
    const response: ResearchSearchResponse = await client.search(args.query, {
      page: args.page,
      case: args.case,
      stem: args.stem,
      punctuation: args.punctuation,
    });

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
    if (error instanceof ResearchNonJsonResponseError) {
      return {
        content: [
          { type: "text", text: `Likely query syntax error: ${error.message}` },
        ],
        isError: true,
      };
    }
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
