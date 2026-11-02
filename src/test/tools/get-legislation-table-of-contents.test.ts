/**
 * Tests for get_legislation_table_of_contents: the effects on the current text
 */

import { test } from 'node:test';
import assert from 'node:assert';
import * as toc from '../../tools/get-legislation-table-of-contents.js';
import { changesFeed, effectXml, payload } from '../helpers/metadata-payload.js';

const CONTENTS = `
<Contents>
  <ContentsItem IdURI="http://www.legislation.gov.uk/id/ukpga/2024/1/section/1">
    <ContentsNumber>1</ContentsNumber>
    <ContentsTitle>Short title</ContentsTitle>
  </ContentsItem>
</Contents>`;

const ENACTED = payload({ links: '', content: CONTENTS, status: 'final' });

/**
 * The response to a request for the contents of ukpga/2024/1, whose payload is
 * `xml`, when the changes API returns `feed` or fails; and whether it was searched.
 */
async function contentsFrom(args: { format?: 'json' | 'xml'; version?: string }, xml: string, feed?: string) {
  let searched = false;
  const client = {
    getTableOfContents: async () => ({ kind: 'document' as const, content: xml }),
    searchChanges: async () => {
      searched = true;
      if (feed === undefined) throw new Error('changes API unavailable');
      return feed;
    },
  };
  const result = await toc.execute({ type: 'ukpga', year: '2024', number: '1', ...args }, client as any);
  return { result, searched };
}

/** `meta.upToDate`, and how many `meta.unappliedEffects` there are, in a JSON response. */
function effectsIn(result: any) {
  const { meta } = JSON.parse(result.content[0].text);
  return { upToDate: meta.upToDate, effects: meta.unappliedEffects?.length };
}

test('execute reports an outstanding effect on enacted contents', async () => {
  const { result, searched } = await contentsFrom({}, ENACTED, changesFeed([effectXml('Effect', 'section/1')]));
  assert.deepStrictEqual(effectsIn(result), { upToDate: false, effects: 1 });
  assert.strictEqual(searched, true);
});

test('execute finds enacted contents up to date when there are no effects', async () => {
  const { result } = await contentsFrom({}, ENACTED, changesFeed([]));
  assert.deepStrictEqual(effectsIn(result), { upToDate: true, effects: 0 });
});

test('execute leaves out the effects on enacted contents when they cannot be fetched', async () => {
  const { result, searched } = await contentsFrom({}, ENACTED);
  assert.deepStrictEqual(effectsIn(result), { upToDate: undefined, effects: undefined });
  assert.strictEqual(searched, true);
  assert.strictEqual(result.isError, undefined);
  assert.strictEqual(JSON.parse(result.content[0].text).contents.body.length, 1);
});

test('execute takes the effects on revised contents from the payload', async () => {
  const xml = payload({ links: '', content: CONTENTS, effects: effectXml('UnappliedEffect', 'section/1') });
  const { result, searched } = await contentsFrom({}, xml);
  assert.deepStrictEqual(effectsIn(result), { upToDate: false, effects: 1 });
  assert.strictEqual(searched, false);
});

test('execute leaves out the effects on versioned contents', async () => {
  const { result, searched } = await contentsFrom({ version: 'enacted' }, ENACTED, changesFeed([]));
  assert.deepStrictEqual(effectsIn(result), { upToDate: undefined, effects: undefined });
  assert.strictEqual(searched, false);
});

test('execute fetches no effects for contents in another format', async () => {
  const { result, searched } = await contentsFrom({ format: 'xml' }, ENACTED, changesFeed([]));
  assert.strictEqual(result.content[0].text, ENACTED);
  assert.strictEqual(searched, false);
});
