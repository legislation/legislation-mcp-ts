import { afterEach, test } from "node:test";
import assert from "node:assert";
import { LegislationClient } from "../../api/legislation-client.js";

const originalFetch = globalThis.fetch;

function installFetchSpy() {
  let requestedUrl: string | undefined;

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new Response("<Legislation />", {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }) as typeof fetch;

  return () => requestedUrl;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
