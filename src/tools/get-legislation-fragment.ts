/**
 * Tool: get_legislation_fragment
 *
 * Retrieve a specific fragment (portion) of a UK legislation document
 */

import { LegislationClient, LegislationLanguage, LegislationResponse } from "../api/legislation-client.js";
import { parse } from "../parsers/clml-text-parser.js";
import { serializeDocument } from "../parsers/clml-text-serializer.js";
import { getUpToDateCallout } from "./up-to-date-callout.js";

export const name = "get_legislation_fragment";

export const description = `Retrieve a fragment (section, part, chapter, etc.) of a UK legislation document. Returns readable plain text by default (\`text\`). Also available: \`xml\` (CLML with full metadata), \`akn\` (Akoma Ntoso), \`html\`.

Text is best for reading and summarisation. It discards semantic markup, amendment commentaries, and structural metadata — use \`xml\` to track amendments, follow cross-references, or check in-force status.

\`type\`, \`year\`, and \`number\` must be exact — use search_legislation to confirm if unsure. Use get_legislation_table_of_contents to discover fragment IDs. Common fragmentId patterns: \`section/1\`, \`part/2\`, \`part/1/chapter/3\`, \`regulation/5\`, \`crossheading/name\`. The API does not support fragment IDs deeper than the section or regulation level (e.g. \`section/1/a\` is not a valid ID).

Version: use a date (\`YYYY-MM-DD\`) for a point-in-time snapshot, or \`enacted\`/\`made\`/\`created\`/\`adopted\` for the original version. Do not pass \`version="prospective"\`; when metadata lists \`"prospective"\`, that is the latest fragment version and should be fetched by omitting the \`version\` parameter.

See: \`types://guide\`, \`cookbook://point-in-time-version\``;

export const inputSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "Type of legislation (e.g., ukpga, uksi, asp, ukla)",
    },
    year: {
      type: "string",
      description: "Year of enactment. A 4-digit calendar year (e.g., 2020) works for all legislation. For pre-1963 Acts, the canonical identifier uses a regnal year in Reign/Number format (e.g., Vict/63, Geo5/26) — but a calendar year will usually work too, as the API redirects. Use regnal years when you need to disambiguate (a calendar year can span two regnal years). See the years://regnal resource for valid identifiers.",
    },
    number: {
      type: "string",
      description: "Legislation number (e.g., 18, 1234)",
    },
    fragmentId: {
      type: "string",
      description: "Fragment identifier path (e.g., section/5, part/1/chapter/2, regulation/10)",
    },
    format: {
      type: "string",
      enum: ["xml", "text", "akn", "html"],
      description: "Response format (default: text for readable plain text, xml for CLML, akn for Akoma Ntoso, html for rendered version)",
    },
    version: {
      type: "string",
      description: "Optional: Version to retrieve. Use enacted/made/created/adopted for original version, or YYYY-MM-DD for legislation as it stood on that date. Do not use prospective here; omit version to fetch current prospective content. Dates before first version return an error.",
    },
    language: {
      type: "string",
      enum: ["english", "welsh"],
      description: "Optional: Set to \"welsh\" to retrieve the Welsh-language text for bilingual legislation (e.g. asc, anaw types). Defaults to \"english\". Non-bilingual legislation ignores this parameter.",
    },
  },
  required: ["type", "year", "number", "fragmentId"],
};

export async function execute(
  args: {
    type: string;
    year: string;
    number: string;
    fragmentId: string;
    format?: "xml" | "text" | "akn" | "html";
    version?: string;
    language?: LegislationLanguage;
  },
  client: LegislationClient
): Promise<any> {
  const { type, year, number, fragmentId, format = "text", version, language } = args;

  try {
    const apiFormat = format === "text" ? "xml" : format;
    const result = await client.getFragment(type, year, number, fragmentId, {
      format: apiFormat,
      version,
      language,
    });

    if (result.kind === "disambiguation") {
      return formatDisambiguation(result);
    }

    const content = format === "text"
      ? serializeDocument(parse(result.content))
      : result.content;

    const contentBlocks: { type: "text"; text: string }[] = [];

    if (format === "text") {
      const callout = await getUpToDateCallout(result.content, version, client, fragmentId);
      if (callout) contentBlocks.push(callout);
    }

    contentBlocks.push({ type: "text", text: content });

    return { content: contentBlocks };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error retrieving legislation fragment: ${error.message}`,
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
