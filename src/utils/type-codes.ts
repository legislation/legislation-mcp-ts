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
for (const type of typesData.types) {
  longToShortTypeMap.set(type.longName, type.shortCode);
}
