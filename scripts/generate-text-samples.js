#!/usr/bin/env node

/**
 * Generate text samples from real legislation for manual inspection.
 *
 * Fetches CLML from legislation.gov.uk, runs it through the parse + serialize
 * pipeline, and writes the text output to samples/. Use this to eyeball output
 * quality after parser or serializer changes.
 *
 * Usage:
 *   npm run build && node scripts/generate-text-samples.js
 *
 * Add --xml to also save the raw CLML alongside each text file.
 * Add --json to also save the parsed Document tree as JSON.
 */

import { LegislationClient } from '../build/api/legislation-client.js';
import { parse } from '../build/parsers/clml-text-parser.js';
import { serializeDocument } from '../build/parsers/clml-text-serializer.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES_DIR = fileURLToPath(new URL('../samples', import.meta.url));

// Representative documents covering different legislation types and structures.
// Each entry: [type, year, number, label, options?]
const DOCUMENTS = [
  // Primary — compact Act with Parts, cross-headings, schedules
  ['ukpga', '1968', '60', 'theft-act-1968'],

  // Primary — modern Act with P1groups
  ['ukpga', '2010', '15', 'equality-act-2010'],

  // Secondary — SI with MadeDate, LaidDate, ComingIntoForce
  ['uksi', '2024', '1085', 'si-2024-1085'],

  // EU retained — MultilineTitle, EUPreamble, Divisions, Articles
  ['eur', '2016', '679', 'eu-gdpr-2016-679'],
];

// A few fragments to test fragment rendering.
const FRAGMENTS = [
  ['ukpga', '1968', '60', 'section/1', 'theft-act-s1'],
  ['ukpga', '2010', '15', 'part/2/chapter/1', 'equality-act-pt2-ch1'],
];

const saveXml = process.argv.includes('--xml');
const saveJson = process.argv.includes('--json');

async function main() {
  mkdirSync(SAMPLES_DIR, { recursive: true });

  const client = new LegislationClient();
  let ok = 0;
  let failed = 0;

  // Full documents
  for (const [type, year, number, label] of DOCUMENTS) {
    process.stdout.write(`${label} ... `);
    try {
      const result = await client.getDocument(type, year, number, { format: 'xml' });
      if (result.kind !== 'document') {
        console.log('disambiguation (skipped)');
        continue;
      }
      const doc = parse(result.content);
      const text = serializeDocument(doc);
      writeFileSync(join(SAMPLES_DIR, `${label}.txt`), text + '\n');
      if (saveXml) {
        writeFileSync(join(SAMPLES_DIR, `${label}.xml`), result.content);
      }
      if (saveJson) {
        writeFileSync(join(SAMPLES_DIR, `${label}.json`), JSON.stringify(doc, null, 2) + '\n');
      }
      console.log(`${text.length} chars`);
      ok++;
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failed++;
    }
  }

  // Fragments
  for (const [type, year, number, fragmentId, label] of FRAGMENTS) {
    process.stdout.write(`${label} ... `);
    try {
      const result = await client.getFragment(type, year, number, fragmentId, { format: 'xml' });
      if (result.kind !== 'document') {
        console.log('disambiguation (skipped)');
        continue;
      }
      const doc = parse(result.content);
      const text = serializeDocument(doc);
      writeFileSync(join(SAMPLES_DIR, `${label}.txt`), text + '\n');
      if (saveXml) {
        writeFileSync(join(SAMPLES_DIR, `${label}.xml`), result.content);
      }
      if (saveJson) {
        writeFileSync(join(SAMPLES_DIR, `${label}.json`), JSON.stringify(doc, null, 2) + '\n');
      }
      console.log(`${text.length} chars`);
      ok++;
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} samples written to samples/, ${failed} failed`);
}

main();
