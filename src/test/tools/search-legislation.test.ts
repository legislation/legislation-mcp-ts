import { afterEach, test } from "node:test";
import assert from "node:assert";
import { execute } from "../../tools/search-legislation.js";
import { LegislationClient } from "../../api/legislation-client.js";
import { installFetchSpy, restoreFetch } from "../helpers/fetch-spy.js";

const ATOM_FEED_BODY = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <leg:page xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation">1</leg:page>
  <leg:morePages xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation">1</leg:morePages>
</feed>`;

afterEach(restoreFetch);

test("subject with no type defaults type to 'secondary' in the URL", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ subject: "banking" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.pathname, "/secondary/banking/data.feed");
});

test("subject with a non-SI type returns an error and does not make an HTTP call", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  const result = await execute(
    { subject: "banking", type: ["ukpga"] },
    client,
  );

  assert.strictEqual(getRequestedUrl(), undefined, "should not make HTTP call");
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, /subject filtering/);
  assert.match(result.content[0].text, /ukpga/);
});

test("subject with composite SI types proceeds and joins them with '+'", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ subject: "banking", type: ["uksi", "ssi"] }, client);

  const url = getRequestedUrl()!;
  assert.ok(
    url.includes("/uksi%2Bssi/banking/data.feed") ||
      url.includes("/uksi+ssi/banking/data.feed"),
    `expected composite type path, got ${url}`,
  );
});

test("multi-type search without subject joins types with '+' in the query string", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ type: ["primary", "secondary"], title: "pension" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("type"), "primary+secondary");
});

test("language='welsh' is translated to lang=cy on the wire", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ title: "pension", language: "welsh" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("lang"), "cy");
  assert.strictEqual(url.searchParams.get("language"), null);
});

test("title searches are forwarded on the wire", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ title: "pension" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("title"), "pension");
});

test("language='english' is translated to lang=en on the wire", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ title: "pension", language: "english" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("lang"), "en");
});

test("exactExtent prefixes '=' and joins extent values with '+'", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ extent: ["E", "W"], exactExtent: true }, client);

  const url = getRequestedUrl()!;
  assert.ok(
    url.includes("extent=%3DE%2BW"),
    `expected extent=%3DE%2BW, got ${url}`,
  );
});

test("sort='basic' is translated to sort=year on the wire", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ q: "pension", sort: "basic" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("sort"), "year");
});

test("sort='published' passes through unchanged", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ sort: "published" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("sort"), "published");
});

test("sort='relevance' without q/title/subject returns an error and does not make an HTTP call", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  const result = await execute({ sort: "relevance" }, client);

  assert.strictEqual(getRequestedUrl(), undefined, "should not make HTTP call");
  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, /sort='relevance'/);
  assert.match(result.content[0].text, /q.*title.*subject/);
});

test("sort='relevance' with q proceeds and forwards sort=relevance", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ q: "pension", sort: "relevance" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("sort"), "relevance");
});

test("sort='relevance' with title proceeds", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ title: "pension", sort: "relevance" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("sort"), "relevance");
});

test("sort='relevance' with subject proceeds", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ subject: "banking", sort: "relevance" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("sort"), "relevance");
});

test("extent=['NI'] is mapped to the 'N.I.' value the data uses", async () => {
  const getRequestedUrl = installFetchSpy(ATOM_FEED_BODY);
  const client = new LegislationClient();

  await execute({ extent: ["NI"] }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("extent"), "N.I.");
});
