/**
 * MCP Server factory for UK Legislation
 *
 * Creates configured Server instances for use with different transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import tools
import * as getLegislation from "./tools/get-legislation.js";
import * as getLegislationFragment from "./tools/get-legislation-fragment.js";
import * as getLegislationMetadata from "./tools/get-legislation-metadata.js";
import * as getLegislationTableOfContents from "./tools/get-legislation-table-of-contents.js";
import * as searchLegislation from "./tools/search-legislation.js";
import * as searchLegislationSemantic from "./tools/search-legislation-semantic.js";
import * as searchLegislationSectionsSemantic from "./tools/search-legislation-sections-semantic.js";
import * as searchEffects from "./tools/search-effects.js";
import * as searchLegislationAdvanced from "./tools/search-legislation-advanced.js";
import * as countLegislationAdvanced from "./tools/count-legislation-advanced.js";
import * as searchPowersAndDuties from "./tools/search-powers-and-duties.js";
import * as countPowersAndDuties from "./tools/count-powers-and-duties.js";
import * as getPowersAndDuties from "./tools/get-powers-and-duties.js";
import * as getResource from "./tools/get-resource.js";

// Import API clients
import { LegislationClient } from "./api/legislation-client.js";
import { openLexClient } from "./api/lex-client.js";
import { openResearchClient } from "./api/research-client.js";
import { openDutiesPg } from "./api/duties-db-pg.js";

// Import resource loader
import { ResourceLoader } from "./resources/resource-loader.js";

// Shared instances
const apiClient = new LegislationClient();
// Optional backends. Each open*() returns null when its env vars are absent,
// and a null backend keeps its tools out of the advertised list rather than
// registering tools whose only possible outcome is an error on call. They are
// opened once at module load because the HTTP transport calls createServer()
// per request (src/transports/http.ts).
const lexClient = openLexClient();
const researchClient = openResearchClient();
// Powers-and-duties tools are backed by Aurora Serverless v2 Postgres via the
// RDS Data API. SQLite was removed once Postgres was confirmed in production
// (docs/adr/2026-05-29-postgres-migration-plan.md §Phase 5). openDutiesPg()
// returns null when the cluster env vars are absent (e.g. local dev without
// AWS wiring), which disables the duties tools rather than failing startup.
const dutiesDb = openDutiesPg();
// stderr, not stdout: in the default stdio transport, stdout carries the MCP
// JSON-RPC frames. This runs at module load, before the transport connects.
console.error(
  `[init] Semantic search backend: ${
    lexClient ? process.env.SEMANTIC_API_BASE_URL : "disabled (needs SEMANTIC_API_BASE_URL)"
  }`
);
console.error(
  `[init] Research API backend: ${
    researchClient
      ? process.env.RESEARCH_API_BASE_URL ?? "https://research.legislation.gov.uk"
      : "disabled (needs RESEARCH_API_USERNAME + RESEARCH_API_PASSWORD)"
  }`
);
console.error(
  `[init] Duties backend: ${
    dutiesDb
      ? "pg (Aurora Data API)"
      : "disabled (needs DUTIES_DB_CLUSTER_ARN + DUTIES_DB_SECRET_ARN)"
  }`
);
const resourceLoader = new ResourceLoader();

// Dispatch-time messages for the optional backends. A client working from a
// cached tool list can still call a tool that is no longer advertised, so the
// guards below name the missing configuration rather than failing obscurely.
const SEMANTIC_DISABLED =
  "Semantic search is not configured on this server (SEMANTIC_API_BASE_URL is unset), " +
  "so search_legislation_semantic and search_legislation_sections_semantic are unavailable. " +
  "Use search_legislation for keyword search instead.";
const RESEARCH_DISABLED =
  "The Research API is not configured on this server — RESEARCH_API_USERNAME and " +
  "RESEARCH_API_PASSWORD must both be set, and one or both are missing. " +
  "search_legislation_advanced and count_legislation_advanced are unavailable; " +
  "use search_legislation instead.";
const DUTIES_DISABLED =
  "The powers-and-duties dataset is not configured on this server — " +
  "DUTIES_DB_CLUSTER_ARN and DUTIES_DB_SECRET_ARN must both be set, and one or " +
  "both are missing. search_powers_and_duties, count_powers_and_duties and " +
  "get_powers_and_duties are unavailable.";

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * The tools this server advertises, given the backends configured at module
 * load.
 *
 * Tools whose backend is absent are omitted rather than registered: an
 * advertised-but-unusable tool costs context in every client that connects and
 * can be selected in error, so absence is the honest signal. Setting the
 * backend's env vars and restarting brings its tools back.
 */
function buildToolList() {
  return [
    {
      name: searchLegislation.name,
      // The advanced-search recommendation is appended only when the Research
      // API is configured, so an install without it is never pointed at a tool
      // missing from its own tool list.
      description: researchClient
        ? `${searchLegislation.description}\n\n${searchLegislation.researchRecommendation}`
        : searchLegislation.description,
      inputSchema: searchLegislation.inputSchema,
      annotations: toolAnnotations,
    },
    {
      name: getLegislationMetadata.name,
      description: getLegislationMetadata.description,
      inputSchema: getLegislationMetadata.inputSchema,
      annotations: toolAnnotations,
    },
    {
      name: getLegislation.name,
      description: getLegislation.description,
      inputSchema: getLegislation.inputSchema,
      annotations: toolAnnotations,
    },
    {
      name: getLegislationFragment.name,
      description: getLegislationFragment.description,
      inputSchema: getLegislationFragment.inputSchema,
      annotations: toolAnnotations,
    },
    {
      name: getLegislationTableOfContents.name,
      description: getLegislationTableOfContents.description,
      inputSchema: getLegislationTableOfContents.inputSchema,
      annotations: toolAnnotations,
    },
    ...(lexClient
      ? [
          {
            name: searchLegislationSemantic.name,
            description: searchLegislationSemantic.description,
            inputSchema: searchLegislationSemantic.inputSchema,
            annotations: toolAnnotations,
          },
          {
            name: searchLegislationSectionsSemantic.name,
            description: searchLegislationSectionsSemantic.description,
            inputSchema: searchLegislationSectionsSemantic.inputSchema,
            annotations: toolAnnotations,
          },
        ]
      : []),
    {
      name: searchEffects.name,
      description: searchEffects.description,
      inputSchema: searchEffects.inputSchema,
      outputSchema: searchEffects.outputSchema,
      annotations: toolAnnotations,
    },
    ...(researchClient
      ? [
          {
            name: searchLegislationAdvanced.name,
            description: searchLegislationAdvanced.description,
            inputSchema: searchLegislationAdvanced.inputSchema,
            annotations: toolAnnotations,
          },
          {
            name: countLegislationAdvanced.name,
            description: countLegislationAdvanced.description,
            inputSchema: countLegislationAdvanced.inputSchema,
            annotations: toolAnnotations,
          },
        ]
      : []),
    ...(dutiesDb
      ? [
          {
            name: searchPowersAndDuties.name,
            description: searchPowersAndDuties.description,
            inputSchema: searchPowersAndDuties.inputSchema,
            annotations: toolAnnotations,
          },
          {
            name: countPowersAndDuties.name,
            description: countPowersAndDuties.description,
            inputSchema: countPowersAndDuties.inputSchema,
            annotations: toolAnnotations,
          },
          {
            name: getPowersAndDuties.name,
            description: getPowersAndDuties.description,
            inputSchema: getPowersAndDuties.inputSchema,
            annotations: toolAnnotations,
          },
        ]
      : []),
    {
      name: getResource.name,
      description: getResource.description,
      inputSchema: getResource.inputSchema,
      annotations: toolAnnotations,
    },
  ];
}

/** Names of the advertised tools, in list order — used for startup logging. */
export function getToolNames(): string[] {
  return buildToolList().map((tool) => tool.name);
}

/**
 * Creates a configured MCP server instance.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "legislation-gov-uk",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Handler: List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: buildToolList() };
  });

  // Handler: Execute a tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    // MCP `arguments` is optional: normalise an omitted value to {} at the
    // dispatch boundary so all-optional tools accept no-argument calls. A
    // genuinely malformed non-object still flows through to each tool's own
    // validation, which rejects it.
    const args = rawArgs ?? {};

    try {
      switch (name) {
        case searchLegislation.name:
          return await searchLegislation.execute(args as any, apiClient);

        case getLegislation.name:
          return await getLegislation.execute(args as any, apiClient);

        case getLegislationFragment.name:
          return await getLegislationFragment.execute(args as any, apiClient);

        case getLegislationMetadata.name:
          return await getLegislationMetadata.execute(args as any, apiClient);

        case getLegislationTableOfContents.name:
          return await getLegislationTableOfContents.execute(args as any, apiClient);

        case searchLegislationSemantic.name:
          if (!lexClient) throw new Error(SEMANTIC_DISABLED);
          return await searchLegislationSemantic.execute(args as any, lexClient);

        case searchLegislationSectionsSemantic.name:
          if (!lexClient) throw new Error(SEMANTIC_DISABLED);
          return await searchLegislationSectionsSemantic.execute(args as any, lexClient);

        case searchEffects.name:
          return await searchEffects.execute(args as any, apiClient);

        case searchLegislationAdvanced.name:
          if (!researchClient) throw new Error(RESEARCH_DISABLED);
          return await searchLegislationAdvanced.execute(
            args as any,
            researchClient
          );

        case countLegislationAdvanced.name:
          if (!researchClient) throw new Error(RESEARCH_DISABLED);
          return await countLegislationAdvanced.execute(
            args as any,
            researchClient
          );

        case searchPowersAndDuties.name:
          if (!dutiesDb) throw new Error(DUTIES_DISABLED);
          return await searchPowersAndDuties.execute(args as any, dutiesDb);

        case countPowersAndDuties.name:
          if (!dutiesDb) throw new Error(DUTIES_DISABLED);
          return await countPowersAndDuties.execute(args as any, dutiesDb);

        case getPowersAndDuties.name:
          if (!dutiesDb) throw new Error(DUTIES_DISABLED);
          return await getPowersAndDuties.execute(args as any, dutiesDb);

        case getResource.name:
          return await getResource.execute(args as any, resourceLoader);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tool: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  });

  // Handler: List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceLoader.listResources(),
    };
  });

  // Handler: Read a resource
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      const resource = resourceLoader.readResource(uri);
      return {
        contents: [resource],
      };
    } catch (error) {
      throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

/**
 * Returns the resource loader for logging purposes.
 */
export function getResourceLoader(): ResourceLoader {
  return resourceLoader;
}
