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

// Load .env before anything else: server.js reads the duties cluster ARNs at
// module-load, so the file must populate process.env first.
// No-op in production — App Runner injects env vars and ships no .env file.
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, getResourceLoader, getToolNames } from "./server.js";
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
  // Listed from the server's own tool list, so the banner reflects which
  // optional backends are configured rather than a hardcoded roster.
  console.error("Tools:");
  for (const tool of getToolNames()) {
    console.error(`  - ${tool}`);
  }
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
