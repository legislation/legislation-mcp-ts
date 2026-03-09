#!/usr/bin/env node

/**
 * MCP Server for UK Legislation (legislation.gov.uk)
 *
 * Provides tools to search and retrieve UK legislation via the Model Context Protocol.
 *
 * Supports two transport modes:
 * - stdio (default): For local development and Claude Desktop
 * - http: For remote access via HTTP/SSE
 *
 * Set MCP_TRANSPORT=http to enable HTTP mode.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, getResourceLoader } from "./server.js";
import { startHttpServer } from "./transports/http.js";

/**
 * Start server in stdio mode (default)
 */
async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used for MCP communication)
  const resourceLoader = getResourceLoader();
  console.error("UK Legislation MCP Server (stdio mode)");
  console.error("Tools: search_legislation, get_legislation_metadata, get_legislation,");
  console.error("       get_legislation_fragment, get_legislation_table_of_contents,");
  console.error("       search_legislation_semantic, search_legislation_sections_semantic,");
  console.error("       search_effects, get_resource");
  console.error("Resources loaded:");
  for (const resource of resourceLoader.listResources()) {
    console.error(`  - ${resource.uri}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const transport = process.env.MCP_TRANSPORT || "stdio";

  switch (transport) {
    case "stdio":
      await startStdioServer();
      break;
    case "http":
      await startHttpServer();
      break;
    default:
      console.error(`Unknown transport: ${transport}`);
      console.error("Valid options: stdio, http");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
