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

test('MetadataParser skips effects for specific versions', () => {
  const parser = new MetadataParser();
  const xmlWithVersion = XML_WITH_EFFECTS.replace(
    'DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2"',
    'DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/enacted"'
  );

  const result = parser.parse(xmlWithVersion);
  assert.strictEqual(result.version, 'enacted');
  assert.strictEqual(result.unappliedEffects, undefined, 'Should skip effects for non-latest version');
  assert.strictEqual(result.upToDate, undefined, 'Should not report upToDate for non-latest version');
});
