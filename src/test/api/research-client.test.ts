import { afterEach, test } from "node:test";
import assert from "node:assert";
import {
  ResearchClient,
  ResearchNonJsonResponseError,
} from "../../api/research-client.js";
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

const COUNT_JSON = JSON.stringify({
  q: "pension",
  case: false,
  stem: true,
  amendments: "include",
  counts: { documents: 0 },
});

afterEach(restoreFetch);

test("search() omits case/stem/punctuation when not supplied", async () => {
  const getRequestedUrl = installFetchSpy(SEARCH_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await client.search("pension");

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("case"), null);
  assert.strictEqual(url.searchParams.get("stem"), null);
  assert.strictEqual(url.searchParams.get("punctuation"), null);
});

test("search() forwards case/stem/punctuation booleans as string values", async () => {
  const getRequestedUrl = installFetchSpy(SEARCH_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await client.search("pension", {
    case: true,
    stem: false,
    punctuation: true,
  });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("case"), "true");
  assert.strictEqual(url.searchParams.get("stem"), "false");
  assert.strictEqual(url.searchParams.get("punctuation"), "true");
});

test("search() forwards page as a URL param", async () => {
  const getRequestedUrl = installFetchSpy(SEARCH_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await client.search("pension", { page: 3 });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("page"), "3");
});

test("count() forwards case/stem/punctuation booleans as string values", async () => {
  const getRequestedUrl = installFetchSpy(COUNT_JSON, {
    contentType: "application/json",
  });
  const client = new ResearchClient();

  await client.count("pension", {
    case: false,
    stem: true,
    punctuation: false,
  });

  const url = new URL(getRequestedUrl()!);
  assert.strictEqual(url.searchParams.get("case"), "false");
  assert.strictEqual(url.searchParams.get("stem"), "true");
  assert.strictEqual(url.searchParams.get("punctuation"), "false");
});

test("200 with HTML content-type throws ResearchNonJsonResponseError", async () => {
  installFetchSpy("<html>landing page</html>", {
    contentType: "text/html",
  });
  const client = new ResearchClient();

  await assert.rejects(
    () => client.search("title(unbalanced"),
    (err) => err instanceof ResearchNonJsonResponseError,
  );
});

test("application/json with a charset suffix is accepted", async () => {
  installFetchSpy(SEARCH_JSON, {
    contentType: "application/json; charset=utf-8",
  });
  const client = new ResearchClient();

  const response = await client.search("pension");
  assert.strictEqual(response.q, "pension");
});

test("non-2xx responses throw a generic Error, not ResearchNonJsonResponseError", async () => {
  installFetchSpy("server error", {
    contentType: "text/plain",
    status: 500,
  });
  const client = new ResearchClient();

  await assert.rejects(
    () => client.search("pension"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(!(err instanceof ResearchNonJsonResponseError));
      assert.match(err.message, /500/);
      return true;
    },
  );
});
