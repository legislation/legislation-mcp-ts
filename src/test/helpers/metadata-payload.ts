/**
 * Constructed legislation.gov.uk payloads for the metadata parser's tests,
 * and a reader for the fields that decide a response's version.
 */

import { MetadataParser, RequestScope } from '../../parsers/metadata-parser.js';

/**
 * A payload for ukpga/2024/1. `identifier` is the part of the request after
 * the number (none for an unversioned whole document), or `uri` the whole of
 * its path, for a request such as a treaty's; `links`, `content` and
 * `effects` (`ukm:UnappliedEffect` elements) are inserted as written.
 */
export function payload(options: {
  identifier?: string;
  uri?: string;
  valid?: string;
  links: string;
  content: string;
  status?: string;
  documentUri?: string;
  rootAttributes?: string;
  effects?: string;
}): string {
  const { identifier, valid, content, status = 'revised', documentUri = 'ukpga/2024/1', rootAttributes = '', effects } = options;
  const requested = options.uri ?? (identifier ? `ukpga/2024/1/${identifier}` : 'ukpga/2024/1');
  return `
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation"
    DocumentURI="http://www.legislation.gov.uk/${documentUri}" ${rootAttributes}>
  <ukm:Metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"
      xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"
      xmlns:atom="http://www.w3.org/2005/Atom">
    <dc:identifier>http://www.legislation.gov.uk/${requested}</dc:identifier>
    ${valid ? `<dct:valid>${valid}</dct:valid>` : ''}
    ${options.links}
    <ukm:PrimaryMetadata>
      <ukm:DocumentClassification>
        <ukm:DocumentMainType Value="UnitedKingdomPublicGeneralAct"/>
        <ukm:DocumentStatus Value="${status}"/>
      </ukm:DocumentClassification>
      <ukm:Year Value="2024"/>
      <ukm:Number Value="1"/>
      ${effects ? `<ukm:UnappliedEffects>${effects}</ukm:UnappliedEffects>` : ''}
    </ukm:PrimaryMetadata>
  </ukm:Metadata>
  ${content}
</Legislation>`;
}

/** The parsed `version` and `versions`, for a request with this scope. */
export function versionsOf(xml: string, scope: RequestScope) {
  const { version, versions } = new MetadataParser().parse(xml, scope);
  return { version, versions };
}

/** The parsed `version`, `versions` and `prospective`, with `prospective` present even when undefined. */
export function signalsOf(xml: string, scope: RequestScope) {
  const { version, versions, prospective } = new MetadataParser().parse(xml, scope);
  return { version, versions, prospective };
}

/**
 * An effect on this provision of ukpga/2024/1 (such as `section/2`), in force
 * since 2024-06-01 and not applied, so outstanding: an `UnappliedEffect` for a
 * payload's `effects`, or an `Effect` for `changesFeed`.
 */
export function effectXml(element: 'UnappliedEffect' | 'Effect', provision: string): string {
  return `
<ukm:${element} Type="substituted" Applied="false" RequiresApplied="true"
    AffectedClass="UnitedKingdomPublicGeneralAct" AffectedYear="2024" AffectedNumber="1"
    AffectedURI="http://www.legislation.gov.uk/id/ukpga/2024/1">
  <ukm:AffectedProvisions>
    <ukm:Section URI="http://www.legislation.gov.uk/id/ukpga/2024/1/${provision}"/>
  </ukm:AffectedProvisions>
  <ukm:InForceDates><ukm:InForce Date="2024-06-01" Qualification="wholly in force"/></ukm:InForceDates>
</ukm:${element}>`;
}

/** A one-page feed from the changes API holding these `Effect` elements. */
export function changesFeed(effects: string[]): string {
  return `
<feed xmlns="http://www.w3.org/2005/Atom"
    xmlns:leg="http://www.legislation.gov.uk/namespaces/legislation"
    xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
  <leg:page>1</leg:page>
  <leg:morePages>0</leg:morePages>
  ${effects.map(effect => `<entry><content type="text/xml">${effect}</content></entry>`).join('\n')}
</feed>`;
}
