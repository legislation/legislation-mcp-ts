/**
 * Tool: search_legislation
 *
 * Search for UK legislation by keyword, title, or other criteria
 */

import { LegislationClient } from "../api/legislation-client.js";
import { AtomParser } from "../parsers/atom-parser.js";

export const name = "search_legislation";

export const description = `Search for UK legislation by keyword, title, or other criteria on legislation.gov.uk. Returns JSON by default (set \`format="xml"\` for raw Atom feed).

Results include: \`id\`, \`type\`, \`year\`, \`number\`, \`title\`, and \`date\`. Use \`q\` for full-text keyword search, \`title\` for title search. Filter by \`type\`, \`year\`, or \`startYear\`/\`endYear\` range. Returns 20 results per page — use \`page\` to paginate; check \`meta.morePages\` in the response.

See: \`types://guide\`, \`json://search-response\`, \`atom://feed-guide\``;

export const inputSchema = {
  type: "object",
  properties: {
    q: {
      type: "string",
      description: "Full-text keyword search across legislation content",
    },
    title: {
      type: "string",
      description: "Search in legislation titles",
    },
    type: {
      type: "string",
      description: "Filter by legislation type: use `primary` for all Acts or `secondary` for all SIs across all jurisdictions, or a specific type code (e.g. ukpga, uksi, asp)",
    },
    year: {
      type: "string",
      description: "Filter by specific year",
    },
    startYear: {
      type: "string",
      description: "Start of year range (inclusive)",
    },
    endYear: {
      type: "string",
      description: "End of year range (inclusive)",
    },
    page: {
      type: "number",
      description: "Page number (default: 1, 20 results per page)",
    },
    format: {
      type: "string",
      enum: ["json", "xml"],
      description: "Response format (default: json for structured results, xml for raw Atom feed)",
    },
  },
};

export async function execute(
  args: {
    q?: string;
    title?: string;
    type?: string;
    year?: string;
    startYear?: string;
    endYear?: string;
    page?: number;
    format?: "json" | "xml";
  },
  client: LegislationClient
): Promise<any> {
  const { q, format = "json", ...rest } = args;
  const searchParams = { ...rest, ...(q ? { text: q } : {}) };

  try {
    const results = await client.search(searchParams);

    // Return JSON by default, XML if explicitly requested
    if (format === "json") {
      const parser = new AtomParser();
      const parsed = parser.parse(results);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(parsed, null, 2),
          },
        ],
      };
    } else {
      // Return raw XML
      return {
        content: [
          {
            type: "text",
            text: results,
          },
        ],
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching legislation: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
