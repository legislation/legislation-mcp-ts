/**
 * Client for the legislation.gov.uk public API
 *
 * This client wraps the legacy public API endpoints at legislation.gov.uk,
 * providing methods for retrieving legislation data in various formats.
 *
 * Most endpoints return XML (CLML format) or HTML. Some endpoints may support
 * other formats like Atom feeds or RDF.
 */

export interface DisambiguationAlternative {
  id: string;
  title: string;
  type: string;
  year: string;
  number: string;
}

export type LegislationLanguage = "english" | "welsh";

export type LegislationResponse =
  | { kind: "document"; content: string }
  | { kind: "disambiguation"; alternatives: DisambiguationAlternative[] };

export class LegislationClient {
  private baseUrl = "https://www.legislation.gov.uk";
  private userAgent = "legislation-mcp-server/0.1.0 (contact: jim@jurisdatum.com)";

  /**
   * Retrieve a full legislation document by citation
   * Returns CLML XML by default, Akoma Ntoso if requested, or HTML
   */
  async getDocument(
    type: string,
    year: string,
    number: string,
    options: {
      format?: "xml" | "akn" | "html";
      version?: string; // Point-in-time date (YYYY-MM-DD)
      language?: LegislationLanguage;
    } = {}
  ): Promise<LegislationResponse> {
    const { format = "xml", version, language } = options;

    const versionPath = version ? `/${version}` : "";
    const languagePath = language === "welsh" ? "/welsh" : "";
    const url = `${this.baseUrl}/${type}/${year}/${number}${versionPath}${languagePath}/data.${format}`;

    return this.fetchDocument(url);
  }

  /**
   * Retrieve metadata only for a legislation document (without full content)
   * Returns metadata in XML format
   *
   * This is more efficient than fetching the full document when you only need
   * metadata like title, year, number, extent, dates, etc.
   *
   * Endpoint: /type/year/number[/version]/resources/data.xml
   */
  async getDocumentMetadata(
    type: string,
    year: string,
    number: string,
    options: {
      version?: string; // Point-in-time date (YYYY-MM-DD)
      language?: LegislationLanguage;
    } = {}
  ): Promise<LegislationResponse> {
    const { version, language } = options;

    const versionPath = version ? `/${version}` : "";
    const languagePath = language === "welsh" ? "/welsh" : "";
    const url = `${this.baseUrl}/${type}/${year}/${number}${versionPath}/resources${languagePath}/data.xml`;

    return this.fetchDocument(url);
  }

  /**
   * Retrieve a specific fragment of a legislation document
   * Returns CLML XML by default, Akoma Ntoso if requested, or HTML
   *
   * Fragments can be Parts, Chapters, Cross-Headings, Sections, or Subsections.
   * The fragmentId should be a path like "section/5" or "part/1/chapter/2".
   */
  async getFragment(
    type: string,
    year: string,
    number: string,
    fragmentId: string,
    options: {
      format?: "xml" | "akn" | "html";
      version?: string; // Point-in-time date (YYYY-MM-DD)
      language?: LegislationLanguage;
    } = {}
  ): Promise<LegislationResponse> {
    const { format = "xml", version, language } = options;

    const versionPath = version ? `/${version}` : "";
    const languagePath = language === "welsh" ? "/welsh" : "";
    const url = `${this.baseUrl}/${type}/${year}/${number}/${fragmentId}${versionPath}${languagePath}/data.${format}`;

    return this.fetchDocument(url);
  }

  /**
   * Retrieve the table of contents for a legislation document
   * Returns the Contents element in the requested format (XML by default)
   */
  async getTableOfContents(
    type: string,
    year: string,
    number: string,
    options: {
      format?: "xml" | "akn" | "html";
      version?: string; // Point-in-time date (YYYY-MM-DD)
      language?: LegislationLanguage;
    } = {}
  ): Promise<LegislationResponse> {
    const { format = "xml", version, language } = options;

    const versionPath = version ? `/${version}` : "";
    const languagePath = language === "welsh" ? "/welsh" : "";
    const url = `${this.baseUrl}/${type}/${year}/${number}/contents${versionPath}${languagePath}/data.${format}`;

    return this.fetchDocument(url);
  }

  /**
   * Search for legislation by various criteria
   * Returns Atom feed (XML format)
   */
  async search(params: {
    title?: string;
    text?: string;
    type?: string[];
    year?: string;
    startYear?: string;
    endYear?: string;
    subject?: string;
    department?: string;
    sort?: string;
    extent?: string;
    lang?: string;
    page?: number;
  }): Promise<string> {
    // `subject`, when set, goes in the URL path — the public API's URL-rewrite
    // layer strips `?subject=` before it reaches MarkLogic. The SI-family type
    // constraint is enforced by the tool layer; here we just default to
    // `secondary` (the SI aggregate) if a subject was passed without a type.
    const types = params.subject && (!params.type || params.type.length === 0)
      ? ["secondary"]
      : params.type;
    const joinedType = types && types.length > 0 ? types.join("+") : undefined;

    const queryParams = new URLSearchParams();
    if (params.title) queryParams.append("title", params.title);
    if (params.text) queryParams.append("text", params.text);
    if (joinedType && !params.subject) queryParams.append("type", joinedType);
    if (params.year) queryParams.append("year", params.year);
    if (params.startYear) queryParams.append("start-year", params.startYear);
    if (params.endYear) queryParams.append("end-year", params.endYear);
    if (params.department) queryParams.append("department", params.department);
    if (params.sort) queryParams.append("sort", params.sort);
    if (params.extent) queryParams.append("extent", params.extent);
    if (params.lang) queryParams.append("lang", params.lang);
    if (params.page && params.page > 1) queryParams.append("page", String(params.page));

    const path =
      params.subject && joinedType
        ? `/${encodeURIComponent(joinedType)}/${encodeURIComponent(params.subject)}/data.feed`
        : `/search/data.feed`;
    const queryString = queryParams.toString();
    const url = `${this.baseUrl}${path}${queryString ? `?${queryString}` : ""}`;

    return this.fetchText(url);
  }

  /**
   * Search for legislative effects (changes) by affecting and/or affected legislation
   * Returns Atom feed (XML format)
   */
  async searchChanges(params: {
    affectingType?: string;
    affectingYear?: string;
    affectingNumber?: string;
    affectedType?: string;
    affectedYear?: string;
    affectedNumber?: string;
    applied?: boolean;
    page?: number;
  }): Promise<string> {
    const queryParams = new URLSearchParams();
    if (params.affectedType) queryParams.append("affected-type", params.affectedType);
    if (params.affectedYear) {
      queryParams.append("affected-year-choice", "specific");
      queryParams.append("affected-year", params.affectedYear);
    }
    if (params.affectedNumber) queryParams.append("affected-number", params.affectedNumber);
    if (params.affectingType) queryParams.append("affecting-type", params.affectingType);
    if (params.affectingYear) {
      queryParams.append("affecting-year-choice", "specific");
      queryParams.append("affecting-year", params.affectingYear);
    }
    if (params.affectingNumber) queryParams.append("affecting-number", params.affectingNumber);
    if (params.applied !== undefined) queryParams.append("applied", params.applied ? "applied" : "unapplied");

    // `page` is intentionally NOT added to the search-form query string here —
    // it must be re-attached to the canonical URL after the redirect (see
    // fetchChangesFeed).
    const url = `${this.baseUrl}/changes/data.feed?${queryParams.toString()}`;

    return this.fetchChangesFeed(url, params.page);
  }

  /**
   * Fetch a changes feed, preserving `page` across the canonicalising redirect.
   *
   * The `/changes/data.feed` search-form endpoint answers with a 301 redirect to
   * a canonical path-based URL (e.g. `/changes/affected/ukpga/1998/46/data.feed`),
   * re-encoding every search parameter into the path — EXCEPT `page`, which is a
   * genuine query parameter and is dropped along with the rest of the query
   * string. Letting `fetch` follow the redirect automatically therefore loses
   * `page`, so every request comes back as page 1 (LMSC-40).
   *
   * We instead follow the redirect ourselves and re-attach `page` at every hop,
   * so it lands on the canonical URL, which does honour it.
   */
  private async fetchChangesFeed(searchUrl: string, page?: number): Promise<string> {
    // Page 1 has no pagination parameter to preserve, so a normal
    // redirect-following fetch is correct and costs a single round trip.
    if (!page || page <= 1) {
      return this.fetchText(searchUrl);
    }

    let url = withPage(searchUrl, page);
    try {
      for (let hop = 0; hop < 5; hop++) {
        const response = await fetch(url, {
          redirect: "manual",
          headers: { "User-Agent": this.userAgent },
        });
        // A 3xx here strips the query string; re-attach `page` to the target.
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            // Drain the (small) redirect body so undici can reuse the socket.
            // `body.cancel()` releases it but does not drain it, which can
            // prevent connection reuse, so read it to completion instead.
            await response.arrayBuffer();
            url = withPage(new URL(location, url).toString(), page);
            continue;
          }
        }
        return this.readText(response, url);
      }
      // Too many redirects. Falling back to an automatic-redirect fetch would
      // defeat pagination preservation and bypass this hop limit, so fail loudly.
      throw new Error("Too many redirects (limit: 5) resolving changes feed");
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetch helper for document responses that may return HTTP 300 (Multiple Choices)
   * when a calendar year is ambiguous across regnal years.
   */
  private async fetchDocument(url: string): Promise<LegislationResponse> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent
        }
      });

      if (response.status === 300) {
        const body = await response.text();
        const alternatives = this.parseAlternatives(body);
        if (alternatives.length > 0) {
          return { kind: "disambiguation", alternatives };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Not found: ${url}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return { kind: "document", content: await response.text() };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }
      throw error;
    }
  }

  private parseAlternatives(html: string): DisambiguationAlternative[] {
    return parseDisambiguationHtml(html);
  }

  /**
   * Fetch helper for text responses (XML, HTML)
   * Used by search, which does not encounter 300 responses.
   */
  private async fetchText(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent
        }
      });

      return await this.readText(response, url);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Read a text response body, mapping non-OK statuses to errors.
   * `url` is only used for the "Not found" message.
   */
  private async readText(response: Response, url: string): Promise<string> {
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Not found: ${url}`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  }
}

/**
 * Return `url` with its `page` query parameter set to `page`, replacing any
 * existing one. Used to carry pagination across the changes-feed redirect.
 */
function withPage(url: string, page: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set("page", String(page));
  return parsed.toString();
}

/**
 * Parse alternatives from an HTTP 300 Multiple Choices HTML response.
 * The response contains a list of links to the canonical documents
 * identified by regnal year.
 */
export function parseDisambiguationHtml(html: string): DisambiguationAlternative[] {
  const results: DisambiguationAlternative[] = [];
  const regex = /<li>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/li>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const title = match[2];
    // href is like "/ukpga/Geo5/4-5/1" — type is first segment, number is last
    const parts = href.split("/").filter(Boolean);
    const id = parts.join("/");
    const type = parts[0];
    const number = parts[parts.length - 1];
    const year = parts.slice(1, -1).join("/");
    results.push({ id, title, type, year, number });
  }
  return results;
}
