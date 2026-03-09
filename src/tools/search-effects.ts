/**
 * Tool: search_effects
 *
 * Search for legislative effects by source (affecting) and/or target (affected) legislation.
 */

import { LegislationClient } from "../api/legislation-client.js";
import { EffectsParser, EffectsResponse } from "../parsers/effects-parser.js";

export const name = "search_effects";

export const description = `Search for legislative effects (amendments, repeals, insertions, etc.) by source and/or target legislation.

Use source parameters to find effects made BY a piece of legislation (e.g. "what did Act X amend?").
Use target parameters to find effects made TO a piece of legislation (e.g. "what amends Act Y?").
You can combine both to find specific effects between two pieces of legislation.

For step-by-step examples, see \`cookbook://search-effects\`. For legislation type codes, see \`types://guide\`.`;

export const inputSchema = {
  type: "object",
  properties: {
    sourceType: {
      type: "string",
      description: "Type of the affecting (source) legislation (e.g., ukpga, uksi)",
    },
    sourceYear: {
      type: "string",
      description: "Year of the affecting (source) legislation",
    },
    sourceNumber: {
      type: "string",
      description: "Number of the affecting (source) legislation",
    },
    targetType: {
      type: "string",
      description: "Type of the affected (target) legislation (e.g., ukpga, uksi)",
    },
    targetYear: {
      type: "string",
      description: "Year of the affected (target) legislation",
    },
    targetNumber: {
      type: "string",
      description: "Number of the affected (target) legislation",
    },
    page: {
      type: "number",
      description: "Page number for paginated results (default: 1)",
    },
  },
  required: [],
};

export const outputSchema = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      description: "Pagination metadata",
      properties: {
        totalResults: { type: "number", description: "Total number of matching effects" },
        page: { type: "number", description: "Current page number" },
        itemsPerPage: { type: "number", description: "Number of effects per page" },
        morePages: { type: "boolean", description: "Whether more pages are available" },
      },
      required: ["page", "itemsPerPage", "morePages"],
    },
    effects: {
      type: "array",
      description: "List of legislative effects",
      items: {
        type: "object",
        properties: {
          type: { type: "string", description: "Effect type (e.g. 'substituted', 'words repealed', 'inserted')" },
          applied: { type: "boolean", description: "Whether this effect has been applied to the English revised text" },
          required: { type: "boolean", description: "Whether English application is required" },
          appliedWelsh: { type: "boolean", description: "Whether this effect has been applied to the Welsh revised text" },
          requiredWelsh: { type: "boolean", description: "Whether Welsh application is required" },
          notes: { type: "string" },
          target: {
            type: "object",
            description: "Affected (target) legislation",
            properties: {
              id: { type: "string", description: "e.g. 'ukpga/2024/10'" },
              type: { type: "string" },
              year: { type: "number" },
              number: { type: "number" },
              title: { type: "string" },
              provisions: { type: "string", description: "e.g. 's. 12(7)(a)'" },
              extent: { type: "array", items: { type: "string" }, description: "e.g. ['E','W','S']" },
            },
            required: ["id", "type", "year", "number", "title"],
          },
          source: {
            type: "object",
            description: "Affecting (source) legislation",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              year: { type: "number" },
              number: { type: "number" },
              title: { type: "string" },
              provisions: { type: "string" },
              extent: { type: "array", items: { type: "string" } },
            },
            required: ["id", "type", "year", "number", "title"],
          },
          commencement: { type: "string", description: "Commencement authority text" },
          inForce: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string", description: "ISO date string" },
                description: { type: "string", description: "Qualification text" },
              },
            },
          },
        },
        required: ["type", "applied", "required", "target", "source", "inForce"],
      },
    },
  },
  required: ["meta", "effects"],
};

export async function execute(
  args: {
    sourceType?: string;
    sourceYear?: string;
    sourceNumber?: string;
    targetType?: string;
    targetYear?: string;
    targetNumber?: string;
    page?: number;
  },
  client: LegislationClient
) {
  const { sourceType, sourceYear, sourceNumber, targetType, targetYear, targetNumber, page } = args;

  const hasAnyParam = sourceType || sourceYear || sourceNumber || targetType || targetYear || targetNumber;

  if (!hasAnyParam) {
    return {
      content: [
        {
          type: "text" as const,
          text: "At least one source or target parameter must be provided.",
        },
      ],
      isError: true,
    };
  }

  const xml = await client.searchChanges({
    affectingType: sourceType,
    affectingYear: sourceYear,
    affectingNumber: sourceNumber,
    affectedType: targetType,
    affectedYear: targetYear,
    affectedNumber: targetNumber,
    page,
  });

  const parser = new EffectsParser();
  const result = parser.parse(xml);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}
