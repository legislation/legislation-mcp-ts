/**
 * Tool: search_legislation
 *
 * Search for UK legislation by keyword, title, or other criteria
 */

import { LegislationClient } from "../api/legislation-client.js";
import { AtomParser } from "../parsers/atom-parser.js";

export const name = "search_legislation";

export const description = `Search for UK legislation by keyword, title, or other criteria on legislation.gov.uk. Returns JSON by default (set \`format="xml"\` for raw Atom feed).

Results include: \`id\`, \`type\`, \`year\`, \`number\`, \`title\`, and \`date\`. Use \`q\` for full-text keyword search, \`title\` for title search. Filter by \`type\`, \`year\`, \`startYear\`/\`endYear\` range, \`subject\`, \`department\`, \`extent\`, or \`language\`. Use \`sort\` to order results. Returns 20 results per page — use \`page\` to paginate; check \`meta.morePages\` in the response.

\`subject\` only applies to SI-family types (uksi, ssi, wsi, nisr, etc.); Acts don't carry subject metadata. If \`subject\` is set without a \`type\`, \`secondary\` is used by default.

For full-text search with snippets, proximity queries, element-scoped matching (e.g. search within titles, chapters, paragraphs), or counting matches, use \`search_legislation_advanced\`.

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
      type: "array",
      items: { type: "string" },
      description: "Filter by legislation type. Each value is either a short type code (e.g. `ukpga`, `uksi`, `asp`; see `types://guide` for the full list) or an aggregation: `all`, `primary` (all Acts), `secondary` (all SIs), `eu-origin` (EU-retained), or `uk`/`wales`/`scotland`/`ni` (jurisdiction-level groupings). Pass multiple values to match any of them. `[\"primary\", \"secondary\"]` is usually the most useful filter — it returns all Acts and SIs and excludes EU-retained legislation, which otherwise dominates results. Other examples: `[\"uksi\", \"ssi\"]` for UK and Scottish SIs only.",
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
    subject: {
      type: "string",
      description: "Filter by subject heading (e.g. 'banking', 'housing', 'africa'). Only applies to SI-family types; sets `type` to `secondary` by default.",
    },
    department: {
      type: "string",
      description: "Filter by government department responsible for the legislation",
    },
    sort: {
      type: "string",
      enum: ["relevance", "published", "title", "type", "subject", "basic"],
      description: `Sort order for results. Options:
- \`relevance\` — by match score; only meaningful with \`q\`, \`title\`, or \`subject\`.
- \`published\` — publication date, newest first.
- \`title\` — alphabetical.
- \`type\` — grouped by legislation type.
- \`subject\` — alphabetical by subject heading; only meaningful with \`subject\`.
- \`basic\` — the site's fallback ordering. Category-grouped alphabetically, then year descending, then number descending. EU content (category \`euretained\`) sorts ahead of \`primary\` and \`secondary\`. Use with \`q\` to bypass relevance ranking.

If omitted: \`relevance\` when \`q\` is set; \`subject\` when \`subject\` is set without \`q\`; otherwise \`basic\`.`,
    },
    extent: {
      type: "array",
      items: {
        type: "string",
        enum: ["E", "W", "S", "NI"],
      },
      description: "Filter by geographic extent: E (England), W (Wales), S (Scotland), NI (Northern Ireland). Multiple values match legislation that extends to all of those jurisdictions (unless `exactExtent` is true).",
    },
    exactExtent: {
      type: "boolean",
      description: "If true, only return legislation whose extent is exactly the specified set and nothing else (default: false)",
    },
    language: {
      type: "string",
      enum: ["english", "welsh"],
      description: "Filter by language: english (the default) or welsh",
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

// Types that carry subject metadata (from page-flow.xml SI-family route regex).
// `secondary` is the aggregate over all SI types.
const SI_FAMILY_TYPES = new Set([
  "secondary",
  "uksi",
  "ukmd",
  "wsi",
  "ssi",
  "nisi",
  "nisro",
  "nisr",
  "draft",
  "ukdsi",
  "wdsi",
  "sdsi",
  "nidsr",
]);

export async function execute(
  args: {
    q?: string;
    title?: string;
    type?: string[];
    year?: string;
    startYear?: string;
    endYear?: string;
    subject?: string;
    department?: string;
    sort?: string;
    extent?: string[];
    exactExtent?: boolean;
    language?: string;
    page?: number;
    format?: "json" | "xml";
  },
  client: LegislationClient
): Promise<any> {
  const { q, format = "json", extent, exactExtent, subject, language, sort, type, ...rest } = args;
  // `basic` is our friendly name for MarkLogic's fallback ordering, which
  // it identifies with the string "year" (misleadingly — it's not year-only
  // sort, just the catch-all default that falls through to `search:basic`).
  const sortValue = sort === "basic" ? "year" : sort;

  if (subject && type && type.length > 0) {
    const invalid = type.filter((t) => !SI_FAMILY_TYPES.has(t));
    if (invalid.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `Error: subject filtering is only valid for SI-family types (${[...SI_FAMILY_TYPES].sort().join(", ")}). Got: ${invalid.join(", ")}. Acts and other primary legislation don't carry subject metadata.`,
          },
        ],
        isError: true,
      };
    }
  }

  if (sort === "relevance" && !q && !args.title && !subject) {
    return {
      content: [
        {
          type: "text",
          text: "Error: sort='relevance' requires at least one of `q`, `title`, or `subject` to rank against. Use sort='published' (newest first), 'title' (alphabetical), or 'basic' (year descending) for unscoped queries.",
        },
      ],
      isError: true,
    };
  }

  let extentValue: string | undefined;
  if (extent && extent.length > 0) {
    const mapped = extent.map((e) => (e === "NI" ? "N.I." : e)).join("+");
    extentValue = exactExtent ? `=${mapped}` : mapped;
  }
  const langCode =
    language === "welsh" ? "cy" : language === "english" ? "en" : undefined;

  const searchParams = {
    ...rest,
    ...(type && type.length > 0 ? { type } : {}),
    ...(subject ? { subject } : {}),
    ...(q ? { text: q } : {}),
    ...(extentValue ? { extent: extentValue } : {}),
    ...(sortValue ? { sort: sortValue } : {}),
    ...(langCode ? { lang: langCode } : {}),
  };

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
