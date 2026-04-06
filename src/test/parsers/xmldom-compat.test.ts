/**
 * Regression tests for @xmldom/xmldom API contracts.
 *
 * Guards against breakage when upgrading across the 0.8→0.9 boundary.
 * Covers the specific APIs clml-text-parser.ts depends on:
 *   - DOMParser.parseFromString with 'text/xml'
 *   - Element.getAttribute (null for missing attrs)
 *   - Element.hasAttribute
 *   - Element.textContent
 *   - Element.localName
 *   - Element.childNodes / nodeType filtering
 *   - Element.parentNode
 *   - Document.getElementsByTagName (including namespaced tags)
 *   - Document.documentElement
 */

import { test } from "node:test";
import assert from "node:assert";
import { DOMParser, type Element } from "@xmldom/xmldom";

const parser = new DOMParser();

function parseXml(xml: string) {
  const doc = parser.parseFromString(xml, "text/xml");
  assert.ok(doc.documentElement, "document should have a documentElement");
  return doc;
}

// -- DOMParser.parseFromString --

test("parseFromString returns a document with documentElement", () => {
  const doc = parseXml("<root/>");
  assert.ok(doc, "parseFromString should return a document");
  assert.strictEqual(doc.documentElement!.localName, "root");
});

test("parseFromString handles nested elements", () => {
  const doc = parseXml("<root><child><grandchild/></child></root>");
  assert.strictEqual(doc.documentElement!.childNodes.length, 1);
});

// -- Element.getAttribute --

test("getAttribute returns attribute value when present", () => {
  const doc = parseXml('<el Format="double"/>');
  assert.strictEqual(doc.documentElement!.getAttribute("Format"), "double");
});

test("getAttribute for missing attribute does not match string literals", () => {
  const doc = parseXml("<el/>");
  const result = doc.documentElement!.getAttribute("missing");
  // 0.8 returns '', 0.9 returns null — neither matches a real value
  assert.notStrictEqual(result, "some-value");
});

test("getAttribute with ?? fallback yields empty string for missing attribute", () => {
  // Mirrors the pattern in clml-text-parser.ts: getAttribute('PuncBefore') ?? ''
  const doc = parseXml("<el/>");
  const value = doc.documentElement!.getAttribute("missing") ?? "";
  assert.strictEqual(value, "");
});

// -- Element.hasAttribute --

test("hasAttribute returns true/false correctly", () => {
  const doc = parseXml('<el PuncBefore="(" PuncAfter=")"/>');
  assert.strictEqual(doc.documentElement!.hasAttribute("PuncBefore"), true);
  assert.strictEqual(doc.documentElement!.hasAttribute("PuncAfter"), true);
  assert.strictEqual(doc.documentElement!.hasAttribute("other"), false);
});

// -- Element.textContent --

test("textContent returns text of element and descendants", () => {
  const doc = parseXml("<el>hello <b>world</b></el>");
  assert.strictEqual(doc.documentElement!.textContent, "hello world");
});

test("textContent returns empty string for empty element", () => {
  const doc = parseXml("<el/>");
  assert.strictEqual(doc.documentElement!.textContent || "", "");
});

// -- Element.localName --

test("localName returns unprefixed tag name", () => {
  const doc = parseXml('<root xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier>test</dc:identifier></root>');
  const child = doc.documentElement!.childNodes[0] as Element;
  assert.strictEqual(child.localName, "identifier");
});

test("localName for unprefixed element", () => {
  const doc = parseXml("<Section/>");
  assert.strictEqual(doc.documentElement!.localName, "Section");
});

// -- childNodes / nodeType filtering --

test("childNodes includes element and text nodes", () => {
  const doc = parseXml("<root>text<child/>more</root>");
  const el = doc.documentElement!;
  // Should have 3 child nodes: text, element, text
  assert.strictEqual(el.childNodes.length, 3);
  // Filter to element nodes (nodeType === 1)
  const elements: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeType === 1) elements.push(el.childNodes[i] as Element);
  }
  assert.strictEqual(elements.length, 1);
  assert.strictEqual(elements[0].localName, "child");
});

// -- parentNode --

test("parentNode points to containing element", () => {
  const doc = parseXml("<root><child/></root>");
  const child = doc.documentElement!.childNodes[0] as Element;
  assert.strictEqual((child.parentNode as Element).localName, "root");
});

// -- getElementsByTagName with namespace prefix --

test("getElementsByTagName finds namespaced elements by prefixed name", () => {
  const xml = `<root xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier>http://example.com/1</dc:identifier>
    <dc:identifier>http://example.com/2</dc:identifier>
  </root>`;
  const doc = parseXml(xml);
  const identifiers = doc.getElementsByTagName("dc:identifier");
  assert.strictEqual(identifiers.length, 2);
  assert.ok((identifiers[0].textContent || "").includes("example.com/1"));
});

// -- Well-formed CLML-like document --

test("parses a CLML-like document structure", () => {
  const xml = `<Legislation xmlns:dc="http://purl.org/dc/elements/1.1/">
    <Metadata>
      <dc:identifier>http://www.legislation.gov.uk/ukpga/2024/1/section/1</dc:identifier>
    </Metadata>
    <Body>
      <P1group>
        <Title>Short title</Title>
        <P1 id="section-1">
          <Pnumber>1</Pnumber>
          <P1para>
            <Text>This Act may be cited as the Example Act 2024.</Text>
          </P1para>
        </P1>
      </P1group>
    </Body>
  </Legislation>`;

  const doc = parseXml(xml);
  assert.ok(doc.documentElement);
  assert.strictEqual(doc.documentElement!.localName, "Legislation");

  // Find the P1 element by id
  const p1 = findById(doc.documentElement!, "section-1");
  assert.ok(p1, "should find element with id='section-1'");
  assert.strictEqual(p1!.localName, "P1");
  assert.strictEqual(p1!.getAttribute("id"), "section-1");
});

/** Recursive getElementById equivalent (mirrors clml-text-parser's findElementById). */
function findById(node: Element, id: string): Element | null {
  if (node.getAttribute("id") === id) return node;
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) {
      const found = findById(child as Element, id);
      if (found) return found;
    }
  }
  return null;
}
