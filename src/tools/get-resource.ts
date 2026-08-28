/**
 * Tool: get_resource
 *
 * Fetch an MCP resource by URI, for API clients that cannot access resources directly.
 */

import { ResourceLoader } from "../resources/resource-loader.js";

export const name = "get_resource";

export const description = `Fetch a resource by URI. For agents that cannot access MCP resources directly, use this tool to retrieve guides, reference material, and documentation.

Available resources:
- \`guide://getting-started\` — Overview and quick start
- \`guide://troubleshooting\` — Common errors and edge cases
- \`cookbook://index\` — Index of all cookbook recipes
- \`cookbook://check-extent\` — How to check geographical extent
- \`cookbook://point-in-time-version\` — How to retrieve historical versions
- \`cookbook://semantic-search-workflow\` — Semantic search step-by-step (needs the semantic search backend)
- \`types://guide\` — All UK legislation type codes (\`ukpga\`, \`uksi\`, etc.)
- \`types://data\` — Type codes as JSON
- \`years://regnal\` — Regnal year identifiers for pre-1963 legislation
- \`text://format-guide\` — Plain text output format documentation
- \`clml://schema-guide\` — CLML XML structure reference
- \`clml://metadata/extent\` — Geographical extent in CLML
- \`atom://feed-guide\` — Atom feed format for search results
- \`json://search-response\` — search_legislation response format
- \`json://metadata-response\` — get_legislation_metadata response format
- \`json://table-of-contents-response\` — get_legislation_table_of_contents response format
- \`json://semantic-search-response\` — search_legislation_semantic response format
- \`json://semantic-section-response\` — search_legislation_sections_semantic response format`;

export const inputSchema = {
  type: "object",
  properties: {
    uri: {
      type: "string",
      description: "Resource URI (e.g. `guide://getting-started`, `types://guide`)",
    },
  },
  required: ["uri"],
};

export async function execute(
  args: { uri: string },
  resourceLoader: ResourceLoader
): Promise<any> {
  try {
    const resource = resourceLoader.readResource(args.uri);
    return {
      content: [
        {
          type: "text",
          text: resource.text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Resource not found: ${args.uri}. See the tool description for available URIs.`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
