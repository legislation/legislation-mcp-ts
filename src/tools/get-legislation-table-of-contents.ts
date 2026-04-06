/**
 * Tool: get_legislation_table_of_contents
 *
 * Retrieve the table of contents for a piece of UK legislation
 */

import { LegislationClient, LegislationLanguage, LegislationResponse } from "../api/legislation-client.js";
import { TocParser } from "../parsers/toc-parser.js";

export const name = "get_legislation_table_of_contents";

export const description = `Retrieve the table of contents for a UK legislation document. Returns structured JSON by default (\`json\`). Also available: \`xml\`, \`akn\`, \`html\`.

Shows the hierarchical structure (Parts, Chapters, Sections) with headings and fragment IDs for use with get_legislation_fragment.

\`type\`, \`year\`, and \`number\` must be exact. If you're not certain, use search_legislation to confirm — identifiers guessed from general knowledge are often wrong.

Version: use a date (\`YYYY-MM-DD\`) for a point-in-time snapshot, or \`enacted\`/\`made\`/\`created\`/\`adopted\` for the original version.

See: \`types://guide\`, \`cookbook://point-in-time-version\`, \`json://table-of-contents-response\``;

export const inputSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "Type of legislation (e.g., ukpga, uksi, asp, ukla)",
    },
    year: {
      type: "string",
      description: "Year of enactment. A 4-digit calendar year (e.g., 2020) works for all legislation. For pre-1963 Acts, the canonical identifier uses a regnal year in Reign/Number format (e.g., Vict/63, Geo5/26).",
    },
    number: {
      type: "string",
      description: "Legislation number (e.g., 18, 1234)",
    },
    format: {
      type: "string",
      enum: ["json", "xml", "akn", "html"],
      description: "Response format (default: json for structured data, xml for CLML Contents, akn for Akoma Ntoso, html for rendered version)",
    },
    version: {
      type: "string",
      description: "Optional: Version to retrieve. Use enacted/made/created/adopted for original version, or YYYY-MM-DD for legislation as it stood on that date.",
    },
    language: {
      type: "string",
      enum: ["english", "welsh"],
      description: "Optional: Set to \"welsh\" to retrieve the Welsh-language table of contents for bilingual legislation (e.g. asc, anaw types). Defaults to \"english\". Non-bilingual legislation ignores this parameter.",
    },
  },
  required: ["type", "year", "number"],
};

export async function execute(
  args: {
    type: string;
    year: string;
    number: string;
    format?: "json" | "xml" | "akn" | "html";
    version?: string;
    language?: LegislationLanguage;
  },
  client: LegislationClient
): Promise<any> {
  const { type, year, number, format = "json", version, language } = args;

  try {
    // For non-JSON formats, fetch directly in that format
    const apiFormat = format === "json" ? "xml" : format;
    const result = await client.getTableOfContents(type, year, number, {
      format: apiFormat,
      version,
      language,
    });

    if (result.kind === "disambiguation") {
      return formatDisambiguation(result);
    }

    // If JSON format requested, parse the XML to structured JSON
    let content: string;
    if (format === "json") {
      const toc = new TocParser().parse(result.content);
      if (version) {
        toc.meta.versions = undefined;
        toc.meta.unappliedEffects = undefined;
        toc.meta.upToDate = undefined;
      }
      content = JSON.stringify(toc, null, 2);
    } else {
      content = result.content;
    }

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving table of contents: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}

function formatDisambiguation(result: Extract<LegislationResponse, { kind: "disambiguation" }>) {
  const list = result.alternatives
    .map(a => `- ${a.title} → use year="${a.year}", number="${a.number}"`)
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text: `Ambiguous request: the calendar year matched multiple regnal years. Retry with a specific regnal year:\n${list}`,
        annotations: { audience: ["assistant" as const], priority: 1 },
      },
    ],
  };
}
