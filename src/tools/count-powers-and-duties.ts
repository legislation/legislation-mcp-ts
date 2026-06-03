/**
 * Tool: count_powers_and_duties
 *
 * Aggregate counts over the powers-and-duties dataset, optionally grouped.
 */

import {
  DutiesDbApi,
  GroupBy,
  Inference,
  Modality,
  normalizeEnactmentUri,
  Priority,
  SearchFilters,
  validateDutyFilters,
} from "../api/duties-db.js";

const GROUP_BY_VALUES: GroupBy[] = [
  "enactment_type",
  "enactment_year",
  "actor",
  "modality",
  "priority",
  "inference",
  "enactment_uri",
];

export const name = "count_powers_and_duties";

export const description = `Count rows in the powers-and-duties dataset, optionally grouped by one dimension.

Accepts the same filters as search_powers_and_duties (free-text \`query\`, enactment_type, year range, actor, modality, priority, inference). Use \`group_by\` to break the count down by enactment_type, enactment_year, actor, modality, priority, inference, or enactment_uri.

**Grouped results are top-N by count.** When \`group_by\` is set the response returns the top \`group_limit\` groups (default 100, max 200), ordered by descending count then by key. The response includes \`groupsTruncated: true\` if more groups exist beyond what was returned; \`total\` is always the full filter-matched row count, so \`total - sum(returned group counts)\` is the size of the truncated tail. \`group_by=actor\` (~98k distinct values) and \`group_by=enactment_uri\` (~30k) will almost always truncate; combine with narrower filters when you need precise top-N.

When \`group_by=enactment_uri\`, each group also carries the enactment \`title\` (so the URI key is human-readable). The \`key\` is the enactment URI — pass it straight to get_powers_and_duties's \`enactment\` field to drill in. (For get_legislation_metadata or get_legislation, split the URI into its \`type\`/\`year\`/\`number\` first.)

Examples:
- How many powers does the Secretary of State have under primary legislation since 2010? Filter actor=Secretary of State, modality=power, year_from=2010.
- Which Acts impose the most duties on local authorities? Filter actor=local authority, modality=duty, group_by=enactment_uri.
- How are duties distributed across jurisdictions? group_by=enactment_type.

Important: This is a research extract — counts reflect a point-in-time snapshot of the legislation, not necessarily today. Do not read \`group_by=enactment_year\` as a trend over time: the counts are provisions that survive in this snapshot, bucketed by the year their parent enactment was made — not when a power or duty was created (one added to an older Act by a later amendment still counts under the older Act's year), and they are not adjusted for repeals.`;

export const inputSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Natural-text search (see search_powers_and_duties).",
    },
    enactment: {
      type: "string",
      description:
        "Scope to a single enactment by its document identifier — `type/year/number`, e.g. `ukpga/2010/15`. A full legislation.gov.uk URL or `/id/` URI is also accepted.",
    },
    enactment_type: { type: "array", items: { type: "string" } },
    year_from: { type: "integer" },
    year_to: { type: "integer" },
    actor: { type: "string" },
    modality: { type: "string", enum: ["duty", "power"] },
    priority: { type: "string", enum: ["primary", "secondary"] },
    inference: { type: "string", enum: ["explicit", "implicit"] },
    group_by: {
      type: "string",
      enum: GROUP_BY_VALUES,
      description:
        "Group the count by one of these dimensions. Omit for a single total.",
    },
    group_limit: {
      type: "integer",
      description:
        "Max number of groups to return when group_by is set. Default 100, max 200. Groups are returned top-by-count; the response sets `groupsTruncated: true` if more groups exist beyond the cut.",
      minimum: 1,
      maximum: 200,
    },
  },
};

interface CountArgs {
  query?: string;
  enactment?: string;
  enactment_type?: string[];
  year_from?: number;
  year_to?: number;
  actor?: string;
  modality?: Modality;
  priority?: Priority;
  inference?: Inference;
  group_by?: GroupBy;
  group_limit?: number;
}

const DEFAULT_GROUP_LIMIT = 100;
const MAX_GROUP_LIMIT = 200;

export async function execute(args: CountArgs = {}, db: DutiesDbApi) {
  const validationError = validateDutyFilters(args);
  if (validationError) {
    return {
      content: [{ type: "text", text: `Invalid input: ${validationError}` }],
      isError: true,
    };
  }

  // group_by is a closed enumeration. The MCP runtime does not enforce the
  // JSON-schema enum, so a malformed value (e.g. "year") would otherwise reach
  // the adapter, resolve GROUP_BY_COLUMN[...] to undefined, and surface as an
  // opaque SQL error ("no such column: undefined"). Reject it here instead.
  if (args.group_by !== undefined && !GROUP_BY_VALUES.includes(args.group_by)) {
    return {
      content: [
        {
          type: "text",
          text: `Invalid input: group_by must be one of ${GROUP_BY_VALUES.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

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

  // Runtime clamps — JSON-schema minimum/maximum are documentation only.
  const rawLimit = args.group_limit ?? DEFAULT_GROUP_LIMIT;
  const groupLimit = Number.isFinite(rawLimit)
    ? Math.min(MAX_GROUP_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_GROUP_LIMIT;

  try {
    const result = await db.count(filters, args.group_by ?? null, { groupLimit });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error counting duties: ${msg}` }],
      isError: true,
    };
  }
}
