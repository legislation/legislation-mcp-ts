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

/**
 * Regression test for LMSC-40.
 *
 * The `/changes/data.feed` search form answers with a 301 to a canonical
 * path-based URL and drops the query string, so `page` (the one parameter that
 * lives only in the query string) is lost unless we re-attach it to the
 * canonical URL. This spy reproduces that behaviour and models real `fetch`
 * redirect handling: with `redirect: "manual"` the caller sees the 301 (whose
 * Location omits the query string); otherwise the redirect is followed
 * transparently to the canonical URL's 200.
 */
function installChangesRedirectSpy(canonicalPath: string) {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string; redirect: string }[] = [];

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const redirect = init?.redirect ?? "follow";
    calls.push({ url, method, redirect });

    if (new URL(url).pathname === "/changes/data.feed") {
      // Manual: expose the 301, query string stripped. Follow: transparently
      // land on the canonical URL's 200 (as real fetch would).
      if (redirect === "manual") {
        return new Response("", {
          status: 301,
          headers: { location: canonicalPath },
        });
      }
    }

    return new Response("<feed />", {
      status: 200,
      headers: { "Content-Type": "application/atom+xml" },
    });
  }) as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test("searchChanges page 1 fetches the search-form URL directly without a page param", async () => {
  const { calls, restore } = installChangesRedirectSpy(
    "/changes/affected/ukpga/1998/46/data.feed",
  );
  try {
    const client = new LegislationClient();
    await client.searchChanges({
      affectedType: "ukpga",
      affectedYear: "1998",
      affectedNumber: "46",
      page: 1,
    });

    // Page 1: a single redirect-following GET, no page param to preserve.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].redirect, "follow");
    const url = new URL(calls[0].url);
    assert.strictEqual(url.pathname, "/changes/data.feed");
    assert.strictEqual(url.searchParams.get("page"), null);
  } finally {
    restore();
  }
});

test("searchChanges re-attaches page to the canonical URL after the query-dropping redirect", async () => {
  const { calls, restore } = installChangesRedirectSpy(
    "/changes/affected/ukpga/1998/46/data.feed",
  );
  try {
    const client = new LegislationClient();
    await client.searchChanges({
      affectedType: "ukpga",
      affectedYear: "1998",
      affectedNumber: "46",
      affectingType: "ukpga",
      affectingYear: "2024",
      affectingNumber: "10",
      applied: true,
      page: 10,
    });

    // Two hops, both fetched with redirect:"manual" so `page` survives: the
    // search form (which 301s), then the canonical URL with page re-attached.
    assert.strictEqual(calls.length, 2);
    assert.ok(
      calls.every((c) => c.redirect === "manual"),
      "every changes-feed hop must use redirect:'manual' so page is not dropped",
    );

    // The canonical Location is server behaviour (hardcoded in the spy), but the
    // client's initial query construction is ours to get right: the first
    // request must carry representative affected-*, affecting-*, and applied
    // parameters, since the redirect drops them from the URL but re-encodes them
    // into the canonical path.
    const first = new URL(calls[0].url);
    assert.strictEqual(first.pathname, "/changes/data.feed");
    const q = first.searchParams;
    assert.strictEqual(q.get("affected-type"), "ukpga");
    assert.strictEqual(q.get("affected-year"), "1998");
    assert.strictEqual(q.get("affected-number"), "46");
    assert.strictEqual(q.get("affecting-type"), "ukpga");
    assert.strictEqual(q.get("affecting-year"), "2024");
    assert.strictEqual(q.get("affecting-number"), "10");
    assert.strictEqual(q.get("applied"), "applied");
    assert.strictEqual(
      q.get("page"),
      "10",
      "page rides on the search-form URL too; the redirect drops it, so we re-add it",
    );

    const finalUrl = new URL(calls[1].url);
    assert.strictEqual(
      finalUrl.pathname,
      "/changes/affected/ukpga/1998/46/data.feed",
    );
    assert.strictEqual(finalUrl.searchParams.get("page"), "10");
  } finally {
    restore();
  }
});

test("searchChanges gives up after too many changes-feed redirects instead of silently degrading", async () => {
  // Location keeps pointing back at the search form, so the redirect never
  // resolves. The client must fail loudly rather than fall back to an
  // automatic-redirect fetch that would drop `page`.
  const { calls, restore } = installChangesRedirectSpy(
    "/changes/data.feed?loop=1",
  );
  try {
    const client = new LegislationClient();
    await assert.rejects(
      client.searchChanges({
        affectedType: "ukpga",
        affectedYear: "1998",
        affectedNumber: "46",
        page: 10,
      }),
      /Too many redirects/,
    );

    // The hop limit is 5, so exactly 5 manual fetches — no unbounded loop.
    assert.strictEqual(calls.length, 5);
    assert.ok(calls.every((c) => c.redirect === "manual"));
  } finally {
    restore();
  }
});
