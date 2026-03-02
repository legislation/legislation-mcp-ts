/**
 * Tests for the CLML text parser.
 *
 * End-to-end pipeline tests: XML → parse() → Document → serializeDocument() → text.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../../parsers/clml-text-parser.js';
import { serializeDocument } from '../../parsers/clml-text-serializer.js';

function parseToText(xml: string): string {
  return serializeDocument(parse(xml));
}

test('simple section', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>A person is guilty of theft if he dishonestly appropriates property.</Text>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.strictEqual(result, '1. A person is guilty of theft if he dishonestly appropriates property.');
});

test('section with subsections', () => {
  const xml = `
    <P1>
      <Pnumber>2</Pnumber>
      <P1para>
        <Text>It is immaterial whether the appropriation is made with a view to gain.</Text>
        <P2>
          <Pnumber>1</Pnumber>
          <P2para>
            <Text>First subsection text.</Text>
          </P2para>
        </P2>
        <P2>
          <Pnumber>2</Pnumber>
          <P2para>
            <Text>Second subsection text.</Text>
          </P2para>
        </P2>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('2. It is immaterial'), 'Should include section number and text');
  assert.ok(result.includes('(1) First subsection'), 'Should include first subsection');
  assert.ok(result.includes('(2) Second subsection'), 'Should include second subsection');
});

test('deeply nested provisions (P3, P4)', () => {
  const xml = `
    <P2>
      <Pnumber>1</Pnumber>
      <P2para>
        <Text>Subsection intro.</Text>
        <P3>
          <Pnumber>a</Pnumber>
          <P3para>
            <Text>Paragraph a text.</Text>
            <P4>
              <Pnumber>i</Pnumber>
              <P4para>
                <Text>Sub-paragraph i text.</Text>
              </P4para>
            </P4>
          </P3para>
        </P3>
      </P2para>
    </P2>`;

  const result = parseToText(xml);

  // P3 should have indent level 1, P4 indent level 2
  assert.ok(result.includes('\t(a) Paragraph a text.'), 'P3 should be indented once');
  assert.ok(result.includes('\t\t(i) Sub-paragraph i text.'), 'P4 should be indented twice');
});

test('Part with Number and Title', () => {
  const xml = `
    <Part>
      <Number>Part 1</Number>
      <Title>Preliminary</Title>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para>
          <Text>Overview of this Act.</Text>
        </P1para>
      </P1>
    </Part>`;

  const result = parseToText(xml);

  assert.ok(result.includes('## Part 1'), 'Should include Part number as heading');
  assert.ok(result.includes('## Preliminary'), 'Should include Part title as heading');
  assert.ok(result.includes('1. Overview'), 'Should include section content');
});

test('Chapter with Number and Title', () => {
  const xml = `
    <Chapter>
      <Number>Chapter 2</Number>
      <Title>Interpretation</Title>
      <P1>
        <Pnumber>5</Pnumber>
        <P1para>
          <Text>In this Act, references to property include money.</Text>
        </P1para>
      </P1>
    </Chapter>`;

  const result = parseToText(xml);

  assert.ok(result.includes('### Chapter 2'), 'Should include Chapter number as h3');
  assert.ok(result.includes('### Interpretation'), 'Should include Chapter title as h3');
  assert.ok(result.includes('5. In this Act'), 'Should include section content');
});

test('PsubBlock with title', () => {
  const xml = `
    <PsubBlock>
      <Title>Minor offences</Title>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para>
          <Text>Content here.</Text>
        </P1para>
      </P1>
    </PsubBlock>`;

  const result = parseToText(xml);

  assert.ok(result.includes('##### Minor offences'), 'Should format PsubBlock title as h5');
  assert.ok(result.includes('1. Content here.'), 'Should include section content');
});

test('PrimaryPrelims', () => {
  const xml = `
    <PrimaryPrelims>
      <Title>Theft Act 1968</Title>
      <Number>1968 CHAPTER 60</Number>
      <LongTitle>
        <Para>
          <Text>An Act to revise the law of England and Wales as to theft and similar offences.</Text>
        </Para>
      </LongTitle>
      <DateOfEnactment>
        <DateText>[26th July 1968]</DateText>
      </DateOfEnactment>
    </PrimaryPrelims>`;

  const result = parseToText(xml);

  assert.ok(result.includes('# Theft Act 1968'), 'Should format title as h1');
  assert.ok(result.includes('1968 CHAPTER 60'), 'Should include chapter number');
  assert.ok(result.includes('An Act to revise'), 'Should include long title');
  assert.ok(result.includes('[26th July 1968]'), 'Should include date of enactment');
});

test('SecondaryPrelims', () => {
  const xml = `
    <SecondaryPrelims>
      <Number>2024 No. 123</Number>
      <Title>The Example Regulations 2024</Title>
      <MadeDate>
        <Text>Made</Text>
        <DateText>1st January 2024</DateText>
      </MadeDate>
    </SecondaryPrelims>`;

  const result = parseToText(xml);

  assert.ok(result.includes('2024 No. 123'), 'Should include SI number');
  assert.ok(result.includes('# The Example Regulations 2024'), 'Should format title as h1');
  assert.ok(result.includes('Made'), 'Should include made date text');
});

test('P1group with title', () => {
  const xml = `
    <P1group>
      <Title>Basic definition of theft</Title>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para>
          <Text>A person is guilty of theft.</Text>
        </P1para>
      </P1>
    </P1group>`;

  const result = parseToText(xml);

  assert.ok(result.includes('1. **Basic definition of theft**'), 'Should format P1group heading');
  assert.ok(result.includes('A person is guilty'), 'Should include section text');
  // The Pnumber "1" should NOT appear separately since it was used in the heading
  const pnumberMatches = result.match(/\b1\./g);
  assert.strictEqual(pnumberMatches?.length, 1, 'Pnumber should appear only once (in heading)');
});

test('P1group with Article', () => {
  const xml = `
    <P1group>
      <Title>Scope</Title>
      <P1>
        <Pnumber>Article 1</Pnumber>
        <P1para>
          <Text>This Regulation applies to all persons.</Text>
        </P1para>
      </P1>
    </P1group>`;

  const result = parseToText(xml);

  assert.ok(result.includes('Article 1. **Scope**'), 'Should use Article format, not Section');
});

test('P1group with multiple P1 children preserves all provisions', () => {
  const xml = `
    <P1group>
      <Title>Offences</Title>
      <P1 id="section-1">
        <Pnumber>1</Pnumber>
        <P1para>
          <Text>First offence.</Text>
        </P1para>
      </P1>
      <P1 id="section-2">
        <Pnumber>2</Pnumber>
        <P1para>
          <Text>Second offence.</Text>
        </P1para>
      </P1>
    </P1group>`;

  const result = parseToText(xml);

  assert.ok(result.includes('1. **Offences**'), 'First P1 should get the group title');
  assert.ok(result.includes('2. Second offence.'), 'Second P1 should be preserved');
  assert.ok(!result.includes('2. **'), 'Second P1 should have no title');
});

test('P1group with unnumbered P element', () => {
  const xml = `
    <P1group>
      <Title>Interpretation</Title>
      <P>
        <Text>In this Act, unless the context otherwise requires—</Text>
      </P>
    </P1group>`;

  const result = parseToText(xml);

  assert.ok(result.includes('**Interpretation**'), 'Should capture P1group title');
  assert.ok(result.includes('unless the context otherwise requires'), 'Should capture P content');
});

test('Pblock with title', () => {
  const xml = `
    <Pblock>
      <Title>General provisions</Title>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para>
          <Text>Content of the block.</Text>
        </P1para>
      </P1>
    </Pblock>`;

  const result = parseToText(xml);

  assert.ok(result.includes('#### General provisions'), 'Should format Pblock title as h4');
  assert.ok(result.includes('1. Content'), 'Should include section content');
});

test('Schedule with title block', () => {
  const xml = `
    <Schedule>
      <Number>Schedule 1</Number>
      <TitleBlock>
        <Title>Powers of Attorney</Title>
      </TitleBlock>
      <Reference>Section 5</Reference>
      <ScheduleBody>
        <P1>
          <Pnumber>1</Pnumber>
          <P1para>
            <Text>Schedule paragraph text.</Text>
          </P1para>
        </P1>
      </ScheduleBody>
    </Schedule>`;

  const result = parseToText(xml);

  assert.ok(result.includes('## Schedule 1'), 'Should format schedule number');
  assert.ok(result.includes('## Powers of Attorney'), 'Should format schedule title');
  assert.ok(result.includes('Section 5'), 'Should include reference');
  assert.ok(result.includes('1. Schedule paragraph text.'), 'Should include schedule body content');
});

test('table with header and rows', () => {
  const xml = `
    <Tabular Orientation="portrait">
      <table xmlns="http://www.w3.org/1999/xhtml" cols="2">
        <tbody>
          <tr>
            <th>Expression</th>
            <th>Modification</th>
          </tr>
          <tr>
            <td>IP completion day</td>
            <td>exit day</td>
          </tr>
          <tr>
            <td>retained EU law</td>
            <td>retained EU law governing the schemes</td>
          </tr>
        </tbody>
      </table>
    </Tabular>`;

  const result = parseToText(xml);

  assert.ok(result.includes('| Expression | Modification |'), 'Should format header row with pipes');
  assert.ok(result.includes('| IP completion day | exit day |'), 'Should format data rows with pipes');
  assert.ok(result.includes('| retained EU law | retained EU law governing the schemes |'), 'Should format all rows');
});

test('unordered list', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>The following items:</Text>
        <UnorderedList>
          <ListItem>
            <Para><Text>First item</Text></Para>
          </ListItem>
          <ListItem>
            <Para><Text>Second item</Text></Para>
          </ListItem>
        </UnorderedList>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('The following items:'), 'Should include intro text');
  assert.ok(result.includes('- First item'), 'Should include first list item');
  assert.ok(result.includes('- Second item'), 'Should include second list item');
});

test('smart quote spacing', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>The word \u201c theft \u201d means dishonest appropriation.</Text>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('\u201ctheft\u201d'), 'Should remove spaces inside smart quotes');
});

test('full document structure', () => {
  const xml = `
    <Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
                 xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
      <ukm:Metadata>
        <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Example Act 2024</dc:title>
      </ukm:Metadata>
      <Primary>
        <PrimaryPrelims>
          <Title>Example Act 2024</Title>
          <Number>2024 CHAPTER 1</Number>
        </PrimaryPrelims>
        <Body>
          <Part>
            <Number>Part 1</Number>
            <Title>Introduction</Title>
            <P1group>
              <Title>Overview</Title>
              <P1>
                <Pnumber>1</Pnumber>
                <P1para>
                  <Text>This Act makes provision about examples.</Text>
                </P1para>
              </P1>
            </P1group>
          </Part>
        </Body>
      </Primary>
    </Legislation>`;

  const result = parseToText(xml);

  // Should have prelims
  assert.ok(result.includes('# Example Act 2024'), 'Should include act title');
  assert.ok(result.includes('2024 CHAPTER 1'), 'Should include chapter number');
  // Should have Part heading
  assert.ok(result.includes('## Part 1'), 'Should include Part number');
  assert.ok(result.includes('## Introduction'), 'Should include Part title');
  // Should have section
  assert.ok(result.includes('1. **Overview**'), 'Should include P1group heading');
  assert.ok(result.includes('This Act makes provision'), 'Should include section text');
  // Should NOT include metadata content
  assert.ok(!result.includes('dc:title'), 'Should not include metadata tags');
});

test('unknown tags fall through to text content', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>See <Citation>the 1998 Act</Citation> for details.</Text>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('See the 1998 Act for details.'), 'Should extract text from unknown inline elements');
});

test('BlockSection sibling of P1para is preserved', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>The following table applies.</Text>
      </P1para>
      <Tabular>
        <table>
          <tbody>
            <tr><td>A</td><td>B</td></tr>
          </tbody>
        </table>
      </Tabular>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('The following table applies.'), 'Should include P1para text');
  assert.ok(result.includes('A'), 'Should include table content from BlockSection sibling');
});

test('BlockAmendment indentation', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>For section 5 substitute:</Text>
        <BlockAmendment>
          <P1>
            <Pnumber>5</Pnumber>
            <P1para>
              <Text>Replacement text here.</Text>
            </P1para>
          </P1>
        </BlockAmendment>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('For section 5 substitute:'), 'Should include intro text');
  assert.ok(result.includes('5. Replacement text here.'), 'Should include amendment content');
});

test('Schedules wrapper with Title (title dropped)', () => {
  const xml = `
    <Schedules>
      <Title>SCHEDULES</Title>
      <Schedule>
        <Number>Schedule 1</Number>
        <TitleBlock>
          <Title>First Schedule Title</Title>
        </TitleBlock>
        <ScheduleBody>
          <P1>
            <Pnumber>1</Pnumber>
            <P1para><Text>Schedule content.</Text></P1para>
          </P1>
        </ScheduleBody>
      </Schedule>
    </Schedules>`;

  const result = parseToText(xml);

  assert.ok(!result.includes('## SCHEDULES'), 'Should NOT include Schedules wrapper title');
  assert.ok(result.includes('## Schedule 1'), 'Should format individual schedule number');
  assert.ok(result.includes('## First Schedule Title'), 'Should format schedule title');
});

test('Schedule with Subtitle in TitleBlock', () => {
  const xml = `
    <Schedule>
      <Number>Schedule 2</Number>
      <TitleBlock>
        <Title>Main Title</Title>
        <Subtitle>A subtitle here</Subtitle>
      </TitleBlock>
      <ScheduleBody>
        <P1>
          <Pnumber>1</Pnumber>
          <P1para><Text>Content.</Text></P1para>
        </P1>
      </ScheduleBody>
    </Schedule>`;

  const result = parseToText(xml);

  assert.ok(result.includes('## Main Title'), 'Should include title');
  assert.ok(result.includes('## A subtitle here'), 'Should include subtitle');
});

test('Contents element is skipped', () => {
  const xml = `
    <Body>
      <Contents>
        <ContentsTitle>Table of Contents</ContentsTitle>
        <ContentsPart>
          <ContentsNumber>Part 1</ContentsNumber>
          <ContentsTitle>Introduction</ContentsTitle>
        </ContentsPart>
      </Contents>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para><Text>Actual content.</Text></P1para>
      </P1>
    </Body>`;

  const result = parseToText(xml);

  assert.ok(!result.includes('Table of Contents'), 'Should not include Contents');
  assert.ok(result.includes('1. Actual content.'), 'Should include body content');
});

test('Footnote elements with newline separation', () => {
  const xml = `
    <Body>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para><Text>See note.</Text></P1para>
      </P1>
      <Footnote id="f1"><Number>1</Number><FootnoteText><Para><Text>First footnote.</Text></Para></FootnoteText></Footnote>
      <Footnote id="f2"><Number>2</Number><FootnoteText><Para><Text>Second footnote.</Text></Para></FootnoteText></Footnote>
    </Body>`;

  const result = parseToText(xml);

  assert.ok(result.includes('See note.'), 'Should include body text');
  assert.ok(result.includes('1 First footnote.'), 'Should include first footnote with number separated');
  assert.ok(result.includes('2 Second footnote.'), 'Should include second footnote with number separated');
  // Footnotes should not run together
  assert.ok(!result.includes('First footnote.2'), 'Footnotes should be separated');
});

test('Figure element shows placeholder', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>See the diagram below.</Text>
        <Figure>
          <Image ResourceRef="img001"/>
        </Figure>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('See the diagram below.'), 'Should include text');
  assert.ok(result.includes('[Figure]'), 'Should include figure placeholder');
});

test('Text element collapses internal whitespace', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>under
            this section
            only if—</Text>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('under this section only if—'), 'Should collapse newlines and indentation in Text');
  assert.ok(!result.includes('under\n'), 'Should not contain hard line breaks within Text');
});

test('BlockAmendment is indented at top level', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>For section 5 substitute:</Text>
        <BlockAmendment>
          <P1>
            <Pnumber>5</Pnumber>
            <P1para>
              <Text>New section five text.</Text>
            </P1para>
          </P1>
        </BlockAmendment>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('For section 5 substitute:'), 'Should include intro text');
  assert.ok(result.includes('\t5. New section five text.'), 'Block amendment should be indented');
});

test('parser returns Document type', () => {
  const xml = `<P1><Pnumber>1</Pnumber><P1para><Text>First.</Text></P1para></P1>`;
  const doc = parse(xml);

  assert.strictEqual(doc.type, 'document', 'Should return a Document');
  assert.ok(Array.isArray(doc.body), 'Should have body array');
  assert.ok(Array.isArray(doc.prelims), 'Should have prelims array');
  assert.ok(Array.isArray(doc.schedules), 'Should have schedules array');
});

test('SecondaryPrelims date labels are separated from dates', () => {
  const xml = `<SecondaryPrelims><Number>2024 No. 123</Number><Title>The Example Regulations 2024</Title><MadeDate><Text>Made</Text><DateText>1st January 2024</DateText></MadeDate><LaidDate><Text>Laid before Parliament</Text><DateText>5th January 2024</DateText></LaidDate><ComingIntoForce><Text>Coming into force</Text><DateText>1st February 2024</DateText></ComingIntoForce></SecondaryPrelims>`;

  const result = parseToText(xml);

  assert.ok(result.includes('Made 1st January 2024'), 'Should separate Made label from date');
  assert.ok(result.includes('Laid before Parliament 5th January 2024'), 'Should separate Laid label from date');
  assert.ok(result.includes('Coming into force 1st February 2024'), 'Should separate Coming into force label from date');
});

test('SecondaryPreamble is included in secondary prelims', () => {
  const xml = `
    <SecondaryPrelims>
      <Title>The Example Regulations 2024</Title>
      <SecondaryPreamble>
        <IntroductoryText>
          <P><Text>The Secretary of State makes these Regulations.</Text></P>
        </IntroductoryText>
        <EnactingText>
          <Para><Text>A draft has been laid before Parliament.</Text></Para>
        </EnactingText>
      </SecondaryPreamble>
    </SecondaryPrelims>`;

  const result = parseToText(xml);

  assert.ok(result.includes('The Secretary of State makes these Regulations.'), 'Should include introductory text');
  assert.ok(result.includes('A draft has been laid before Parliament.'), 'Should include enacting text');
});

test('EUPrelims MultilineTitle renders with line breaks', () => {
  const xml = `
    <EURetained>
      <EUPrelims>
        <MultilineTitle>
          <Text>Regulation (EU) 2016/679 of the European Parliament and of the Council</Text>
          <Text>of 27 April 2016</Text>
          <Text>on the protection of natural persons</Text>
        </MultilineTitle>
      </EUPrelims>
    </EURetained>`;

  const result = parseToText(xml);

  assert.ok(result.includes('# Regulation (EU) 2016/679'), 'Should format as heading');
  assert.ok(!result.includes('Councilof'), 'Should not concatenate title lines without spaces');
  assert.ok(result.includes('of 27 April 2016'), 'Should include second title line');
});

test('EU Division renders as numbered paragraph', () => {
  const xml = `
    <EURetained>
      <EUPrelims>
        <EUPreamble>
          <Division id="division-1">
            <Number>(1)</Number>
            <P><Text>The protection of natural persons is a fundamental right.</Text></P>
          </Division>
          <Division id="division-2">
            <Number>(2)</Number>
            <P><Text>The principles should respect fundamental freedoms.</Text></P>
          </Division>
        </EUPreamble>
      </EUPrelims>
    </EURetained>`;

  const result = parseToText(xml);

  assert.ok(result.includes('(1) The protection of natural persons is a fundamental right.'), 'Should format division with number');
  assert.ok(result.includes('(2) The principles should respect fundamental freedoms.'), 'Should format second division');
});

// --- Fragment-aware parsing tests ---

test('fragment: parses only the target section, skipping ancestor headings', () => {
  const xml = `
    <Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
                 xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
                 xmlns:dc="http://purl.org/dc/elements/1.1/">
      <ukm:Metadata>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1/section/1</dc:identifier>
      </ukm:Metadata>
      <Primary>
        <Body>
          <Part id="part-1">
            <Number>Part 1</Number>
            <Title>Introduction</Title>
            <P1group>
              <Title>Overview</Title>
              <P1 id="section-1">
                <Pnumber>1</Pnumber>
                <P1para>
                  <Text>This Act makes provision about examples.</Text>
                </P1para>
              </P1>
            </P1group>
          </Part>
        </Body>
      </Primary>
    </Legislation>`;

  const result = parseToText(xml);

  assert.ok(result.includes('1. **Overview**'), 'Should capture P1group title when id is on P1');
  assert.ok(result.includes('This Act makes provision about examples.'), 'Should include section text');
  assert.ok(!result.includes('## Part 1'), 'Should NOT include ancestor Part heading');
  assert.ok(!result.includes('## Introduction'), 'Should NOT include ancestor Part title');
});

test('fragment: full document with no fragment parses from root', () => {
  const xml = `
    <Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
                 xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
                 xmlns:dc="http://purl.org/dc/elements/1.1/">
      <ukm:Metadata>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1</dc:identifier>
      </ukm:Metadata>
      <Primary>
        <Body>
          <Part id="part-1">
            <Number>Part 1</Number>
            <Title>Introduction</Title>
            <P1group>
              <Title>Overview</Title>
              <P1 id="section-1">
                <Pnumber>1</Pnumber>
                <P1para>
                  <Text>This Act makes provision about examples.</Text>
                </P1para>
              </P1>
            </P1group>
          </Part>
        </Body>
      </Primary>
    </Legislation>`;

  const result = parseToText(xml);

  assert.ok(result.includes('## Part 1'), 'Should include Part heading for full document');
  assert.ok(result.includes('## Introduction'), 'Should include Part title for full document');
  assert.ok(result.includes('1. **Overview**'), 'Should include section');
});

test('fragment: uses first dc:identifier when multiple exist', () => {
  const xml = `
    <Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
                 xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
                 xmlns:dc="http://purl.org/dc/elements/1.1/">
      <ukm:Metadata>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1/section/2</dc:identifier>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1</dc:identifier>
      </ukm:Metadata>
      <Primary>
        <Body>
          <Part id="part-1">
            <Number>Part 1</Number>
            <Title>Introduction</Title>
            <P1group>
              <Title>Definitions</Title>
              <P1 id="section-2">
                <Pnumber>2</Pnumber>
                <P1para>
                  <Text>In this Act, the following terms apply.</Text>
                </P1para>
              </P1>
            </P1group>
          </Part>
        </Body>
      </Primary>
    </Legislation>`;

  const result = parseToText(xml);

  assert.ok(result.includes('2. **Definitions**'), 'Should use first dc:identifier (section/2)');
  assert.ok(!result.includes('## Part 1'), 'Should NOT include ancestor Part heading');
});

test('fragment: falls back to root when target ID not found', () => {
  const xml = `
    <Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
                 xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
                 xmlns:dc="http://purl.org/dc/elements/1.1/">
      <ukm:Metadata>
        <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1/section/99</dc:identifier>
      </ukm:Metadata>
      <Primary>
        <Body>
          <Part id="part-1">
            <Number>Part 1</Number>
            <Title>Introduction</Title>
            <P1group>
              <Title>Overview</Title>
              <P1 id="section-1">
                <Pnumber>1</Pnumber>
                <P1para>
                  <Text>This Act makes provision about examples.</Text>
                </P1para>
              </P1>
            </P1group>
          </Part>
        </Body>
      </Primary>
    </Legislation>`;

  const result = parseToText(xml);

  // Should gracefully fall back to parsing the full document
  assert.ok(result.includes('## Part 1'), 'Should include Part heading (fallback to root)');
  assert.ok(result.includes('1. **Overview**'), 'Should include section content');
});

// --- Data preservation tests ---

test('interstitial text between nested provisions is preserved', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>A person commits an offence if—</Text>
        <P2>
          <Pnumber>a</Pnumber>
          <P2para><Text>condition one,</Text></P2para>
        </P2>
        <Text>or</Text>
        <P2>
          <Pnumber>b</Pnumber>
          <P2para><Text>condition two.</Text></P2para>
        </P2>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('(a)'), 'Should include first subsection');
  assert.ok(result.includes('(b)'), 'Should include second subsection');
  assert.ok(result.includes('or'), 'Interstitial text between children must not be dropped');
});

test('P2group with multiple P2 children preserves all siblings', () => {
  const xml = `
    <P1>
      <Pnumber>1</Pnumber>
      <P1para>
        <Text>A person commits an offence if—</Text>
        <P2group>
          <P2>
            <Pnumber>a</Pnumber>
            <P2para><Text>condition one,</Text></P2para>
          </P2>
          <P2>
            <Pnumber>b</Pnumber>
            <P2para><Text>condition two, or</Text></P2para>
          </P2>
          <P2>
            <Pnumber>c</Pnumber>
            <P2para><Text>condition three.</Text></P2para>
          </P2>
        </P2group>
      </P1para>
    </P1>`;

  const result = parseToText(xml);

  assert.ok(result.includes('(a)'), 'Should include first subsection');
  assert.ok(result.includes('(b)'), 'Should include second subsection');
  assert.ok(result.includes('(c)'), 'Should include third subsection');
});

test('non-structural content inside a division is preserved', () => {
  const xml = `
    <Part>
      <Number>Part 1</Number>
      <Title>Preliminary</Title>
      <Text>This Part sets out general provisions.</Text>
      <P1>
        <Pnumber>1</Pnumber>
        <P1para><Text>Overview of this Act.</Text></P1para>
      </P1>
    </Part>`;

  const result = parseToText(xml);

  assert.ok(result.includes('## Part 1'), 'Should include Part heading');
  assert.ok(result.includes('1. Overview'), 'Should include provision');
  assert.ok(result.includes('This Part sets out general provisions.'),
    'Non-structural text inside a division must not be dropped');
});
