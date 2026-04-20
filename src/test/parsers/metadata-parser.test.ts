/**
 * Tests for MetadataParser
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { MetadataParser } from '../../parsers/metadata-parser.js';

const SAMPLE_METADATA_XML = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2"
    RestrictExtent="E+W+S+N.I.">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2</dc:identifier>
        <dc:title>Direct Payments to Farmers (Legislative Continuity) Act 2020</dc:title>
        <dc:description>An Act to make provision for the incorporation of the Direct Payments
            Regulation into domestic law; for enabling an increase in the total maximum amount of
            direct payments under that Regulation; and for connected purposes.</dc:description>
        <dc:language>en</dc:language>
        <dc:publisher>Statute Law Database</dc:publisher>
        <dc:modified>2024-03-02</dc:modified>
        <dc:contributor>Expert Participation</dc:contributor>
        <dct:valid>2024-01-01</dct:valid>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentCategory Value="primary"/>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
            <ukm:EnactmentDate Date="2020-01-30"/>
            <ukm:ISBN Value="9780105700746"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

test('MetadataParser parses primary legislation metadata', () => {
  const parser = new MetadataParser();
  const result = parser.parse(SAMPLE_METADATA_XML);

  assert.strictEqual(result.id, 'ukpga/2020/2', 'Should extract simplified id');
  assert.strictEqual(result.type, 'ukpga', 'Should extract type code');
  assert.strictEqual(result.year, 2020, 'Should extract year as number');
  assert.strictEqual(result.number, 2, 'Should extract number as number');
  assert.strictEqual(result.title, 'Direct Payments to Farmers (Legislative Continuity) Act 2020', 'Should extract title');
  assert.strictEqual(result.status, 'revised', 'Should extract document status');
  assert.deepStrictEqual(result.extent, ['E', 'W', 'S', 'NI'], 'Should normalize extent (N.I. → NI)');
  assert.strictEqual(result.enactmentDate, '2020-01-30', 'Should extract enactment date');
  assert.strictEqual(result.madeDate, undefined, 'Should not have madeDate for primary legislation');
});

test('MetadataParser handles extent normalization', () => {
  const parser = new MetadataParser();
  const xmlWithNI = SAMPLE_METADATA_XML.replace('RestrictExtent="E+W+S+N.I."', 'RestrictExtent="N.I."');

  const result = parser.parse(xmlWithNI);
  assert.deepStrictEqual(result.extent, ['NI'], 'Should normalize N.I. to NI');
});

test('MetadataParser handles missing extent', () => {
  const parser = new MetadataParser();
  const xmlWithoutExtent = SAMPLE_METADATA_XML.replace('RestrictExtent="E+W+S+N.I."', '');

  const result = parser.parse(xmlWithoutExtent);
  assert.strictEqual(result.extent, undefined, 'Should handle missing extent');
});

test('MetadataParser decodes standard XML entities in metadata title', () => {
  const parser = new MetadataParser();
  const xmlWithEntities = SAMPLE_METADATA_XML.replace(
    'Direct Payments to Farmers (Legislative Continuity) Act 2020',
    'Direct Payments &amp; Farmers &lt;Continuity&gt; Act 2020'
  );

  const result = parser.parse(xmlWithEntities);
  assert.strictEqual(result.title, 'Direct Payments & Farmers <Continuity> Act 2020');
});

test('MetadataParser strips id prefix correctly', () => {
  const parser = new MetadataParser();

  // Test with http:// prefix
  let result = parser.parse(SAMPLE_METADATA_XML);
  assert.strictEqual(result.id, 'ukpga/2020/2', 'Should strip http://www.legislation.gov.uk/ prefix');

  // Test with https:// prefix (also valid)
  const httpsXml = SAMPLE_METADATA_XML.replace('http://www.legislation.gov.uk/', 'https://www.legislation.gov.uk/');
  result = parser.parse(httpsXml);
  assert.strictEqual(result.id, 'ukpga/2020/2', 'Should strip https://www.legislation.gov.uk/ prefix');

  // Test with id/ in the path
  const idXml = SAMPLE_METADATA_XML.replace(
    'DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2"',
    'DocumentURI="http://www.legislation.gov.uk/id/ukpga/2020/2"'
  );
  result = parser.parse(idXml);
  assert.strictEqual(result.id, 'ukpga/2020/2', 'Should strip http://www.legislation.gov.uk/id/ prefix');
});

const XML_WITH_EFFECTS = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
            <ukm:UnappliedEffects>
                <ukm:UnappliedEffect Type="substituted" AffectedURI="http://www.legislation.gov.uk/ukpga/2020/2" AffectedClass="UnitedKingdomPublicGeneralAct" AffectedYear="2020" AffectedNumber="2" AffectedProvisions="s. 1" AffectingURI="http://www.legislation.gov.uk/ukpga/2024/1" AffectingClass="UnitedKingdomPublicGeneralAct" AffectingYear="2024" AffectingNumber="1" AffectingProvisions="s. 10" Applied="false" RequiresApplied="true">
                    <ukm:AffectedTitle>Act 2020</ukm:AffectedTitle>
                    <ukm:AffectingTitle>Act 2024</ukm:AffectingTitle>
                    <ukm:InForceDates>
                        <ukm:InForce Date="2020-01-01" Applied="false"/>
                    </ukm:InForceDates>
                </ukm:UnappliedEffect>
                <ukm:UnappliedEffect Type="repealed" AffectedURI="http://www.legislation.gov.uk/ukpga/2020/2" AffectedClass="UnitedKingdomPublicGeneralAct" AffectedYear="2020" AffectedNumber="2" AffectedProvisions="s. 2" AffectingURI="http://www.legislation.gov.uk/ukpga/2024/1" AffectingClass="UnitedKingdomPublicGeneralAct" AffectingYear="2024" AffectingNumber="1" AffectingProvisions="s. 11" Applied="false" RequiresApplied="true">
                    <ukm:AffectedTitle>Act 2020</ukm:AffectedTitle>
                    <ukm:AffectingTitle>Act 2024</ukm:AffectingTitle>
                    <ukm:InForceDates>
                        <ukm:InForce Applied="false" Prospective="true"/>
                    </ukm:InForceDates>
                </ukm:UnappliedEffect>
            </ukm:UnappliedEffects>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

test('MetadataParser parses unapplied effects and identifies outstanding ones', () => {
  const parser = new MetadataParser();
  const result = parser.parse(XML_WITH_EFFECTS);

  assert.strictEqual(result.upToDate, false, 'Should not be up to date because of outstanding effect');
  assert.strictEqual(result.unappliedEffects?.length, 2, 'Should have 2 unapplied effects');

  const outstanding = result.unappliedEffects?.[0];
  assert.strictEqual(outstanding?.type, 'substituted');
  assert.strictEqual(outstanding?.outstanding, true, 'First effect should be outstanding (past date)');
  assert.strictEqual(outstanding?.target.provisions, 's. 1');
  assert.strictEqual(outstanding?.source.id, 'ukpga/2024/1');

  const prospective = result.unappliedEffects?.[1];
  assert.strictEqual(prospective?.type, 'repealed');
  assert.strictEqual(prospective?.outstanding, false, 'Prospective effect should not be outstanding');
});

test('MetadataParser uses Welsh effect titles for Welsh documents', () => {
  const parser = new MetadataParser();
  const welshXml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/asc/2024/6/welsh">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="WelshParliamentAct"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2024"/>
            <ukm:Number Value="6"/>
            <ukm:UnappliedEffects>
                <ukm:UnappliedEffect Type="coming into force" AffectedURI="http://www.legislation.gov.uk/id/asc/2024/6" AffectedClass="WelshParliamentAct" AffectedYear="2024" AffectedNumber="6" AffectedProvisions="s. 18(1)" AffectingURI="http://www.legislation.gov.uk/id/wsi/2026/14" AffectingClass="WelshStatutoryInstrument" AffectingYear="2026" AffectingNumber="14" AffectingProvisions="art. 2" Applied="false" RequiresApplied="true" WelshApplied="false" RequiresWelshApplied="true">
                    <ukm:AffectedTitle>Local Government Finance (Wales) Act 2024</ukm:AffectedTitle>
                    <ukm:AffectedTitle xml:lang="cy">Deddf Cyllid Llywodraeth Leol (Cymru) 2024</ukm:AffectedTitle>
                    <ukm:AffectingTitle>The Commencement Order 2026</ukm:AffectingTitle>
                    <ukm:AffectingTitle xml:lang="cy">Y Gorchymyn Cychwyn 2026</ukm:AffectingTitle>
                    <ukm:InForceDates>
                        <ukm:InForce Applied="false" WelshApplied="false" Date="2026-04-01" Qualification="wholly in force"/>
                    </ukm:InForceDates>
                </ukm:UnappliedEffect>
            </ukm:UnappliedEffects>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(welshXml);
  assert.strictEqual(result.language, 'welsh');

  const effect = result.unappliedEffects?.[0];
  assert.strictEqual(effect?.target.title, 'Deddf Cyllid Llywodraeth Leol (Cymru) 2024', 'Should use Welsh target title');
  assert.strictEqual(effect?.source.title, 'Y Gorchymyn Cychwyn 2026', 'Should use Welsh source title');
  assert.strictEqual(effect?.applied, false, 'applied should use WelshApplied');
  assert.strictEqual(effect?.required, true, 'required should use RequiresWelshApplied');
  assert.strictEqual(effect?.appliedWelsh, undefined, 'appliedWelsh should not be set in document context');
  assert.strictEqual(effect?.requiredWelsh, undefined, 'requiredWelsh should not be set in document context');
});

test('MetadataParser parses structured provision refs from AffectedProvisions elements', () => {
  const parser = new MetadataParser();
  const xmlWithRefs = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
            <ukm:UnappliedEffects>
                <ukm:UnappliedEffect Type="substituted" AffectedURI="http://www.legislation.gov.uk/ukpga/2020/2" AffectedClass="UnitedKingdomPublicGeneralAct" AffectedYear="2020" AffectedNumber="2" AffectedProvisions="s. 1(2)(a)" AffectingURI="http://www.legislation.gov.uk/ukpga/2024/1" AffectingClass="UnitedKingdomPublicGeneralAct" AffectingYear="2024" AffectingNumber="1" AffectingProvisions="s. 10" Applied="false" RequiresApplied="true">
                    <ukm:AffectedProvisions>
                        <ukm:Section Ref="section-1-2-a" URI="http://www.legislation.gov.uk/ukpga/2020/2/section/1/2/a">s. 1(2)(a)</ukm:Section>
                    </ukm:AffectedProvisions>
                    <ukm:AffectingProvisions>
                        <ukm:Section Ref="section-10" URI="http://www.legislation.gov.uk/ukpga/2024/1/section/10">s. 10</ukm:Section>
                    </ukm:AffectingProvisions>
                    <ukm:AffectedTitle>Act 2020</ukm:AffectedTitle>
                    <ukm:AffectingTitle>Act 2024</ukm:AffectingTitle>
                    <ukm:InForceDates>
                        <ukm:InForce Date="2024-06-01" Applied="false"/>
                    </ukm:InForceDates>
                </ukm:UnappliedEffect>
            </ukm:UnappliedEffects>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xmlWithRefs);
  const effect = result.unappliedEffects?.[0];

  assert.strictEqual(effect?.target.provisions, 's. 1(2)(a)', 'Should still have plain text provisions');
  assert.deepStrictEqual(effect?.target.refs, [{ type: 'section', ref: 'section-1-2-a' }], 'Should parse AffectedProvisions Section ref');
  assert.deepStrictEqual(effect?.source.refs, [{ type: 'section', ref: 'section-10' }], 'Should parse AffectingProvisions Section ref');
});

test('MetadataParser parses SectionRange provision refs', () => {
  const parser = new MetadataParser();
  const effect = parser.convertEffect({
    '@_Type': 'substituted',
    '@_Applied': 'false',
    '@_RequiresApplied': 'true',
    '@_AffectedURI': 'http://www.legislation.gov.uk/ukpga/2020/2',
    '@_AffectedClass': 'UnitedKingdomPublicGeneralAct',
    '@_AffectedYear': '2020',
    '@_AffectedNumber': '2',
    '@_AffectedProvisions': 'ss. 1-3',
    AffectedProvisions: {
      SectionRange: {
        '@_URI': 'http://www.legislation.gov.uk/id/ukpga/2020/2/section/1',
        '@_UpTo': 'http://www.legislation.gov.uk/id/ukpga/2020/2/section/3',
      },
    },
    '@_AffectingURI': 'http://www.legislation.gov.uk/ukpga/2024/1',
    '@_AffectingClass': 'UnitedKingdomPublicGeneralAct',
    '@_AffectingYear': '2024',
    '@_AffectingNumber': '1',
    '@_AffectingProvisions': 's. 10',
    AffectedTitle: 'Act 2020',
    AffectingTitle: 'Act 2024',
    InForceDates: {},
  }, false, '2024-01-01');

  assert.deepStrictEqual(effect.target.refs, [{ type: 'range', start: 'section-1', end: 'section-3' }]);
  assert.strictEqual(effect.source.refs, undefined, 'No refs when AffectingProvisions element is absent');
});

// --- Versions extraction tests ---

const REVISED_WITH_VERSIONS_XML = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2"
    RestrictExtent="E+W+S+N.I.">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:title>Test Act 2020</dc:title>
        <dct:valid>2024-01-01</dct:valid>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2020-01-30" title="2020-01-30"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2022-06-01" title="2022-06-01"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2" title="current"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

test('MetadataParser extracts sorted versions from hasVersion links', () => {
  const parser = new MetadataParser();
  const result = parser.parse(REVISED_WITH_VERSIONS_XML);

  assert.deepStrictEqual(result.versions, [
    'enacted', '2020-01-30', '2022-06-01'
  ], 'Should include hasVersion titles with "current" stripped, sorted');
});

test('MetadataParser ensures first-version keyword for final documents', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2" title="current"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2024-01-01" title="2024-01-01"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="final"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.deepStrictEqual(result.versions, ['enacted', '2024-01-01'],
    'Should add "enacted" for final ukpga');
});

test('MetadataParser synthesizes "prospective" for final secondary legislation with only "current"', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/uksi/2020/100">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/uksi/2020/100" title="current"/>
        <ukm:SecondaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomStatutoryInstrument"/>
                <ukm:DocumentStatus Value="final"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="100"/>
        </ukm:SecondaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.deepStrictEqual(result.versions, ['made', 'prospective'],
    'Should add "made" and synthesized "prospective" for final uksi with only "current"');
});

test('MetadataParser synthesizes "prospective" for final document with only "current"', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2" title="current"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="final"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.deepStrictEqual(result.versions, ['enacted', 'prospective'],
    'Should add first-version keyword and synthesized "prospective"');
});

test('MetadataParser strips " repealed" suffix from version labels', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2024-01-01" title="2024-01-01 repealed"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2" title="current"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.ok(result.versions?.includes('2024-01-01'), 'Should strip " repealed" suffix');
  assert.ok(!result.versions?.some(v => v.includes('repealed')), 'No version should contain "repealed"');
});

test('MetadataParser sets prospective from Status attribute', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2026/8"
    Status="Prospective">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dct:valid>2026-03-05</dct:valid>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2026/8/enacted" title="enacted"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2026"/>
            <ukm:Number Value="8"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.prospective, true, 'Should be prospective when Status="Prospective"');
  assert.deepStrictEqual(result.versions, ['enacted', '2026-03-05'],
    'Should add dct:valid for prospective content');
});

test('MetadataParser detects prospective from P1group parent Status', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2/section/5</dc:identifier>
        <dct:valid>2025-03-01</dct:valid>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
    <Primary>
        <Body>
            <P1group Status="Prospective">
                <P1 id="section-5">
                    <Pnumber>5</Pnumber>
                    <P1para><Text>Some prospective text.</Text></P1para>
                </P1>
            </P1group>
        </Body>
    </Primary>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.prospective, true,
    'Should detect prospective from P1group parent when P1 has no Status');
  assert.deepStrictEqual(result.versions, ['enacted', '2025-03-01'],
    'Should add dct:valid for prospective P1group fragment');
});

test('MetadataParser handles multiple dc:identifier elements for fragment lookup', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2/section/5</dc:identifier>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2</dc:identifier>
        <dct:valid>2025-03-01</dct:valid>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
    <Primary>
        <Body>
            <P1group Status="Prospective">
                <P1 id="section-5">
                    <Pnumber>5</Pnumber>
                    <P1para><Text>Some prospective text.</Text></P1para>
                </P1>
            </P1group>
        </Body>
    </Primary>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.prospective, true,
    'Should detect prospective from P1group even with multiple dc:identifier');
  assert.deepStrictEqual(result.versions, ['enacted', '2025-03-01'],
    'Should add dct:valid for prospective P1group fragment with multiple dc:identifier');
});

test('MetadataParser does not set prospective when Status is absent', () => {
  const parser = new MetadataParser();
  const result = parser.parse(SAMPLE_METADATA_XML);
  assert.strictEqual(result.prospective, undefined, 'Should not set prospective when Status is absent');
});

test('MetadataParser filters hasVersion links by hreflang for Welsh responses', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/wsi/2020/1609/welsh">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/welsh</dc:identifier>
        <dc:language>cy</dc:language>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/made/welsh" title="made" hreflang="cy"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/2021-02-27/welsh" title="2021-02-27" hreflang="cy"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/2021-05-17" title="2021-05-17" hreflang="en"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/2022-03-28" title="2022-03-28" hreflang="en"/>
        <ukm:SecondaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="WelshStatutoryInstrument"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="1609"/>
        </ukm:SecondaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.language, 'welsh');
  assert.deepStrictEqual(result.versions, ['made', '2021-02-27'],
    'Should keep only Welsh-language hasVersion links');
});

test('MetadataParser filters hasVersion links by dc:language for English responses', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/wsi/2020/1609">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1</dc:identifier>
        <dc:language>en</dc:language>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/made" title="made" hreflang="en"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/2021-05-17" title="2021-05-17" hreflang="en"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/wsi/2020/1609/part/3/chapter/1/2021-02-27/welsh" title="2021-02-27" hreflang="cy"/>
        <ukm:SecondaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="WelshStatutoryInstrument"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="1609"/>
        </ukm:SecondaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.language, undefined);
  assert.deepStrictEqual(result.versions, ['made', '2021-05-17'],
    'Should use dc:language as fallback and keep only English-language hasVersion links');
});

test('MetadataParser keeps untagged hasVersion links alongside matching hreflang links', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/welsh">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2/welsh</dc:identifier>
        <dc:language>cy</dc:language>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2024-01-01/welsh" title="2024-01-01" hreflang="cy"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2024-06-01" title="2024-06-01" hreflang="en"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.deepStrictEqual(result.versions, ['enacted', '2024-01-01'],
    'Should keep untagged links and matching-language links, but discard non-matching hreflang links');
});

test('MetadataParser keeps all hasVersion links when response language cannot be determined', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2</dc:identifier>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/enacted" title="enacted"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2021-02-27/welsh" title="2021-02-27" hreflang="cy"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2021-05-17" title="2021-05-17" hreflang="en"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="revised"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.strictEqual(result.language, undefined);
  assert.deepStrictEqual(result.versions, ['enacted', '2021-02-27', '2021-05-17'],
    'Should keep all hasVersion links when neither URI nor dc:language determines the response language');
});

test('MetadataParser filters by language before synthesizing prospective for final current-only responses', () => {
  const parser = new MetadataParser();
  const xml = `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/welsh">
    <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
        xmlns:atom="http://www.w3.org/2005/Atom">
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2020/2/welsh</dc:identifier>
        <dc:language>cy</dc:language>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/welsh" title="current" hreflang="cy"/>
        <atom:link rel="http://purl.org/dc/terms/hasVersion" href="http://www.legislation.gov.uk/ukpga/2020/2/2024-01-01" title="2024-01-01" hreflang="en"/>
        <ukm:PrimaryMetadata>
            <ukm:DocumentClassification>
                <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
                <ukm:DocumentStatus Value="final"/>
            </ukm:DocumentClassification>
            <ukm:Year Value="2020"/>
            <ukm:Number Value="2"/>
        </ukm:PrimaryMetadata>
    </ukm:Metadata>
</Legislation>
`;

  const result = parser.parse(xml);
  assert.deepStrictEqual(result.versions, ['enacted', 'prospective'],
    'Should drop non-matching language links before applying the final current-only prospective rule');
});

test('MetadataParser returns empty versions when no hasVersion links exist', () => {
  const parser = new MetadataParser();
  const result = parser.parse(SAMPLE_METADATA_XML);
  assert.deepStrictEqual(result.versions, [], 'Should be empty array when no hasVersion links');
});

test('MetadataParser skips effects for specific versions', () => {
  const parser = new MetadataParser();
  const xmlWithVersion = XML_WITH_EFFECTS.replace(
    'DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2"',
    'DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/enacted"'
  );

  const result = parser.parse(xmlWithVersion);
  assert.strictEqual(result.version, 'enacted');
  // Parser always populates all fields; the tool is responsible for suppressing
  // versions/effects/upToDate for versioned requests
  assert.ok(Array.isArray(result.versions), 'Parser always populates versions');
  assert.ok(Array.isArray(result.unappliedEffects), 'Parser always populates unappliedEffects');
  assert.strictEqual(typeof result.upToDate, 'boolean', 'Parser always populates upToDate');
});
