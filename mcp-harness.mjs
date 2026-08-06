// Minimal CLI client: drives the MCP server over HTTP the way a real client
// (Claude Code) does. Useful for checking a deployment end-to-end — notably
// `--list`, which shows whether the conditionally-registered powers-and-duties
// tools were picked up. Usage:
//   node mcp-harness.mjs --list
//   node mcp-harness.mjs <tool_name> '<json-args>'
// Set MCP_URL to target a different endpoint (default http://localhost:3000/mcp).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL || "http://localhost:3000/mcp");
const mode = process.argv[2];

const client = new Client(
  { name: "duties-test-harness", version: "0.0.0" },
  { capabilities: {} },
);
const transport = new StreamableHTTPClientTransport(url);
await client.connect(transport);

try {
  if (mode === "--list") {
    const { tools } = await client.listTools();
    console.log(tools.map((t) => t.name).join("\n"));
  } else {
    const name = mode;
    const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    const res = await client.callTool({ name, arguments: args });
    for (const c of res.content ?? []) {
      if (c.type === "text") console.log(c.text);
    }
    if (res.isError) {
      console.error("[isError=true]");
      process.exitCode = 2;
    }
  }
} finally {
  await client.close();
}
