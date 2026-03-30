/**
 * Shared helpers for checking whether legislation text is up to date.
 *
 * - getUpToDateCallout: generates a callout block for plain-text responses
 * - fetchAllEffects: paginated fetch of all effects from the changes API
 *   (used by both the callout and the metadata tool)
 */

import { LegislationClient } from "../api/legislation-client.js";
import { EffectsParser } from "../parsers/effects-parser.js";
import { MetadataParser, UnappliedEffect } from "../parsers/metadata-parser.js";
import { filterEffectsForFragment } from "./get-legislation-metadata.js";

/**
 * Check whether the legislation XML is up to date and return a callout
 * content block if it is not. Returns undefined when up to date or when
 * the check cannot be performed (e.g. a specific version was requested).
 */
export async function getUpToDateCallout(
  xml: string,
  version: string | undefined,
  client: LegislationClient,
  fragment?: string
): Promise<{ type: "text"; text: string } | undefined> {
  if (version) return undefined;

  const parser = new MetadataParser();
  const metadata = parser.parse(xml);

  let effects = metadata.unappliedEffects;

  // Enacted/made documents (status "final") don't include unapplied effects
  // in their XML. If the latest response is still the original text, no revised
  // version exists yet, so there cannot be any already-applied effects: anything
  // returned by /changes is necessarily still unapplied to the text.
  // Fetch from the changes API instead.
  if (metadata.status === 'final') {
    try {
      effects = await fetchAllEffects(metadata, client);
    } catch {
      return undefined;
    }
  }

  if (!effects) return undefined;

  if (fragment) {
    effects = filterEffectsForFragment(effects, fragment);
  }

  const upToDate = !effects.some(e => e.outstanding);
  if (upToDate) return undefined;

  return {
    type: "text",
    text: `> [!NOTE]\n> There are effects in force that have not yet been reflected in this text. Use the \`search_effects\` tool with \`applied: false\` to see unapplied effects affecting this legislation.`,
  };
}

/**
 * Fetch all effects targeting a piece of legislation from the changes API,
 * paginating through all result pages.
 */
export async function fetchAllEffects(
  metadata: { type: string; year: number; number: number; language?: string },
  client: LegislationClient
): Promise<UnappliedEffect[]> {
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

  return allEffects;
}
