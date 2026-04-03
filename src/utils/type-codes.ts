/**
 * Shared lookup map: legislation long type name → short code
 *
 * e.g. "UnitedKingdomPublicGeneralAct" → "ukpga"
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const typesDataPath = join(__dirname, '..', 'resources', 'types', 'data.json');
const typesData = JSON.parse(readFileSync(typesDataPath, 'utf-8'));

export const longToShortTypeMap = new Map<string, string>();
const shortToFirstVersionMap = new Map<string, string>();
for (const type of typesData.types) {
  longToShortTypeMap.set(type.longName, type.shortCode);
  shortToFirstVersionMap.set(type.shortCode, type.firstVersion);
}

/** Return the first-version keyword for a short type code (e.g. "ukpga" → "enacted"). */
export function getFirstVersion(shortType: string): string | undefined {
  return shortToFirstVersionMap.get(shortType);
}
