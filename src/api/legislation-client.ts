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
    if (params.page && params.page > 1) queryParams.append("page", String(params.page));

    const url = `${this.baseUrl}/changes/data.feed?${queryParams.toString()}`;

    return this.fetchText(url);
  }

  /**
   * Fetch helper for document responses that may return HTTP 300 (Multiple Choices)
   * when a calendar year is ambiguous across regnal years.
   */
  private async fetchDocument(url: string): Promise<LegislationResponse> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "legislation-mcp-server/0.1.0 (contact: jim@jurisdatum.com)"
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
          "User-Agent": "legislation-mcp-server/0.1.0 (contact: jim@jurisdatum.com)"
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Not found: ${url}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch ${url}: ${error.message}`);
      }
      throw error;
    }
  }
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
