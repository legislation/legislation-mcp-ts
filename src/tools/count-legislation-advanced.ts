/**
 * Tool: count_legislation_advanced
 *
 * Count legislation documents or features using the Research API.
 */

import {
  ResearchClient,
  ResearchCountResponse,
} from "../api/research-client.js";

export const name = "count_legislation_advanced";

export const description = `Count legislation documents or document features (paragraphs, schedules, footnotes, etc.) using the advanced query syntax. Supports grouping by department, subject, year, and other fields.

Pass a \`query\` string in the query syntax. Returns aggregate counts, optionally grouped. Use \`count()\` in the query to specify what to count, and \`groupby=\` to group results.

Example: \`type=uksi && year>=2020 && count(schedules) && groupby=year\`

Query syntax reference: \`advanced://query-syntax\`

See also: \`json://advanced-search-response\``;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Query in the advanced search syntax (see advanced://query-syntax)",
    },
  },
  required: ["query"],
};

export async function execute(
  args: { query: string },
  client: ResearchClient
) {
  try {
    const response: ResearchCountResponse = await client.count(args.query);

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
