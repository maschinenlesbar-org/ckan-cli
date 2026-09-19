---
name: ckan-catalogue-stats
description: >
  Produce counts, rankings and breakdowns over German CKAN open-data portals
  using the ckan-cli's facet support. Trigger when the user asks "which
  publishers have the most datasets in Berlin?", "what file formats dominate
  Open.NRW?", "the licence mix on the Hamburg Transparenzportal", "how many
  datasets per year since 2020?", "compare the German open-data portals by
  size", or wants aggregations rather than a list of individual datasets.
  Cleans up the per-portal spelling of formats and licences.
version: 1.0.0
userInvocable: true
---

# CKAN Catalogue Statistics

Answer "how many / who publishes most / what's the mix of …" questions about one CKAN
portal, or compare portals, by driving CKAN **facets** (value counts over a search) and
tidying the raw values into a clean ranking.

## Tooling

This skill drives the `ckan` command. **Before anything else, validate it is available** — run `command -v ckan` (or `ckan --version`). If it is not on your PATH, STOP and inform the user that the `ckan` CLI (`@maschinenlesbar.org/ckan-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build. The CKAN server software also installs a command named `ckan` (an admin tool): if `ckan --help` does not contain the line "CLI for any CKAN open-data portal", STOP and tell the user that a different `ckan` comes first on their PATH.

Data comes from the `ckan` CLI over the open CKAN Action API of the chosen portal. It is read-only and needs **no API key**. Always pass `--compact` so each result is one line to pipe into `jq`. Without a portal flag, `ckan` talks to the **Hamburg Transparenzportal**; `--portal <id>` picks a known portal (`ckan portals` lists them), `--base-url <url>` any other CKAN site. A search that matches nothing returns `{"count":0,…}` and exits `0` — that is an answer, not an error. Exit `4` is an id that doesn't exist; exit `1` is a real error, and its message says which (a Solr syntax error, an HTML page instead of a CKAN, a redirect loop). Add `--timeout 60000` for a slow portal.

## Step 1 — One facet query answers most questions

```bash
ckan --compact --portal nrw search "Verkehr" --rows 0 --facet organization --facet res_format --facet-limit -1
```

- `--rows 0` skips the records; `count` is the number of matching datasets.
- Leave out the query for the whole catalogue: `ckan --compact --portal nrw search --rows 0 --facet …`.
- Narrow with `--fq` (repeatable, all must match), e.g. `--fq organization:<name>`.
- **Always pass `--facet-limit -1`.** CKAN's default is 50 values per facet, and the list
  stops there without warning — the long tail and everything after it is missing.

Useful facet fields: `organization` (publisher), `groups` (theme), `res_format`,
`license_id`, `tags`, `type`; on Hamburg also `extras_registerobject_type` (see
**ckan-hamburg-transparency**).

## Step 2 — Read the two facet shapes

- `facets.<field>` — a plain `{ "value": count }` map. **Unsorted**: sort by count yourself.
- `search_facets.<field>.items[]` — `{ name, display_name, count }`. Use `display_name`
  for labels: for `organization` it is the publisher's title, where `name` is a slug.

Facet counts are **datasets that carry the value**, not files: a dataset with a CSV and
a PDF counts once under each. So format or licence counts don't add up to `count`.

## Step 3 — Fold the spellings

Portals spell the same value differently, and some mix spellings within one portal
(seen on 2026-09-19):

- **Formats:** `CSV` / `csv` (Berlin has both as separate values), EU URIs on GovData and
  daten.bw (`http://publications.europa.eu/resource/authority/file-type/CSV` → take the
  part after the last `/`), `WMS` vs `WMS_SRVC`, `Shape` vs `SHP`. Fold case-insensitively
  on the tail, and say how many raw values you merged.
- **Licences:** `dl-de-by-2.0`, `dl-by-de/2.0`, `dl-by-de/2_0`,
  `http://dcat-ap.de/def/licenses/dl-by-de/2.0` are one licence (Datenlizenz Deutschland
  Namensnennung 2.0); likewise the Zero variants and `cc-by` / `CC-BY-4.0`. On **GovData
  and daten.bw the package licence is mostly empty** — the facet then covers only a
  sliver of the datasets; say so instead of presenting it as the licence mix.
- **Tags** are free text; on Hamburg many are whole keyword lists in one string, so a tag
  ranking there says little.

## Step 4 — Counts over time

There is no date facet. Count per period with range filters on the real date fields,
one query per period:

```bash
for y in 2021 2022 2023 2024 2025 2026; do
  printf '%s\t' "$y"
  ckan --compact --portal berlin search --rows 0 \
    --fq "metadata_created:[${y}-01-01T00:00:00Z TO $((y+1))-01-01T00:00:00Z}" | jq '.count'
done
```

Use `metadata_created` / `metadata_modified`. Fields from `extras` (e.g. Hamburg's
`publishing_date`) are indexed as text: a range on them returns nonsense.

## Step 5 — Compare portals

- Sizes of all known portals: `ckan --compact portals` gives `datasets` as of the list's
  last check; `ckan --compact portals --check` counts them live now.
- A topic across portals: one `--rows 0` query per portal id (see the loop in
  **ckan-dataset-finder**). GovData harvests most Länder portals, so it overlaps them —
  never add it to a sum.
- Publisher sizes: `ckan --compact --portal <id> organizations --all-fields` returns every
  organization with its `package_count` (the CLI pages past CKAN's cap of 25).

## Step 6 — Report

Lead with the scope ("Open.NRW, all 11,099 datasets" or "'Verkehr': 1,204 of 11,099"),
then the ranking, largest first, with a short bar or share per row. Show the top 10–15
and fold the rest into "… N more". State what was merged ("CSV and csv folded") and
what the numbers count (datasets, not files).
