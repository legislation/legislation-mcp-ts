import { afterEach, test } from "node:test";
import assert from "node:assert";
import { LegislationClient } from "../../api/legislation-client.js";
import { installFetchSpy, restoreFetch } from "../helpers/fetch-spy.js";

afterEach(restoreFetch);

test("getDocumentMetadata uses /resources/welsh/data.xml for unversioned Welsh metadata", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  const result = await client.getDocumentMetadata("asc", "2026", "2", {
    language: "welsh",
  });

  assert.deepStrictEqual(result, {
    kind: "document",
    content: "<Legislation />",
  });
  assert.strictEqual(
    getRequestedUrl(),
    "https://www.legislation.gov.uk/asc/2026/2/resources/welsh/data.xml",
  );
});

test("getDocumentMetadata uses /resources/data.xml for unversioned English metadata", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.getDocumentMetadata("asc", "2026", "2");

  assert.strictEqual(
    getRequestedUrl(),
    "https://www.legislation.gov.uk/asc/2026/2/resources/data.xml",
  );
});

test("search with subject and type uses /{type}/{subject}/data.feed path", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ subject: "banking", type: ["uksi"] });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.pathname, "/uksi/banking/data.feed");
  assert.strictEqual(url.searchParams.get("subject"), null);
  assert.strictEqual(url.searchParams.get("type"), null);
});

test("search with subject but no type defaults type to 'secondary' in the path", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ subject: "banking" });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.pathname, "/secondary/banking/data.feed");
});

test("search with subject path mode keeps pagination in the query string", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ subject: "banking", type: ["secondary"], page: 2 });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.pathname, "/secondary/banking/data.feed");
  assert.strictEqual(url.searchParams.get("page"), "2");
});

test("search without subject uses /search/data.feed with type as a query param", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ type: ["ukpga"], title: "pension" });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.pathname, "/search/data.feed");
  assert.strictEqual(url.searchParams.get("type"), "ukpga");
  assert.strictEqual(url.searchParams.get("title"), "pension");
});

test("search with extent 'E+W' encodes the plus as %2B", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ extent: "E+W" });

  const url = getRequestedUrl()!;
  assert.ok(url.includes("extent=E%2BW"), `expected encoded +, got ${url}`);
});

test("search with extent '=E+W' encodes both = and +", async () => {
  const getRequestedUrl = installFetchSpy();
  const client = new LegislationClient();

  await client.search({ extent: "=E+W" });

  const url = getRequestedUrl()!;
  assert.ok(
    url.includes("extent=%3DE%2BW"),
    `expected encoded = and +, got ${url}`,
  );
});
