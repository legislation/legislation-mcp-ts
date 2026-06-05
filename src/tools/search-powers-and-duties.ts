/**
 * Tool: search_powers_and_duties
 *
 * Search the powers-and-duties dataset by filter and/or free-text.
 */

import {
  DutiesDbApi,
  DutyRow,
  Inference,
  Modality,
  normalizeEnactmentUri,
  Priority,
  SearchFilters,
  validateDutyFilters,
} from "../api/duties-types.js";

export const name = "search_powers_and_duties";

export const description = `Search the National Archives' powers-and-duties research dataset. Each row identifies a power or duty granted to or imposed on an actor by a specific provision of UK legislation, with the action expressed in plain English.

Use \`query\` for free-text search over the action, condition, and actor fields. Pass natural language — words are matched as required terms (implicit AND); wrap a phrase in double quotes to require those words adjacent (e.g. \`"local authority"\`); put \`OR\` between terms to match either (e.g. \`report OR notify\`); and prefix a term with \`-\` to exclude it (e.g. \`inspection -fee\`). Punctuation, apostrophes, hyphens, and stray characters are handled safely. Combine with filters for jurisdiction (\`enactment_type\`), year range, actor name, modality (duty vs power), priority (primary vs secondary), and inference (explicit vs implicit).

Each result includes \`enactment_uri\` and \`section_uri\`. Pass \`enactment_uri\` straight to get_powers_and_duties's \`enactment\` field; for get_legislation_metadata / get_legislation_fragment, split it into \`type\`/\`year\`/\`number\` (using the fragment tail, e.g. \`section/5\`, as \`fragmentId\`). Each result's \`actorAliases\` resolve the actor term to concrete instances; an alias's \`bodyUri\`, when present, is the canonical legislation.gov.uk organisation identifier for that body (dereferenceable linked data).

Important: This is a research extract — each result carries the date it was captured (\`extractedAsOf\`) and reflects the legislation as it stood then, not necessarily current law. Subsequent amendments may not be reflected. The dataset does not show the evolution of powers/duties over time within a document.`;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Natural-text search over the action, condition, and actor fields. Words are required terms (implicit AND); wrap a phrase in double quotes to require adjacency; `OR` between terms matches either; a `-` prefix excludes a term. Examples: `court report`, `\"local authority\"`, `report OR notify`, `inspection -fee`. Punctuation and special characters are handled safely.",
    },
    enactment: {
      type: "string",
      description:
        "Scope to a single Act, SI, or Regulation by its document identifier — `type/year/number`, e.g. `ukpga/2010/15`. A full legislation.gov.uk URL or `/id/` URI is also accepted.",
    },
    enactment_type: {
      type: "array",
      items: { type: "string" },
      description:
        "Filter by enactment type code (e.g. `ukpga`, `uksi`, `asp`, `ssi`, `wsi`, `nisi`, `nisr`, `eur`, `eudn`, `eudr`, `ukla`).",
    },
    year_from: {
      type: "integer",
      description: "Inclusive lower bound on the enactment year.",
    },
    year_to: {
      type: "integer",
      description: "Inclusive upper bound on the enactment year.",
    },
    actor: {
      type: "string",
      description:
        "Match against the actor name — case-insensitive and inflection-aware. Hits the legislation term (e.g. `NHS body`) or any resolved alias from `actorAliases` (e.g. `Local Health Board`). Word forms are matched by stem, so singular/plural and related forms are interchangeable (e.g. `local authorities` also finds `local authority`). Substring matching also applies, so a shorter term matches longer ones (`Secretary of State` matches `Secretary of State for Health`).",
    },
    modality: {
      type: "string",
      enum: ["duty", "power"],
      description:
        "Filter to duties (must/shall) or powers (may/authorised). Omit to return both.",
    },
    priority: {
      type: "string",
      enum: ["primary", "secondary"],
      description:
        "Primary obligations versus secondary/derivative ones. Omit to return both.",
    },
    inference: {
      type: "string",
      enum: ["explicit", "implicit"],
      description:
        "Explicit duties/powers stated directly in the text, versus implicit ones inferred from context. Omit to return both.",
    },
    page: {
      type: "integer",
      description: "1-indexed page number. Default 1.",
      minimum: 1,
    },
    page_size: {
      type: "integer",
      description: "Results per page. Default 25, maximum 100.",
      minimum: 1,
      maximum: 100,
    },
  },
};

interface SearchArgs {
  query?: string;
  enactment?: string;
  enactment_type?: string[];
  year_from?: number;
  year_to?: number;
  actor?: string;
  modality?: Modality;
  priority?: Priority;
  inference?: Inference;
  page?: number;
  page_size?: number;
}

function shapeRow(r: DutyRow) {
  return {
    enactmentUri: r.enactmentUri,
    enactmentTitle: r.enactmentTitle,
    enactmentYear: r.enactmentYear,
    enactmentType: r.enactmentType,
    sectionUri: r.sectionUri,
    subsection: r.subsection,
    actor: r.actor,
    actorDefinition: r.actorDefinition,
    actorAliases: r.actorAliases,
    modality: r.modality,
    action: r.action,
    condition: r.condition,
    inference: r.inference,
    priority: r.priority,
    extractedAsOf: r.extractedAsOf,
  };
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

export async function execute(args: SearchArgs = {}, db: DutiesDbApi) {
  const validationError = validateDutyFilters(args);
  if (validationError) {
    return {
      content: [{ type: "text", text: `Invalid input: ${validationError}` }],
      isError: true,
    };
  }

  // Runtime clamps — the JSON-schema minima/maxima are documentation only,
  // and the MCP runtime does not enforce them.
  const rawPage = args.page ?? 1;
  const rawPageSize = args.page_size ?? DEFAULT_PAGE_SIZE;
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
    : DEFAULT_PAGE_SIZE;

  const filters: SearchFilters = {
    query: args.query,
    enactmentUri: args.enactment ? normalizeEnactmentUri(args.enactment) : undefined,
    enactmentType: args.enactment_type,
    yearFrom: args.year_from,
    yearTo: args.year_to,
    actor: args.actor,
    modality: args.modality,
    priority: args.priority,
    inference: args.inference,
  };

  try {
    const result = await db.search(filters, page, pageSize);
    const shaped = {
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        morePages: result.morePages,
      },
      results: result.rows.map(shapeRow),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error searching duties: ${msg}` }],
      isError: true,
    };
  }
}
