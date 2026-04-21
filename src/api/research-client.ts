/**
 * Client for the research.legislation.gov.uk Query Builder API.
 *
 * Provides access to advanced structured search over legislation XML.
 * Uses HTTP Basic Auth for authentication.
 */

/** A snippet from a search result, showing matching text. */
export interface ResearchSnippet {
  text: string;
}

/** A structural element match (e.g., a matching Chapter or Part). */
export interface ResearchMatch {
  name: string;
  number: string;
  heading: string;
  link: string;
  snippets: ResearchSnippet[] | null;
}

/** How the API handled inserted amendment text in the query. */
export type AmendmentsMode = "include" | "exclude" | "within";

/**
 * A document in search results.
 *
 * Most fields are optional because the API returns a minimal shape (only
 * `id`, `title`, `counts`) when results are ordered by a counter field
 * (e.g., `orderby=-schedules`). For all other queries, the non-optional
 * fields below are reliably present.
 */
export interface ResearchDocument {
  id: string;
  title: string;
  type?: string;
  year?: number;
  number?: number;
  link?: string;
  enacted?: string;
  made?: string;
  laid?: string;
  cif?: string;
  valid?: string;
  modified?: string;
  ISBN?: string;
  snippets?: ResearchSnippet[] | null;
  matches?: ResearchMatch[];
  counts?: Record<string, number>;
}

/** Raw response from the search endpoint. */
export interface ResearchSearchResponse {
  q: string;
  case: boolean;
  stem: boolean;
  punctuation: boolean;
  amendments: AmendmentsMode;
  count: number;
  page: number;
  more: boolean;
  documents: ResearchDocument[];
}

/** Raw response from the count endpoint. */
export interface ResearchCountResponse {
  q: string;
  case: boolean;
  stem: boolean;
  amendments: AmendmentsMode;
  counts: Record<string, number | Record<string, number>>;
}

export interface ResearchClientOptions {
  baseUrl?: string;
  username?: string;
  password?: string;
}

/**
 * Matching-mode flags that the Research API accepts as URL parameters
 * (outside the query string itself). Each is optional; when omitted, the
 * caller's default applies.
 */
export interface ResearchMatchingOptions {
  case?: boolean;
  stem?: boolean;
  punctuation?: boolean;
}

export interface ResearchSearchOptions extends ResearchMatchingOptions {
  page?: number;
}

/**
 * Thrown when the Research API returns HTTP 200 with a non-JSON
 * content-type (typically an HTML landing page) instead of the expected
 * JSON envelope. The API signals query-parse failures this way, so a
 * malformed query is the most common cause — but callers should treat
 * that as the likely, not certain, explanation.
 */
export class ResearchNonJsonResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchNonJsonResponseError";
  }
}

function addMatchingOptions(
  params: Record<string, string>,
  options: ResearchMatchingOptions
): void {
  if (options.case !== undefined) params.case = String(options.case);
  if (options.stem !== undefined) params.stem = String(options.stem);
  if (options.punctuation !== undefined)
    params.punctuation = String(options.punctuation);
}

export class ResearchClient {
  private baseUrl: string;
  private authHeader?: string;

  constructor(options: ResearchClientOptions = {}) {
    const envBaseUrl = process.env.RESEARCH_API_BASE_URL;
    this.baseUrl = (
      options.baseUrl ??
      envBaseUrl ??
      "https://research.legislation.gov.uk"
    ).replace(/\/+$/, "");

    const username = options.username ?? process.env.RESEARCH_API_USERNAME;
    const password = options.password ?? process.env.RESEARCH_API_PASSWORD;
    if (username && password) {
      const credentials = Buffer.from(`${username}:${password}`).toString("base64");
      this.authHeader = `Basic ${credentials}`;
    }
  }

  async search(
    query: string,
    options: ResearchSearchOptions = {}
  ): Promise<ResearchSearchResponse> {
    const params: Record<string, string> = { query };
    if (options.page !== undefined) {
      params.page = String(options.page);
    }
    addMatchingOptions(params, options);
    return this.getJson<ResearchSearchResponse>(
      "/query-builder/search/data.json",
      params
    );
  }

  async count(
    query: string,
    options: ResearchMatchingOptions = {}
  ): Promise<ResearchCountResponse> {
    const params: Record<string, string> = { query };
    addMatchingOptions(params, options);
    return this.getJson<ResearchCountResponse>(
      "/query-builder/count/data.json",
      params
    );
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string>
  ): Promise<T> {
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}?${queryString}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.authHeader) {
      headers.Authorization = this.authHeader;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }
      throw error;
    }

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore response body parsing errors
      }
      const detail = errorBody ? ` - ${errorBody}` : "";
      throw new Error(
        `Research API request failed: ${response.status} ${response.statusText}${detail}`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ResearchNonJsonResponseError(
        "Research API returned a non-JSON response. The most likely " +
          "cause is a query syntax error — common culprits are " +
          "unbalanced brackets, an unknown element name, an unknown " +
          "type code, a non-numeric value on a numeric field, or a typo " +
          "in a reserved word. See advanced://query-syntax for the full " +
          "grammar. If the query looks well-formed, the API itself may " +
          "be returning an error page."
      );
    }

    return (await response.json()) as T;
  }
}
