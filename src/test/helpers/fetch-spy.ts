/**
 * Fetch spy shared by tests that need to assert on the URL a client built,
 * without making a real HTTP call.
 */

const originalFetch = globalThis.fetch;

export function installFetchSpy(responseBody = "<Legislation />") {
  let requestedUrl: string | undefined;

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new Response(responseBody, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }) as typeof fetch;

  return () => requestedUrl;
}

export function restoreFetch() {
  globalThis.fetch = originalFetch;
}
