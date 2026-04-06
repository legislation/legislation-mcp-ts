/**
 * Tests for HTTP transport
 */

import { test } from "node:test";
import assert from "node:assert";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createHttpApp, type HttpAppOptions } from "../../transports/http.js";

async function startHttpTestServer(options: HttpAppOptions = {}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createHttpApp(options);

  return new Promise((resolve, reject) => {
    let settled = false;

    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      settled = true;
      server.off("error", onError);
      resolve({
        baseUrl: `http://127.0.0.1:${(info as AddressInfo).port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });

    const onError = (error: Error) => {
      if (!settled) {
        reject(error);
      }
    };

    server.once("error", onError);
  });
}

test("health check returns ok", async () => {
  const app = createHttpApp();
  const res = await app.request("/health");

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { status: "ok" });
});

test("MCP endpoint is accessible without authentication when no key set", async () => {
  const app = createHttpApp();
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  // Key assertion: no auth rejection, endpoint is open
  assert.strictEqual(res.status, 200);
});

test("MCP endpoint handles repeated requests with a fresh stateless transport", async () => {
  const app = createHttpApp();

  const first = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  const second = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
  });

  assert.strictEqual(first.status, 200);
  assert.strictEqual(second.status, 200);
});

test("returns 401 when server key is set and no token provided", async () => {
  const app = createHttpApp({ serverKey: "test-secret" });
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.headers.get("WWW-Authenticate"), "Bearer");
});

test("returns 401 when server key is set and wrong token provided", async () => {
  const app = createHttpApp({ serverKey: "test-secret" });
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer wrong-key",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  assert.strictEqual(res.status, 401);
});

test("returns 401 (not 500) when token and key have same string length but different byte length", async () => {
  // "é".length === "a".length (1), but Buffer.byteLength("é") !== Buffer.byteLength("a").
  // Old code guarding on string length could call timingSafeEqual with mismatched buffers and throw (500).
  const app = createHttpApp({ serverKey: "é" });
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer a",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  assert.strictEqual(res.status, 401);
});

test("returns 401 (not 500) when key is ASCII but token is non-ASCII with same string length", async () => {
  const app = createHttpApp({ serverKey: "a" });
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer é",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  assert.strictEqual(res.status, 401);
});

test("allows access when correct bearer token is provided", async () => {
  const app = createHttpApp({ serverKey: "test-secret" });
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  // Crucially not 401 — auth passed, request reaches MCP handler
  assert.strictEqual(res.status, 200);
});

test("accepts case-insensitive Bearer scheme", async () => {
  const app = createHttpApp({ serverKey: "test-secret" });

  for (const scheme of ["bearer", "BEARER", "Bearer"]) {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `${scheme} test-secret`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });

    assert.strictEqual(res.status, 200, `scheme "${scheme}" should be accepted`);
  }
});

test("CORS preflight returns expected headers", async () => {
  const app = createHttpApp();
  const res = await app.request("/mcp", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, Authorization, mcp-session-id",
    },
  });

  assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(
    res.headers.get("Access-Control-Allow-Headers")?.includes("Authorization"),
    "should allow Authorization header"
  );
  assert.ok(
    res.headers.get("Access-Control-Allow-Headers")?.includes("mcp-session-id"),
    "should allow mcp-session-id header"
  );
});

test("health check is accessible even when server key is set", async () => {
  const app = createHttpApp({ serverKey: "test-secret" });
  const res = await app.request("/health");

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body, { status: "ok" });
});

test("node-server serves the health check over a real HTTP listener", async (t) => {
  const server = await startHttpTestServer();
  t.after(async () => {
    await server.close();
  });

  const res = await fetch(`${server.baseUrl}/health`);

  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  const body = await res.json();
  assert.deepStrictEqual(body, { status: "ok" });
});

test("node-server enforces auth and returns the MCP SSE response over HTTP", async (t) => {
  const server = await startHttpTestServer({ serverKey: "test-secret" });
  t.after(async () => {
    await server.close();
  });

  const unauthorized = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
  });

  assert.strictEqual(unauthorized.status, 401);
  assert.strictEqual(unauthorized.headers.get("www-authenticate"), "Bearer");

  const authorized = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer test-secret",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

  assert.strictEqual(authorized.status, 200);
  assert.match(authorized.headers.get("content-type") ?? "", /^text\/event-stream/);
  const body = await authorized.text();
  assert.match(body, /event: message/);
  assert.match(body, /data: \{"result":\{\},"jsonrpc":"2\.0","id":1\}/);
});

test("node-server returns CORS preflight headers over a real HTTP listener", async (t) => {
  const server = await startHttpTestServer();
  t.after(async () => {
    await server.close();
  });

  const res = await fetch(`${server.baseUrl}/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, Authorization, mcp-session-id",
    },
  });

  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(
    res.headers.get("access-control-allow-headers")?.includes("Authorization"),
    "should allow Authorization header"
  );
  assert.ok(
    res.headers.get("access-control-allow-headers")?.includes("mcp-session-id"),
    "should allow mcp-session-id header"
  );
});
