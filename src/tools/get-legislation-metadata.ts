/**
 * Tool: get_legislation_metadata
 *
 * Retrieve structured metadata for a specific piece of UK legislation
 */

import { LegislationClient, LegislationResponse } from "../api/legislation-client.js";
import { EffectsParser } from "../parsers/effects-parser.js";
import { LegislationMetadata, MetadataParser, ProvisionRef, UnappliedEffect } from "../parsers/metadata-parser.js";
import { contains } from "../utils/section-range-containment.js";

export const name = "get_legislation_metadata";

export const description = `Retrieve structured metadata for a UK legislation document or a specific fragment (Part, Chapter, section, etc.). More efficient than fetching the full document when you only need metadata.

\`type\`, \`year\`, and \`number\` must be exact — use search_legislation to confirm if unsure.

Returns JSON with: \`id\`, \`type\`, \`year\`, \`number\`, \`title\`, \`status\` (\`draft\`/\`final\`/\`revised\`/\`proposed\`), \`extent\` (e.g. \`["E","W","S","NI"]\`), key dates (\`enactmentDate\`/\`madeDate\`), and \`unappliedEffects\` (amendments enacted but not yet applied to the text).

\`unappliedEffects\` and \`upToDate\` are only present for the latest version (no \`version\` parameter). When a specific version is requested, both fields are omitted — effects are not tracked for point-in-time snapshots. For the latest version, \`upToDate\` is \`true\` when all in-force effects have been applied, \`false\` when some are outstanding.

Fragment: pass a \`fragment\` to scope metadata to a specific provision (e.g. \`"section/12"\`, \`"part/2/chapter/1"\`). \`unappliedEffects\` and \`upToDate\` are scoped to the fragment for both revised and enacted/made legislation. Use \`get_legislation_table_of_contents\` to discover valid fragment IDs.

Version: use a date (\`YYYY-MM-DD\`) for a point-in-time snapshot, or \`enacted\`/\`made\`/\`created\`/\`adopted\` for the original version.

For response field details, see \`json://metadata-response\`. For legislation type codes, see \`types://guide\`.
For checking geographical extent, see \`cookbook://check-extent\`. For retrieving historical versions, see \`cookbook://point-in-time-version\`. For determining whether legislation is up to date and which amendments have yet to be applied, see \`cookbook://check-outstanding-effects\`.`;

export const inputSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "Type of legislation (e.g., ukpga, uksi, asp, ukla)",
    },
    year: {
      type: "string",
      description: "Year of enactment. A 4-digit calendar year (e.g., 2020) works for all legislation. For pre-1963 Acts, the canonical identifier uses a regnal year in Reign/Number format (e.g., Vict/63, Geo5/26) — but a calendar year will usually work too, as the API redirects. Use regnal years when you need to disambiguate (a calendar year can span two regnal years). See the years://regnal resource for valid identifiers.",
    },
    number: {
      type: "string",
      description: "Legislation number (e.g., 2, 1234)",
    },
    version: {
      type: "string",
      description: "Optional: Version to retrieve. Use enacted/made/created/adopted for original version, or YYYY-MM-DD for legislation as it stood on that date. Dates before first version return an error.",
    },
    fragment: {
      type: "string",
      description: "Optional: Fragment identifier to scope metadata to a specific provision (e.g. \"section/12\", \"part/2/chapter/1\"). Use get_legislation_table_of_contents to discover valid fragment IDs.",
    },
  },
  required: ["type", "year", "number"],
};

export async function execute(
  args: {
    type: string;
    year: string;
    number: string;
    version?: string;
    fragment?: string;
  },
  client: LegislationClient
) {
  const { type, year, number, version, fragment } = args;

  // Fetch metadata XML — use fragment endpoint when scoping to a specific provision
  const result = fragment
    ? await client.getFragment(type, year, number, fragment, { format: "xml", version })
    : await client.getDocumentMetadata(type, year, number, { version });

  if (result.kind === "disambiguation") {
    return formatDisambiguation(result);
  }

  // Parse to structured JSON
  const parser = new MetadataParser();
  const metadata = parser.parse(result.content);

  // Enacted/made versions (status "final") never contain unapplied effects in
  // the XML, even when outstanding effects exist. When the caller asked for the
  // current version and received an enacted/made version (because no revised
  // version exists yet), fetch effects from the changes API instead.
  if (!version && metadata.status === 'final') {
    try {
      await enrichWithEffects(metadata, client, fragment);
    } catch {
      // Effects search failed — return metadata without effects rather than failing entirely
      metadata.unappliedEffects = undefined;
      metadata.upToDate = undefined;
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2)
      }
    ]
  };
}

/**
 * Fetch all effects targeting this legislation from the changes API and
 * inject them into the metadata, replacing the (empty) XML-derived values.
 * When a fragment is provided, only effects targeting that provision are kept.
 */
async function enrichWithEffects(
  metadata: LegislationMetadata,
  client: LegislationClient,
  fragment?: string
) {
  const effectsParser = new EffectsParser();
  const welsh = metadata.language === 'welsh';
  const allEffects: UnappliedEffect[] = [];
  let page = 1;

  while (true) {
    const xml = await client.searchChanges({
      affectedType: metadata.type,
      affectedYear: String(metadata.year),
      affectedNumber: String(metadata.number),
      page,
    });
    const result = effectsParser.parse(xml, welsh);
    allEffects.push(...result.effects);
    if (!result.meta.morePages) break;
    page++;
  }

  const effects = fragment
    ? filterEffectsForFragment(allEffects, fragment)
    : allEffects;
  metadata.unappliedEffects = effects;
  metadata.upToDate = !effects.some(e => e.outstanding);
}

/**
 * Keep only effects whose target refs overlap with the given fragment.
 * An effect matches if it has no refs (whole-act effect) or any ref
 * is the fragment itself, an ancestor, or a descendant.
 */
export function filterEffectsForFragment(
  effects: UnappliedEffect[],
  fragment: string
): UnappliedEffect[] {
  const elementId = fragment.replace(/\//g, '-');
  return effects.filter(e => effectMatchesFragment(e.target.refs, elementId));
}

/**
 * Check whether a set of provision refs overlaps with a fragment element ID.
 *
 * Returns true if:
 * - refs is undefined (whole-act effect — always relevant)
 * - any section ref overlaps (exact, ancestor, or descendant match)
 * - the fragment falls within any range (inclusive, with proper token ordering)
 */
function effectMatchesFragment(
  refs: ProvisionRef[] | undefined,
  elementId: string
): boolean {
  if (!refs) return true;
  return refs.some(ref => {
    if (ref.type === 'section') {
      // A single section ref is a degenerate range where start === end
      return contains(ref.ref, ref.ref, elementId);
    }
    return contains(ref.start, ref.end, elementId);
  });
}

function formatDisambiguation(result: Extract<LegislationResponse, { kind: "disambiguation" }>) {
  const list = result.alternatives
    .map(a => `- ${a.title} → use year="${a.year}", number="${a.number}"`)
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text: `Ambiguous request: the calendar year matched multiple regnal years. Retry with a specific regnal year:\n${list}`,
        annotations: { audience: ["assistant" as const], priority: 1 },
      },
    ],
  };
}
