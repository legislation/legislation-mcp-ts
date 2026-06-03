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
import { LexClient } from "./api/lex-client.js";
import { ResearchClient } from "./api/research-client.js";
import { openDuties } from "./api/duties-db.js";
import { openDutiesPg } from "./api/duties-db-pg.js";

// Import resource loader
import { ResourceLoader } from "./resources/resource-loader.js";

// Shared instances
const apiClient = new LegislationClient();
const lexClient = new LexClient();
const researchClient = new ResearchClient();
// Duties backend selection. 'pg' uses Aurora Serverless v2 via the Data API
// (set by the CDK when the cluster is wired in); anything else falls back to
// the on-instance SQLite database. See
// docs/adr/2026-05-29-postgres-migration-plan.md.
const dutiesBackend = process.env.DUTIES_DB_BACKEND ?? "sqlite";
// stderr, not stdout: in the default stdio transport, stdout carries the MCP
// JSON-RPC frames. This runs at module load, before the transport connects.
console.error(`[init] Duties backend: ${dutiesBackend}`);
const dutiesDb = dutiesBackend === "pg" ? openDutiesPg() : openDuties();
const resourceLoader = new ResourceLoader();

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

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
    return {
      tools: [
        {
          name: searchLegislation.name,
          description: searchLegislation.description,
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
        {
          name: searchEffects.name,
          description: searchEffects.description,
          inputSchema: searchEffects.inputSchema,
          outputSchema: searchEffects.outputSchema,
          annotations: toolAnnotations,
        },
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
      ],
    };
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
          return await searchLegislationSemantic.execute(args as any, lexClient);

        case searchLegislationSectionsSemantic.name:
          return await searchLegislationSectionsSemantic.execute(args as any, lexClient);

        case searchEffects.name:
          return await searchEffects.execute(args as any, apiClient);

        case searchLegislationAdvanced.name:
          return await searchLegislationAdvanced.execute(
            args as any,
            researchClient
          );

        case countLegislationAdvanced.name:
          return await countLegislationAdvanced.execute(
            args as any,
            researchClient
          );

        case searchPowersAndDuties.name:
          if (!dutiesDb) throw new Error("Duties database not available");
          return await searchPowersAndDuties.execute(args as any, dutiesDb);

        case countPowersAndDuties.name:
          if (!dutiesDb) throw new Error("Duties database not available");
          return await countPowersAndDuties.execute(args as any, dutiesDb);

        case getPowersAndDuties.name:
          if (!dutiesDb) throw new Error("Duties database not available");
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
