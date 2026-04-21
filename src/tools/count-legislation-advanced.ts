/**
 * Tool: count_legislation_advanced
 *
 * Count legislation documents or features using the Research API.
 */

import {
  ResearchClient,
  ResearchCountResponse,
  ResearchNonJsonResponseError,
} from "../api/research-client.js";

export const name = "count_legislation_advanced";

export const description = `Count legislation documents or document features using the advanced query syntax. Example query: \`type=uksi && year>=2020 && count(schedules) && groupby=year\` (how many schedules SIs have, grouped by year, from 2020 onwards).

Returns aggregate counts, optionally grouped. Use \`count(...)\` in the query to specify what to count (paragraphs, schedules, footnotes, etc.); without it, the count is of matching documents. Use \`groupby=\` to group results by department, subject, year, or other fields.

Full query syntax reference: \`advanced://query-syntax\` (read this before composing anything beyond trivial queries).

See also: \`json://advanced-search-response\``;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Query in the advanced search syntax. Key rules: (1) do NOT wrap phrases in quotes — space-separated words inside `()` or `[]` already form an exact phrase; (2) `,` is low-precedence AND — `title(little, pink dress)` means titles containing `little` AND the phrase `pink dress`; (3) the nine metacharacters `, ( ) [ ] ! < > =` must be backslash-escaped to appear literally in a term. Full grammar: advanced://query-syntax",
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

export async function execute(
  args: {
    query: string;
    case?: boolean;
    stem?: boolean;
    punctuation?: boolean;
  },
  client: ResearchClient
) {
  try {
    const response: ResearchCountResponse = await client.count(args.query, {
      case: args.case,
      stem: args.stem,
      punctuation: args.punctuation,
    });

    const shaped = {
      meta: {
        query: response.q,
        case: response.case,
        stem: response.stem,
        amendments: response.amendments,
      },
      counts: response.counts,
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
            text: `Error counting legislation (advanced): ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
