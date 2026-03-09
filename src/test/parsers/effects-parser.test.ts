/**
 * Tests for EffectsParser
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { EffectsParser } from '../../parsers/effects-parser.js';

const SAMPLE_EFFECTS_FEED = `
<feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
    xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
    xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
    <updated>2026-03-07T00:54:43Z</updated>
    <openSearch:itemsPerPage>50</openSearch:itemsPerPage>
    <openSearch:startIndex>1</openSearch:startIndex>
    <leg:page>1</leg:page>
    <leg:morePages>5</leg:morePages>
    <openSearch:totalResults>280</openSearch:totalResults>
    <entry>
        <content type="text/xml">
            <ukm:Effect
                Type="substituted"
                Applied="false"
                RequiresApplied="true"
                AffectedClass="UnitedKingdomPublicGeneralAct"
                AffectedYear="2020"
                AffectedNumber="7"
                AffectedProvisions="s. 18(3)"
                AffectedURI="http://www.legislation.gov.uk/id/ukpga/2020/7"
                AffectingClass="UnitedKingdomPublicGeneralAct"
                AffectingYear="2024"
                AffectingNumber="1"
                AffectingProvisions="s. 10"
                AffectingURI="http://www.legislation.gov.uk/id/ukpga/2024/1"
                EffectId="key-abc123">
                <ukm:AffectedTitle>Coronavirus Act 2020</ukm:AffectedTitle>
                <ukm:AffectingTitle>Some Act 2024</ukm:AffectingTitle>
                <ukm:InForceDates>
                    <ukm:InForce Date="2024-06-01" Qualification="wholly in force"/>
                </ukm:InForceDates>
            </ukm:Effect>
        </content>
        <title>Some Act 2024 effect on Coronavirus Act 2020</title>
        <updated>2026-03-06T15:41:50Z</updated>
    </entry>
</feed>
`;

test('EffectsParser parses feed with a single effect', () => {
  const parser = new EffectsParser();
  const result = parser.parse(SAMPLE_EFFECTS_FEED);

  assert.strictEqual(result.effects.length, 1);

  const effect = result.effects[0];
  assert.strictEqual(effect.type, 'substituted');
  assert.strictEqual(effect.applied, false);
  assert.strictEqual(effect.required, true);
  assert.strictEqual(effect.target.id, 'ukpga/2020/7');
  assert.strictEqual(effect.target.title, 'Coronavirus Act 2020');
  assert.strictEqual(effect.target.provisions, 's. 18(3)');
  assert.strictEqual(effect.source.id, 'ukpga/2024/1');
  assert.strictEqual(effect.source.title, 'Some Act 2024');
  assert.strictEqual(effect.source.provisions, 's. 10');
  assert.strictEqual(effect.inForce.length, 1);
  assert.strictEqual(effect.inForce[0].date, '2024-06-01');
  assert.strictEqual(effect.inForce[0].description, 'wholly in force');
});

test('EffectsParser extracts pagination metadata', () => {
  const parser = new EffectsParser();
  const result = parser.parse(SAMPLE_EFFECTS_FEED);

  assert.strictEqual(result.meta.totalResults, 280);
  assert.strictEqual(result.meta.page, 1);
  assert.strictEqual(result.meta.itemsPerPage, 50);
  assert.strictEqual(result.meta.morePages, true);
});

test('EffectsParser omits outstanding field', () => {
  const parser = new EffectsParser();
  const result = parser.parse(SAMPLE_EFFECTS_FEED);

  assert.strictEqual(result.effects[0].outstanding, undefined, 'outstanding should not be set for effects search');
});

test('EffectsParser omits Welsh fields when attributes absent', () => {
  const parser = new EffectsParser();
  const result = parser.parse(SAMPLE_EFFECTS_FEED);

  const effect = result.effects[0];
  assert.strictEqual(effect.appliedWelsh, undefined, 'appliedWelsh should be undefined when WelshApplied attr is absent');
  assert.strictEqual(effect.requiredWelsh, undefined, 'requiredWelsh should be undefined when RequiresWelshApplied attr is absent');
});

const WELSH_EFFECTS_FEED = `
<feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
    xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
    xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
    <updated>2026-03-07T00:54:43Z</updated>
    <openSearch:itemsPerPage>50</openSearch:itemsPerPage>
    <openSearch:startIndex>1</openSearch:startIndex>
    <leg:page>1</leg:page>
    <leg:morePages>0</leg:morePages>
    <openSearch:totalResults>1</openSearch:totalResults>
    <entry>
        <content type="text/xml">
            <ukm:Effect
                Type="coming into force"
                Applied="false"
                RequiresApplied="true"
                WelshApplied="false"
                RequiresWelshApplied="true"
                AffectedClass="WelshParliamentAct"
                AffectedYear="2024"
                AffectedNumber="6"
                AffectedProvisions="s. 18(1)"
                AffectedURI="http://www.legislation.gov.uk/id/asc/2024/6"
                AffectedExtent="E+W"
                AffectingClass="WelshStatutoryInstrument"
                AffectingYear="2026"
                AffectingNumber="14"
                AffectingProvisions="art. 2"
                AffectingURI="http://www.legislation.gov.uk/id/wsi/2026/14"
                EffectId="key-dd387">
                <ukm:AffectedTitle>Local Government Finance (Wales) Act 2024</ukm:AffectedTitle>
                <ukm:AffectedTitle xml:lang="cy">Deddf Cyllid Llywodraeth Leol (Cymru) 2024</ukm:AffectedTitle>
                <ukm:AffectingTitle>The Local Government Finance (Wales) Act 2024 (Commencement No. 1) Order 2026</ukm:AffectingTitle>
                <ukm:AffectingTitle xml:lang="cy">Gorchymyn Deddf Cyllid Llywodraeth Leol (Cymru) 2024 (Cychwyn Rhif 1) 2026</ukm:AffectingTitle>
                <ukm:InForceDates>
                    <ukm:InForce Applied="false" WelshApplied="false" Date="2026-04-01" Qualification="wholly in force"/>
                </ukm:InForceDates>
            </ukm:Effect>
        </content>
        <title>Commencement effect</title>
        <updated>2026-01-29T12:29:15Z</updated>
    </entry>
</feed>
`;

test('EffectsParser includes Welsh fields when attributes present', () => {
  const parser = new EffectsParser();
  const result = parser.parse(WELSH_EFFECTS_FEED);

  const effect = result.effects[0];
  assert.strictEqual(effect.applied, false);
  assert.strictEqual(effect.required, true);
  assert.strictEqual(effect.appliedWelsh, false);
  assert.strictEqual(effect.requiredWelsh, true);
});

test('EffectsParser picks English title from bilingual entries', () => {
  const parser = new EffectsParser();
  const result = parser.parse(WELSH_EFFECTS_FEED);

  const effect = result.effects[0];
  assert.strictEqual(effect.target.title, 'Local Government Finance (Wales) Act 2024');
  assert.strictEqual(effect.source.title, 'The Local Government Finance (Wales) Act 2024 (Commencement No. 1) Order 2026');
});

test('EffectsParser handles single language-tagged titles (no English)', () => {
  const feed = `
    <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
        <openSearch:itemsPerPage>50</openSearch:itemsPerPage>
        <openSearch:startIndex>1</openSearch:startIndex>
        <leg:page>1</leg:page>
        <leg:morePages>0</leg:morePages>
        <entry>
            <content type="text/xml">
                <ukm:Effect
                    Type="amended"
                    Applied="true"
                    RequiresApplied="true"
                    AffectedClass="WelshParliamentAct"
                    AffectedYear="2024"
                    AffectedNumber="6"
                    AffectedURI="http://www.legislation.gov.uk/id/asc/2024/6"
                    AffectingClass="WelshStatutoryInstrument"
                    AffectingYear="2026"
                    AffectingNumber="14"
                    AffectingURI="http://www.legislation.gov.uk/id/wsi/2026/14"
                    EffectId="key-xyz">
                    <ukm:AffectedTitle xml:lang="cy">Deddf Cymraeg</ukm:AffectedTitle>
                    <ukm:AffectingTitle xml:lang="cy">Teitl Cymraeg</ukm:AffectingTitle>
                    <ukm:InForceDates/>
                </ukm:Effect>
            </content>
            <title>Test</title>
            <updated>2026-01-01T00:00:00Z</updated>
        </entry>
    </feed>
  `;

  const parser = new EffectsParser();
  const result = parser.parse(feed);

  assert.strictEqual(typeof result.effects[0].target.title, 'string', 'Title should be a string even when language-tagged');
  assert.strictEqual(result.effects[0].target.title, 'Deddf Cymraeg', 'Should extract text from language-tagged title');
  assert.strictEqual(typeof result.effects[0].source.title, 'string', 'Source title should be a string even when language-tagged');
  assert.strictEqual(result.effects[0].source.title, 'Teitl Cymraeg', 'Should extract text from language-tagged source title');
});

test('EffectsParser handles empty feed', () => {
  const emptyFeed = `
    <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
        xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">
        <openSearch:itemsPerPage>50</openSearch:itemsPerPage>
        <openSearch:startIndex>1</openSearch:startIndex>
        <leg:page>1</leg:page>
        <leg:morePages>0</leg:morePages>
        <openSearch:totalResults>0</openSearch:totalResults>
    </feed>
  `;

  const parser = new EffectsParser();
  const result = parser.parse(emptyFeed);

  assert.strictEqual(result.effects.length, 0);
  assert.strictEqual(result.meta.totalResults, 0);
  assert.strictEqual(result.meta.morePages, false);
});
