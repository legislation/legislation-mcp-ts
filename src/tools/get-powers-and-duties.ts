/**
 * Tool: get_powers_and_duties
 *
 * All powers and duties for a given Act / SI / Regulation, in best-effort
 * provision order.
 */

import {
  DutiesDbApi,
  DutyRow,
  Inference,
  Modality,
  normalizeEnactmentUri,
  Priority,
  validateDutyFilters,
} from "../api/duties-types.js";

export const name = "get_powers_and_duties";

export const description = `Return the powers and duties extracted from a single piece of legislation, in best-effort provision order (section/2 before section/10).

Identify the enactment with \`enactment\` — its document identifier, \`type/year/number\` (e.g. \`ukpga/2010/15\`); a full legislation.gov.uk URL or \`/id/\` URI is also accepted. This is the same value search_powers_and_duties and count_powers_and_duties accept and emit (as \`enactmentUri\`), so you can pass a result's \`enactmentUri\` straight through. Alternatively, supply the \`type\`, \`year\`, and \`number\` fields separately, matching get_legislation and get_legislation_metadata.

Optionally narrow to just duties or just powers with \`modality\`, and filter by \`priority\` and \`inference\` (same semantics as search_powers_and_duties). When \`modality\` is not set, the response also carries a \`modalityBreakdown\` — the duty-vs-power split for the enactment — so you can see the mix at a glance. Each result's \`actorAliases\` resolve the actor term to concrete instances; an alias's \`bodyUri\`, when present, is the canonical legislation.gov.uk organisation identifier for that body (dereferenceable linked data).

Results are paginated (default 50 per page, max 100). The response carries \`total\`, \`page\`, and \`morePages\` — request further pages for large enactments, some of which have thousands of provisions.

Important: This is a research extract — each result carries the date it was captured (\`extractedAsOf\`) and reflects the legislation as it stood then, not necessarily current law; subsequent amendments may not be reflected. Provision ordering is best-effort; the legislation's own table of contents is authoritative.`;

export const inputSchema = {
  type: "object",
  properties: {
    enactment: {
      type: "string",
      description:
        "Preferred. The enactment's document identifier — `type/year/number`, e.g. `ukpga/2010/15`. A full legislation.gov.uk URL or `/id/` URI is also accepted, so a search_powers_and_duties / count_powers_and_duties result's `enactmentUri` can be passed straight through. Supply this OR the `type`/`year`/`number` fields.",
    },
    type: {
      type: "string",
      description: "Enactment type code (e.g. `ukpga`, `uksi`, `asp`, `wsi`). Used with `year` and `number` when `enactment` is not supplied.",
    },
    year: {
      type: "string",
      description:
        "Enactment year — a calendar year (e.g. `2010`), or for pre-1963 Acts the regnal-year form in Reign/Number format (e.g. `Geo5/26`).",
    },
    number: {
      type: "string",
      description: "Enactment number within the year (e.g. `15`).",
    },
    modality: {
      type: "string",
      enum: ["duty", "power"],
      description:
        "Filter to duties (must/shall) or powers (may/authorised). Omit to return both (and get a modalityBreakdown).",
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
      description: "Provisions per page. Default 50, maximum 100.",
      minimum: 1,
      maximum: 100,
    },
  },
  // No `required`: either `enactment` alone or the full type/year/number triple
  // is acceptable. execute() enforces that one of those forms is present (the
  // MCP runtime does not enforce JSON-schema `required` here anyway).
};

interface GetArgs {
  enactment?: string;
  type?: string;
  year?: string;
  number?: string;
  modality?: Modality;
  priority?: Priority;
  inference?: Inference;
  page?: number;
  page_size?: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

function shapeRow(r: DutyRow) {
  return {
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

function resolveEnactmentUri(args: GetArgs): string | null {
  // `enactment` (a single forgiving identifier) takes precedence: it's the
  // value search_powers_and_duties / count_powers_and_duties emit as `enactmentUri`, and
  // normalizeEnactmentUri passes a canonical /id/ URI through unchanged — so a
  // regnal URI like .../id/aep/Cha2/18-19/11 round-trips exactly, where
  // reconstructing it from the integer triple would not.
  if (args.enactment) return normalizeEnactmentUri(args.enactment);
  // Otherwise assemble the canonical /id/ URI from the triple — the same
  // identifier the get_legislation_* tools use. normalizeEnactmentUri is cheap
  // insurance (strips a stray trailing slash, lowercases the host).
  if (args.type && args.year && args.number) {
    return normalizeEnactmentUri(
      `http://www.legislation.gov.uk/id/${args.type}/${args.year}/${args.number}`,
    );
  }
  return null;
}

export async function execute(args: GetArgs = {}, db: DutiesDbApi) {
  // The identifier fields arrive as `any` from the MCP runtime; reject
  // non-string values before resolution rather than coerce them silently.
  for (const key of ["enactment", "type", "year", "number"] as const) {
    const v = args[key];
    if (v !== undefined && typeof v !== "string") {
      return {
        content: [{ type: "text", text: `Invalid input: ${key} must be a string` }],
        isError: true,
      };
    }
  }

  // Validate the modality/priority/inference enums (the MCP runtime does not
  // enforce JSON-schema enums) — same gate search_powers_and_duties applies.
  const validationError = validateDutyFilters(args);
  if (validationError) {
    return {
      content: [{ type: "text", text: `Invalid input: ${validationError}` }],
      isError: true,
    };
  }

  const enactmentUri = resolveEnactmentUri(args);
  if (!enactmentUri) {
    return {
      content: [
        {
          type: "text",
          text: "Provide the enactment as a single identifier (`enactment`, e.g. `ukpga/2010/15`) — or as `type`, `year`, and `number`.",
        },
      ],
      isError: true,
    };
  }

  // Runtime clamps — the JSON-schema minima/maxima are documentation only.
  const rawPage = args.page ?? 1;
  const rawPageSize = args.page_size ?? DEFAULT_PAGE_SIZE;
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
    : DEFAULT_PAGE_SIZE;

  const filters = {
    modality: args.modality,
    priority: args.priority,
    inference: args.inference,
  };

  try {
    const result = await db.getForEnactment(enactmentUri, page, pageSize, filters);
    if (result.total === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                enactmentUri,
                found: false,
                note: "No powers or duties found for this enactment (under any filters supplied). Either the legislation has none extracted, or the URI is not in the dataset.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    if (result.rows.length === 0) {
      // total > 0 but no rows: the enactment exists, but the caller-supplied
      // `page` is past the end. Return an explicit response with a note
      // explaining the empty page, rather than the normal success shape whose
      // title/year/type (read from the first row) would silently vanish here.
      const totalPages = Math.ceil(result.total / result.pageSize);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                enactmentUri,
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                morePages: false,
                results: [],
                note: `Requested page is beyond the result set. There ${totalPages === 1 ? "is" : "are"} ${totalPages} page${totalPages === 1 ? "" : "s"} at this page size.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    // Modality split across the whole (priority/inference-filtered) enactment,
    // so the caller sees the powers/duties mix without paging. Skipped when
    // modality is pinned — then `total` already is that modality's count — so
    // the extra grouped count only runs when it adds information. In the
    // success path only: the no-result branches above never reach here, so the
    // mocks/tests that stub just getForEnactment stay valid.
    let modalityBreakdown: { duty: number; power: number } | undefined;
    if (!filters.modality) {
      const counts = await db.count(
        { enactmentUri, priority: filters.priority, inference: filters.inference },
        "modality",
      );
      const groupCount = (k: string) =>
        counts.groups.find((g) => g.key === k)?.count ?? 0;
      modalityBreakdown = { duty: groupCount("duty"), power: groupCount("power") };
    }

    const shaped = {
      enactmentUri,
      enactmentTitle: result.rows[0]?.enactmentTitle,
      enactmentYear: result.rows[0]?.enactmentYear,
      enactmentType: result.rows[0]?.enactmentType,
      total: result.total,
      ...(modalityBreakdown ? { modalityBreakdown } : {}),
      page: result.page,
      pageSize: result.pageSize,
      morePages: result.morePages,
      results: result.rows.map(shapeRow),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `Error retrieving powers and duties for enactment: ${msg}` },
      ],
      isError: true,
    };
  }
}
