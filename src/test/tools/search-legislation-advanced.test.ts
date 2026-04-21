import { afterEach, test } from "node:test";
import assert from "node:assert";
import { execute } from "../../tools/search-legislation-advanced.js";
import { ResearchClient } from "../../api/research-client.js";
import { installFetchSpy, restoreFetch } from "../helpers/fetch-spy.js";

const SEARCH_JSON = JSON.stringify({
  q: "pension",
  case: false,
  stem: true,
  punctuation: false,
  amendments: "include",
  count: 0,
  page: 1,
  more: false,
  documents: [],
});

afterEach(restoreFetch);

test("omits case/stem/punctuation from the URL when args omit them (API applies defaults)", async () => {
  const getRequestedUrl = installFetchSpy(SEARCH_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await execute({ query: "pension" }, client);

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("case"), null);
  assert.strictEqual(url.searchParams.get("stem"), null);
  assert.strictEqual(url.searchParams.get("punctuation"), null);
});

test("explicit case/stem/punctuation values override defaults", async () => {
  const getRequestedUrl = installFetchSpy(SEARCH_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await execute(
    { query: "pension", case: true, stem: false, punctuation: true },
    client,
  );

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("case"), "true");
  assert.strictEqual(url.searchParams.get("stem"), "false");
  assert.strictEqual(url.searchParams.get("punctuation"), "true");
});

test("HTML response surfaces as 'Likely query syntax error:' with isError=true", async () => {
  installFetchSpy("<html>landing page</html>", {
    contentType: "text/html",
  });
  const client = new ResearchClient();

  const result = await execute({ query: "title(unbalanced" }, client);

  assert.strictEqual(result.isError, true);
  assert.match(result.content[0].text, /^Likely query syntax error:/);
});

test("non-2xx responses surface as a generic error (not as a query-syntax hint)", async () => {
  installFetchSpy("server error", {
    contentType: "text/plain",
    status: 500,
  });
  const client = new ResearchClient();

  const result = await execute({ query: "pension" }, client);

  assert.strictEqual(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /query syntax error/i);
  assert.match(result.content[0].text, /Error searching legislation/);
});
