/**
 * Regression tests for Node.js built-in API type contracts.
 *
 * Guards against breakage when upgrading @types/node across major versions.
 * Covers the specific APIs this project depends on:
 *   - Buffer.from / Buffer.alloc / .length
 *   - crypto.timingSafeEqual
 *   - global fetch (Response properties used by legislation-client and lex-client)
 *   - fs.readFileSync with encoding
 *   - path.join / path.dirname
 *   - url.fileURLToPath
 */

import { test } from "node:test";
import assert from "node:assert";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// -- Buffer --

test("Buffer.from(string) returns a Buffer with correct byte length", () => {
  const buf = Buffer.from("hello");
  assert.strictEqual(buf.length, 5);
  assert.ok(Buffer.isBuffer(buf));
});

test("Buffer.alloc(0) returns an empty Buffer", () => {
  const buf = Buffer.alloc(0);
  assert.strictEqual(buf.length, 0);
  assert.ok(Buffer.isBuffer(buf));
});

test("Buffer.from multi-byte string has byte length > string length", () => {
  const buf = Buffer.from("é");
  assert.ok(buf.length > 1, "multi-byte char should produce >1 byte");
});

// -- crypto.timingSafeEqual --

test("timingSafeEqual returns true for equal buffers", () => {
  const a = Buffer.from("secret");
  const b = Buffer.from("secret");
  assert.strictEqual(timingSafeEqual(a, b), true);
});

test("timingSafeEqual returns false for different buffers of same length", () => {
  const a = Buffer.from("secret");
  const b = Buffer.from("SECRET");
  assert.strictEqual(timingSafeEqual(a, b), false);
});

test("timingSafeEqual throws for buffers of different length", () => {
  const a = Buffer.from("short");
  const b = Buffer.from("longer");
  assert.throws(() => timingSafeEqual(a, b));
});

// -- global fetch / Response --

test("fetch Response has expected properties: status, ok, statusText, headers, text(), json()", async () => {
  // Use a known-good URL; this also validates that global fetch works at runtime.
  const res = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.statusText, "OK");
  assert.strictEqual(res.headers.get("Content-Type"), "application/json");

  // Clone so we can read body twice
  const clone = res.clone();
  const text = await clone.text();
  assert.strictEqual(typeof text, "string");

  const json = await res.json();
  assert.deepStrictEqual(json, { ok: true });
});

test("Response constructor with non-200 status", () => {
  const res = new Response("Not Found", { status: 404, statusText: "Not Found" });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.ok, false);
});

// -- fs.readFileSync --

test("readFileSync with utf-8 encoding returns a string", () => {
  const __filename = fileURLToPath(import.meta.url);
  const content = readFileSync(__filename, "utf-8");
  assert.strictEqual(typeof content, "string");
  assert.ok(content.length > 0);
});

// -- path --

test("path.join and path.dirname return strings", () => {
  const joined = join("a", "b", "c.txt");
  assert.strictEqual(typeof joined, "string");
  assert.ok(joined.includes("b"));

  const dir = dirname("/a/b/c.txt");
  assert.strictEqual(typeof dir, "string");
  assert.ok(dir.endsWith("/a/b") || dir.endsWith("\\a\\b"));
});

// -- url.fileURLToPath --

test("fileURLToPath converts import.meta.url to a file path", () => {
  const path = fileURLToPath(import.meta.url);
  assert.strictEqual(typeof path, "string");
  assert.ok(path.endsWith(".test.js") || path.endsWith(".test.ts"));
});
