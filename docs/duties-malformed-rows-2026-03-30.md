# Powers-and-Duties Extract — Malformed Row Report

**Extract:** `duties_*_20260330` (32 CSV files, 1,841,827 data rows)
**Analysed:** 2026-06-02
**Result:** 13 rows (0.0007%) fail validation and are not loaded into the MCP database.

This is a defect report intended for the team that produces the powers-and-duties
extract. The 13 rows below carry valid `duty_uri`s but fail one of the structural
checks the ingest applies, so they are dropped. Most are empty placeholders; four
contain real legal content and are dropped only on a classification technicality.

## Validation criteria

A row is dropped if any of the following holds (checked in this order, mirroring
`scripts/ingest-duties-pg.js`):

1. Fewer than 19 columns.
2. `dutyTempId` is not numeric.
3. `modality` ∉ {`duty`, `power`}.
4. `inference` ∉ {`explicit`, `implicit`}.
5. `priority` ∉ {`primary`, `secondary`}.
6. `action` is empty.

No row in this extract failed checks 1 or 2; all 13 failures are checks 3–6.
"record #" is the 1-based data-row index within the named CSV (header excluded);
CSV line numbers differ because some fields contain quoted embedded newlines, so
`dutyTempId` + `duty_uri` are the reliable identifiers.

## Summary

| Reason | Count |
|---|---|
| `bad_modality` | 11 |
| `bad_priority` | 1 |
| `bad_inference` | 1 |
| **Total** | **13** |

By file: `eur` 3 · `ssi` 1 · `ukla` 1 · `ukpga` 3 (parts 01, 01, 03) · `uksi` 3 (parts 01, 03, 04) · `wsi` 2.

## Group 1 — Empty placeholders (9 rows)

Every analytical field is the literal string `"Missing"` (modality, inference,
priority, *and* action). These appear to be shell records: a URI was emitted but
no content was extracted. Correctly dropped; nothing to recover.

| File | record | dutyTempId | duty_uri |
|---|---|---|---|
| `duties_eur_…_part01` | 49970 | 1599598 | `http://www.legislation.gov.uk/id/duties/eur/2016/799/2026-01-23/duty/0296` |
| `duties_eur_…_part01` | 104745 | 1553497 | `http://www.legislation.gov.uk/id/duties/eur/2012/426/2026-01-23/duty/0002` |
| `duties_ukla_…_part01` | 11176 | 1887124 | `http://www.legislation.gov.uk/id/duties/ukla/1992/7/2026-01-23/duty/0054` |
| `duties_ukpga_…_part01` | 44463 | 1376761 | `http://www.legislation.gov.uk/id/duties/ukpga/2016/7/2025-10-13/duty/0029` |
| `duties_ukpga_…_part01` | 148966 | 2790427 | `http://www.legislation.gov.uk/id/obligations/ukpga/2003/21/2026-03-24/duty/0743` |
| `duties_ukpga_…_part03` | 2108 | 1667230 | `http://www.legislation.gov.uk/id/duties/ukpga/1970/44/2026-01-23/duty/0022` |
| `duties_uksi_…_part01` | 129968 | 971396 | `http://www.legislation.gov.uk/id/duties/uksi/2020/1656/2025-10-13/duty/0477` |
| `duties_uksi_…_part03` | 816 | 2167065 | `http://www.legislation.gov.uk/id/duties/uksi/2009/3219/2026-01-23/duty/0002` |
| `duties_uksi_…_part04` | 139504 | 2006262 | `http://www.legislation.gov.uk/id/duties/uksi/1990/1451/2026-01-23/duty/0001` |

## Group 2 — Real duties, one classification field missing (2 rows)

A genuine `action` and valid remaining fields, but one classification is
`"Missing"`. These are recoverable if the source can supply the missing value.

| File | record | dutyTempId | Missing field | duty_uri | action (start) |
|---|---|---|---|---|---|
| `duties_eur_…_part01` | 64710 | 1391224 | `priority` | `http://www.legislation.gov.uk/id/duties/eur/2014/1321/2026-01-30/duty/0139` | "sign statement confirming the maintenance organisation will …" |
| `duties_ssi_…_part01` | 61317 | 2695422 | `inference` | `http://www.legislation.gov.uk/id/obligations/ssi/2006/337/2026-03-24/duty/0025` | "require, in an declaration of an vaccination zone or in an v…" |

## Group 3 — Dual-classified modality (2 rows)

The extractor classified these as *both* a power and a duty. The MCP schema
permits only `duty` or `power`, so they are dropped. Real content; recoverable if
the source either picks one classification or the model is extended to represent
"both".

| File | record | dutyTempId | modality value | duty_uri | action (start) |
|---|---|---|---|---|---|
| `duties_wsi_…_part01` | 14376 | 807471 | `power and duty` | `http://www.legislation.gov.uk/id/duties/wsi/2020/555/2025-10-13/duty/0057` | "make enquiries about particulars which prescribed person wou…" |
| `duties_wsi_…_part01` | 49351 | 2953283 | `duty\|power` | `http://www.legislation.gov.uk/id/obligations/wsi/2006/490/2026-03-24/duty/0176` | "specify the period (of not less than two and not more than f…" |

## Incidental observation — `/duties/` vs `/obligations/` in the URI path

Three of the 13 URIs use `/id/obligations/…` rather than `/id/duties/…` in the
path (the `ssi` row, the second `ukpga` row, and `wsi` #49351). All three carry
the `2026-03-24` version date, whereas the `/duties/` URIs are dated `2025-10-13`,
`2026-01-23`, or `2026-01-30`. This suggests a later extraction batch renamed that
path segment from `duties` to `obligations`. It is harmless to the MCP (the type
and version date are parsed from the URI regardless), but it indicates the source
URI conventions are still evolving between batches — worth stabilising before
future extracts.

## Incidental observation — `enactment_type` carries descriptive names for some rows

Separately from the dropped rows above, the `enactmentType` CSV column is not on a
single controlled vocabulary. For most rows it holds the canonical
legislation.gov.uk type code (`ukpga`, `uksi`, `eur`, `asp`, …), but for some it
holds a descriptive English name instead — splitting one document type across two
labels. The URI's own type segment is always the canonical code, so the intended
value is unambiguous:

| `enactmentType` value | URI type segment | canonical code | rows (loaded DB) |
|---|---|---|---|
| `EuropeanUnionDirective` | `eudr` | `eudr` | 3,664 |
| `ScottishAct` | `asp` | `asp` | 45 |
| `NorthernIrelandParliamentAct` | `apni` | `apni` | 10 |

Unlike the rows above these load fine — they are valid — but the mislabel makes any
type-based filter or grouping wrong for the affected codes. The EU Directive case is
material: of ~4,025 directive rows only 361 carry `eudr`, so the other **3,664
(≈91%) are invisible to a filter on `eudr`**. The `asp`/`apni` cases are negligible
(45 and 10 against tens of thousands correctly labelled).

For the **upstream pipeline**: emit the canonical short code (the same value already
present in the URI) in the `enactmentType` column rather than a descriptive name, so
the field stays on one vocabulary. As with the `/duties/` vs `/obligations/`
inconsistency above, this suggests type conventions are still varying between
extraction batches. On the MCP side it is straightforward to neutralise (normalise
the three known values to their canonical code at ingest, and/or backfill the loaded
rows), but the clean fix is upstream consistency.

## Incidental observation — duplicate provisions within the EU-Directive (`eudr`) extract

While reviewing the `enactment_type` issue above, the EU-Directive rows turned out
to contain apparent **duplicate extractions of the same provision**: multiple rows
sharing an identical `enactment` URI, `section`, `subsection`, `modality`, and
`action`. In the loaded data there are **103 such groups (124 redundant rows)** —
e.g. `eudr/1994/62/article/6` appears 7×. They carry distinct `duty_uri`s (the
version-date segment differs), so they load as separate rows rather than being
dropped; the effect is that the same obligation is represented several times.

These sit **entirely within the rows that carried the descriptive
`EuropeanUnionDirective` label** (see the observation above) — version dates
`2025-10-13` / `2025-10-14` / `2025-11-24`, i.e. a specific extraction batch — and
not within the rows already on the `eudr` code (version date `2025-12-15`); no
duplicate group spans the two. So that batch carries *two* issues: the non-canonical
type label, and internal duplication.

**Caveat on the count:** the grouping key was `enactment` + `section` +
`subsection` + `modality` + `action`. Rows that differ only in `actor` or
`condition` would be legitimately distinct (the same action imposed on different
actors), so 124 is an upper bound — a tighter pass grouping on all content fields
would give the true figure.

For the **upstream pipeline**: investigate why the EU-Directive extraction emits the
same provision more than once within a single version, and de-duplicate at source.
This is independent of the type-label issue above — neither causes the other.

## Incidental observation — regnal-year Acts arrive without a parseable calendar year (resolved MCP-side)

Three pre-1963 regnal-year `ukpga` enactments (417 rows) carried a regnal-form value
in the `enactmentYear` column (e.g. `Eliz2/9-10`) rather than a calendar year, so the
ingest's integer parse rejected it and stored `enactment_year` as `null` — which
excluded them from `year_from`/`year_to` range filters and put them in the `null`
group when grouping by year:

| enactment | title | calendar year |
|---|---|---|
| `ukpga/Eliz2/9-10/48` | Land Drainage Act 1961 | 1961 |
| `ukpga/Vict/12-13/51` | Judicial Factors Act 1849 | 1849 |
| `ukpga/Vict/52-53/39` | Judicial Factors (Scotland) Act 1889 | 1889 |

The calendar year is recoverable from legislation.gov.uk's canonical short title (its
trailing year). Resolved on the MCP side: the loaded rows were backfilled with the
title-derived years, and the ingest now falls back to the title's trailing 4-digit
year when the year column doesn't parse. For the **upstream pipeline**: supply a
calendar year (the canonical year facet) for regnal-year enactments, so consumers
don't have to recover it from the title.

## Incidental observation — the `actorIsBody` column is misnamed and near-empty

The CSV's `actorIsBody` column (stored as the `is_body` field of each
`actor_aliases` entry) is misleading on two counts:

- **It is not a flag.** Despite the name it holds a body *name* — e.g. `National
  Assembly for Wales`, `Auditor General for Wales` — not a boolean. And where it is
  populated it equals the alias `name` in 595 of 615 cases, so it is essentially a
  duplicate of the name.
- **It is almost always empty.** Of 306,229 alias entries across the corpus it is
  populated on only **615 (0.2%)**.

By contrast the `body_uri` column is genuinely useful: populated on **28,553 (9.3%)**
of alias entries with canonical legislation.gov.uk organisation URIs (e.g.
`.../id/organisation/FoodStandardsAgency_UnitedKingdom`), and it overlaps
`actorIsBody` on only 4 entries. The two are effectively disjoint, and `body_uri`
carries the linked-data value `actorIsBody` was presumably meant to.

MCP side: `is_body` is no longer surfaced by the tools (it read as a broken boolean);
`body_uri` is kept and documented as an organisation identifier. For the **upstream
pipeline**: either populate `actorIsBody` as an actual boolean/flag, or drop it in
favour of `body_uri` (the organisation link).

## Recommendation

For the MCP, all 13 are correctly dropped — 0.0007% of the corpus, and the schema
constraints (`modality`, `inference`, `priority` as closed enumerations) are doing
their job. No action needed on the consuming side.

For the **upstream extraction pipeline**, this list is the actionable part:

- **9 empty placeholders** suggest the extractor sometimes emits a record with a
  URI but no content. Worth understanding why — are these provisions it failed to
  parse, or spurious URIs?
- **4 content-bearing rows** (Groups 2 and 3) are real obligations lost to a single
  malformed field or a dual classification the binary model can't express. The
  `power and duty` / `duty|power` cases in particular may indicate provisions that
  genuinely impose both a power and a duty.

## Reproducing this report

The figures come from a read-only pass over the source CSVs in `./duties`,
applying the same validation as `scripts/ingest-duties-pg.js`. It does not touch
the database. See also:

- ADR: [2026-05-26 — Powers-and-duties on SQLite](./adr/2026-05-26-powers-and-duties-sqlite.md) (§3, original "≤10 malformed rows" observation)
- ADR: [2026-05-29 — Postgres migration plan](./adr/2026-05-29-postgres-migration-plan.md)
