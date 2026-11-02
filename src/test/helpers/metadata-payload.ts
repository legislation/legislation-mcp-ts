/**
 * Constructed legislation.gov.uk payloads for the metadata parser's tests,
 * and a reader for the fields that decide a response's version.
 */

import { MetadataParser, RequestScope } from '../../parsers/metadata-parser.js';

/**
 * A payload for ukpga/2024/1. `identifier` is the part of the request after
 * the number (none for an unversioned whole document), or `uri` the whole of
 * its path, for a request such as a treaty's; `links` and `content` are
 * inserted as written.
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
}): string {
  const { identifier, valid, content, status = 'revised', documentUri = 'ukpga/2024/1', rootAttributes = '' } = options;
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
