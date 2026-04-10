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

  async search(query: string, page?: number): Promise<ResearchSearchResponse> {
    const params: Record<string, string> = { query };
    if (page !== undefined) {
      params.page = String(page);
    }
    return this.getJson<ResearchSearchResponse>(
      "/query-builder/search/data.json",
      params
    );
  }

  async count(query: string): Promise<ResearchCountResponse> {
    return this.getJson<ResearchCountResponse>(
      "/query-builder/count/data.json",
      { query }
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

    return (await response.json()) as T;
  }
}
