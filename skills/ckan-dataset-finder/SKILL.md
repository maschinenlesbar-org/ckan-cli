---
name: ckan-dataset-finder
description: >
  Find, rank and summarise open datasets on a topic in German CKAN open-data
  portals using the ckan-cli — one portal (Hamburg by default, or Berlin, NRW,
  GovData, München …) or all known portals at once. Trigger when the user asks
  "which German portals have open data on Radverkehr?", "find CSV data about
  Baumkataster in Berlin", "newest datasets on Luftqualität in NRW", "is there
  open data on Schulen in Rostock?", or wants a ranked shortlist with publisher,
  formats, licence and links instead of raw CKAN search JSON.
compatibility: >
  Requires the `ckan` CLI (npm package @maschinenlesbar.org/ckan-cli) on PATH,
  installed by the user; the skill never installs it. Uses jq for JSON
  filtering. Network access to the chosen CKAN portal (default
  suche.transparenz.hamburg.de; --portal, --base-url or CKAN_BASE_URL). The CKAN
  server's own `ckan` admin command must not shadow it on PATH.
---

# CKAN Dataset Finder

Turn a free-text topic into a **ranked shortlist of datasets** from one CKAN portal — or
first find *which* German portals have data on it — each with publisher, file formats,
licence, last update and links, instead of the 40-field CKAN search blob.

## Tooling

This skill drives the `ckan` command. **Before anything else, validate it is available** — run `command -v ckan` (or `ckan --version`). If it is not on your PATH, STOP and inform the user that the `ckan` CLI (`@maschinenlesbar.org/ckan-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build. The CKAN server software also installs a command named `ckan` (an admin tool): if `ckan --help` does not contain the line "CLI for any CKAN open-data portal", STOP and tell the user that a different `ckan` comes first on their PATH.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

Data comes from the `ckan` CLI over the open CKAN Action API of the chosen portal. It is read-only and needs **no API key**. Always pass `--compact` so each result is one line to pipe into `jq`. Without a portal flag, `ckan` talks to the **Hamburg Transparenzportal**; `--portal <id>` picks a known portal (`ckan portals` lists them), `--base-url <url>` any other CKAN site. A search that matches nothing returns `{"count":0,…}` and exits `0` — that is an answer, not an error. Exit `4` is an id that doesn't exist; exit `1` is a real error, and its message says which (a Solr syntax error, an HTML page instead of a CKAN, a redirect loop). Add `--timeout 60000` for a slow portal.

## Step 1 — Pick the portal(s)

- The user named a city, Land or portal → map it to an id from `ckan --compact portals`
  (`berlin`, `nrw`, `schleswig-holstein`, `muenchen`, `rostock`, `govdata`, …). Match on
  `id` and `title`; only use entries with `"working": true`.
- A place with no portal of its own → `govdata` (the national catalogue harvests most
  Länder portals and many cities), and say so.
- "Which portals have data on X?" / no place given → **fan out**: for every working
  portal run a `--rows 0` count, then go deeper on the portals with hits:

```bash
for id in $(ckan --compact portals | jq -r '.[] | select(.working) | .id'); do
  printf '%s\t' "$id"; ckan --compact --portal "$id" search "Radverkehr" --rows 0 | jq '.count'
done
```

GovData's count **includes** most Länder portals (it harvests them), so don't add it to
the per-portal counts — report it separately as "national catalogue".

## Step 2 — Search

```bash
ckan --compact --portal berlin search "Radverkehr" --rows 25 --sort "metadata_modified desc"
```

- The result is `{ count, results, sort, facets, search_facets }`. `count` is the total;
  `results` is capped by `--rows` (at most 1000 per page; page with `--start`).
- `metadata_modified desc` puts fresh data first; `metadata_created desc` is "newest
  published". An **unknown sort field is ignored silently** (you get relevance order),
  so use only these two or `score desc`/`title_string asc`.
- Narrow with `--fq`; repeat it for filters that must all match:
  `--fq organization:<name>`, `--fq groups:<name>`, `--fq tags:<tag>`,
  `--fq 'metadata_modified:[2025-01-01T00:00:00Z TO *]'`. Get valid organization and
  group names from `ckan --compact --portal <id> organizations` / `groups`.

## Step 3 — Filter by format: look up the portal's spelling first

Every portal spells formats differently — seen on 2026-09-19:

| Portal | `res_format` values |
|---|---|
| Hamburg, Schleswig-Holstein | lower case: `pdf`, `csv`, `html` (filter is case-insensitive) |
| Berlin | `CSV` **and** `csv`, `PDF` **and** `pdf` — distinct values, the filter **is** case-sensitive |
| GovData, daten.bw | mostly EU URIs: `http://publications.europa.eu/resource/authority/file-type/CSV` |
| NRW, München, Rostock | upper case: `CSV`, `JSON`, `WMS` |

So before filtering on a format, list the spellings the portal uses:

```bash
ckan --compact --portal berlin search "Radverkehr" --rows 0 --facet res_format --facet-limit -1 | jq '.facets.res_format'
```

and OR every variant that means the format:
`--fq 'res_format:("CSV" OR "csv" OR "http://publications.europa.eu/resource/authority/file-type/CSV")'`.
A plain `--fq res_format:CSV` misses most matches on GovData and a fifth of Berlin's (its 75 `csv` datasets).

## Step 4 — Read the fields that matter

| Field | Meaning |
|---|---|
| `title` / `name` | Title / slug. **Use `name`** for `ckan --portal <id> package <name>`. |
| `notes` | Description (often German, may be empty). |
| `organization.title` | Publisher. |
| `metadata_modified` | Last change — for ranking. |
| `num_resources` | Files/services; **`0` = metadata-only record**, rank it last. |
| `resources[]` | `{ name, format, url, size, license? }` — the distributions. |
| `license_id` / `license_title` | Package licence — see the licence trap. |
| `type` | `dataset`; Hamburg also has `document` and `app`. |

> **Licence trap.** The package-level `license_id` is reliable on most portals
> (Hamburg, Berlin, NRW, SH, München, Rostock), but its spelling differs: `dl-de-by-2.0`,
> `dl-by-de/2.0`, `http://dcat-ap.de/def/licenses/dl-by-de/2.0`, `CC-BY-4.0` are all
> Datenlizenz Deutschland Namensnennung 2.0 or CC BY. Map them to one short label. On
> **GovData and daten.bw the package licence is mostly empty**: read `resources[].license`
> there, and say "licence not stated" only if no resource carries one. NRW marks many
> datasets `other-closed` — say so, that data is not open.

> **Link trap.** A `resources[].url` is not always a file: `WMS`/`WFS` are map services,
> `html` resources are landing pages (in Hamburg often the council information system),
> and some URLs are empty. Call a link a download only when it looks like a file.

## Step 5 — Rank and brief

1. Drop or demote `num_resources == 0`.
2. Prefer recent `metadata_modified`; prefer datasets that carry the wanted format.
3. Collapse obvious series (yearly editions of the same dataset) into one line.

Lead with the totals, then the list:

```
"Radverkehr" — 5 portals have data (GovData, the national catalogue, lists 250):
  nrw 88 · berlin 41 · hamburg 37 · schleswig-holstein 12 · muenchen 9

Berlin, top by last update:
1. Radverkehrsanlagen (Radwege)            Senatsverwaltung für Mobilität …
   WFS, WMS, CSV · updated 2026-09-12 · DL-DE Zero 2.0 · 4 resources
   → ckan --portal berlin package radverkehrsanlagen-…
…
```

Rules:
- Always give the portal id and dataset `name`, so the user can run
  `ckan --portal <id> package <name>`.
- State formats and licence per hit; never claim a licence the record doesn't carry.
- For counts and breakdowns ("who publishes most?"), hand off to **ckan-catalogue-stats**;
  for Hamburg's Transparenzportal documents (contracts, Gutachten, Senate papers), to
  **ckan-hamburg-transparency**.
