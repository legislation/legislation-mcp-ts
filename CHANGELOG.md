# Changelog

Changes to the legislation.gov.uk MCP server that affect people who connect to
it or run it, newest first.

## Unreleased

- `prospective` in `get_legislation_metadata`, and in the `meta` of
  `get_legislation_table_of_contents`, now means the response contains
  provisions not yet in force. Before, it was set only when the requested
  document or fragment was itself marked prospective, so a partly commenced
  section could look wholly in force. `version` still says whether the
  returned version is the prospective one.
- For a fragment, `version` and `versions` now also use dates read from the
  fragment's text, as the LGU2 API does. The version links in the payload can
  leave out the fragment's own version, so `version` could name an earlier one.
- In revised text, a subsection or deeper provision now gets the version
  `prospective` when a provision containing it, up to the section (`P1`) and
  its `P1group`, is marked prospective with no start date. Before, it could
  get an earlier version, such as `enacted`.
