/**
 * Fetch spy shared by tests that need to assert on the URL a client built,
 * without making a real HTTP call.
 */

const originalFetch = globalThis.fetch;

export function installFetchSpy(
  responseBody = "<Legislation />",
  options: { contentType?: string; status?: number } = {},
) {
  const contentType = options.contentType ?? "application/xml";
  const status = options.status ?? 200;
  let requestedUrl: string | undefined;

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    return new Response(responseBody, {
      status,
      headers: { "Content-Type": contentType },
    });
  }) as typeof fetch;

  return () => requestedUrl;
}

export function restoreFetch() {
  globalThis.fetch = originalFetch;
}
