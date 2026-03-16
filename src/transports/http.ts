/**
 * HTTP transport using Hono and WebStandardStreamableHTTPServerTransport
 *
 * Based on the MCP SDK's Hono example.
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, getResourceLoader } from "../server.js";

export interface HttpAppOptions {
  serverKey?: string;
}

/**
 * Creates the Hono app with MCP endpoints.
 * Exported for testing.
 */
export function createHttpApp(options: HttpAppOptions = {}): Hono {
  const { serverKey } = options;

  const app = new Hono();

  // CORS for MCP headers
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    })
  );

  // Health check (always unauthenticated)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Bearer token auth when MCP_SERVER_KEY is set
  if (serverKey) {
    const keyBuffer = Buffer.from(serverKey);
    app.use("*", async (c, next) => {
      const auth = c.req.header("Authorization") ?? "";
      const match = auth.match(/^Bearer\s+(.+)$/i);
      const token = match?.[1];
      const tokenBuffer = token ? Buffer.from(token) : Buffer.alloc(0);
      if (
        token &&
        tokenBuffer.length === keyBuffer.length &&
        timingSafeEqual(tokenBuffer, keyBuffer)
      ) {
        return next();
      }
      return c.text("Unauthorized", 401, { "WWW-Authenticate": "Bearer" });
    });
  }

  // MCP endpoint - creates a fresh transport and server per request (stateless mode)
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}

/**
 * Starts the HTTP server with Hono.
 */
export async function startHttpServer(): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);

  // Create Hono app (transport + server are created per-request in stateless mode)
  const serverKey = process.env.MCP_SERVER_KEY;
  const app = createHttpApp({ serverKey });

  // Log startup info
  const resourceLoader = getResourceLoader();
  console.log(`UK Legislation MCP Server (HTTP mode)`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  console.log(`Authentication: ${serverKey ? "enabled (MCP_SERVER_KEY)" : "disabled"}`);
  console.log("Resources loaded:");
  for (const resource of resourceLoader.listResources()) {
    console.log(`  - ${resource.uri}`);
  }

  // Start server
  serve({ fetch: app.fetch, port });
}
