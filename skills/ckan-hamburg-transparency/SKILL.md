---
name: ckan-hamburg-transparency
description: >
  Search the Hamburg Transparenzportal (the register the Hamburg Transparency Act
  HmbTG requires) for official documents using the ckan-cli: contracts of public
  interest, Gutachten, Senate papers, council decisions, regulations, building
  permits and more, by document type, topic and date, with the PDFs and the
  attribution text. Trigger when the user asks "which contracts did Hamburg
  publish this month?", "Gutachten zum Radverkehr in Hamburg", "latest
  Senatsmitteilungen about Wohnungsbau", "Hamburg Dienstanweisungen der
  Polizei", or anything about the Transparenzportal Hamburg.
compatibility: >
  Requires the `ckan` CLI (npm package @maschinenlesbar.org/ckan-cli) on PATH,
  installed by the user; the skill never installs it. Uses jq for JSON
  filtering. Network access to the chosen CKAN portal (default
  suche.transparenz.hamburg.de; --portal, --base-url or CKAN_BASE_URL). The CKAN
  server's own `ckan` admin command must not shadow it on PATH.
---

# Hamburg Transparenzportal Documents

Find official documents in the **Transparenzportal Hamburg** — about 245,000 records,
most of them documents (contracts, reports, Senate papers, council decisions), not
datasets — by type (*Informationsgegenstand*), topic and date, and report them with
publication date, publisher, licence and PDF links.

## Tooling

This skill drives the `ckan` command. **Before anything else, validate it is available** — run `command -v ckan` (or `ckan --version`). If it is not on your PATH, STOP and inform the user that the `ckan` CLI (`@maschinenlesbar.org/ckan-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build. The CKAN server software also installs a command named `ckan` (an admin tool): if `ckan --help` does not contain the line "CLI for any CKAN open-data portal", STOP and tell the user that a different `ckan` comes first on their PATH.

This skill also filters JSON with `jq`. **Validate it too** — run `command -v jq`. If it is missing, inform the user that `jq` is not installed — installing it is their responsibility; never install it yourself — and carry on without it: filter the CLI output with `node -e` instead (Node is already on your PATH, since the CLI runs on it).

Data comes from the `ckan` CLI over the open CKAN Action API of the chosen portal. It is read-only and needs **no API key**. Always pass `--compact` so each result is one line to pipe into `jq`. Without a portal flag, `ckan` talks to the **Hamburg Transparenzportal**; `--portal <id>` picks a known portal (`ckan portals` lists them), `--base-url <url>` any other CKAN site. A search that matches nothing returns `{"count":0,…}` and exits `0` — that is an answer, not an error. Exit `4` is an HTTP 404: after a `package`, `resource`, `organization` or `group` lookup most likely an id that doesn't exist, but after `search`, `status` or a list command it means no CKAN answers at this URL (a wrong `--base-url`, or a portal that left CKAN) — never read it as "nothing there". Exit `1` is a real error, and its message says which (a Solr syntax error, an HTML page instead of a CKAN, a redirect loop). Add `--timeout 60000` for a slow portal.

Hamburg is the default portal, so no portal flag is needed here.

## Step 1 — Filter by document type with the *stemmed* value

The type is in `extras_registerobject_type`. Filter with the **exact values from this
table** — they are what the search index holds (Solr stems the stored words):

| Filter value | Informationsgegenstand | Records¹ |
|---|---|---:|
| `beschluss` | Beschlüsse (council and district decisions, mostly ALLRIS) | 100,275 |
| `bauleitplan` | Bauleitpläne | 48,440 |
| `baugenehm` | Baugenehmigungen | 38,285 |
| `statist` | Statistiken | 13,371 |
| `geodat` | Geodaten | 9,954 |
| `senatpetitum` | Senatspetita | 6,530 |
| `messung` | Messungen | 5,081 |
| `senatmitteil` | Senatsmitteilungen | 4,730 |
| `andereveroffentlichungspflicht` | andere Veröffentlichungspflicht | 3,993 |
| `ohneveroffentlichungspflicht` | ohne Veröffentlichungspflicht | 3,504 |
| `vertrageoffinteress` | Verträge von öffentlichem Interesse | 3,072 |
| `gutacht` | Gutachten | 2,076 |
| `vergleichbar` | vergleichbare Informationen | 1,854 |
| `verwaltungsvorschrift` | Verwaltungsvorschriften | 1,374 |
| `dienstanweis` | Dienstanweisungen | 1,365 |
| `daseinsvorsorg` | Daseinsvorsorge | 935 |
| `verwaltungsbelang` | Verwaltungsbelange | 903 |
| `stadtischebeteil` | städtische Beteiligungen | 193 |
| `baumkatast` | Baumkataster | 83 |
| `subvention` | Subventionen | 71 |

¹ 2026-09-19. Refresh the table live with
`ckan --compact search --rows 0 --facet extras_registerobject_type --facet-limit -1`.

```bash
ckan --compact search "Radverkehr" --fq extras_registerobject_type:gutacht --rows 25 --sort "metadata_created desc"
```

> **Type-value trap.** Three spellings exist and only the stemmed one is reliable:
> - Hamburg's published value list (`/api/rest/enums`) gives `vertraege_oeff_interesse`,
>   `senat_mitteilungen` … — these match **nothing** (0 results, exit 0).
> - The stored value in `extras` reads `vertraegeoeffinteresse`, `senatmitteilungen`.
> - Some full words over-match: `verwaltungsvorschriften` (the example on Hamburg's own API
>   page) returns 2,717 records — the 1,374 regulations **plus** the Dienstanweisungen.
>   `verwaltungsvorschrift` returns exactly the 1,374.
>
> A record can carry several types (`dienstanweisungen, vergleichbar`), so type counts
> overlap.

## Step 2 — Filter by date on the real date fields

```bash
ckan --compact search --fq extras_registerobject_type:vertrageoffinteress \
  --fq 'metadata_created:[2026-09-01T00:00:00Z TO *]' --rows 50 --sort "metadata_created desc"
```

- Use `metadata_created` (when the record entered the portal — close to the publication
  date for new documents) or `metadata_modified`.
- **Never range-filter `extras_publishing_date`**: it is indexed as text, and a range on it
  returns nonsense (88,135 records "published after 2030"). Show `publishing_date` from
  `extras` in the answer, but filter on `metadata_created`.

## Step 3 — Narrow by publisher

`--fq organization:<name>`: `allris` (council information system: district decisions,
Drucksachen), `workflows` (contracts and Gutachten from the authorities), `hmdklgv`
(geodata and building plans), `dokrates` (Senatsmitteilungen), `statistikamt`
(Statistikamt Nord), `stadthamburg`. The office behind a document is in `author` /
`maintainer`.

> **Organization trap.** Many records have **no organization**: only 1,456 of the 3,072
> contracts and 32,989 of the 100,275 decisions have one (2026-09-19). An
> `organization:` filter therefore drops the rest silently. Filter by type and topic
> instead, and use the organization only to describe a hit.

## Step 4 — Read the record

| Field | Meaning |
|---|---|
| `title`, `name` | Title; slug for `ckan package <name>`. |
| `notes` | Summary (may be empty). |
| `type` | `document`, `dataset` or `app`. |
| `extras[]` | `{key, value}`: `registerobject_type`, `publishing_date`, `offline_date` (when it leaves the portal), `temporal_coverage_from/_to`, `file_reference_digital` (the authority's file number), `terms_of_use`. |
| `resources[]` | The files: mostly `PDF` at `https://daten.transparenz.hamburg.de/…/GetRessource100.svc/…`; `html` resources are pages in the council information system, not files. |
| `license_id` | The licence **of this record** — see below. |

> **Licence and attribution.** Set per record: 99 % `dl-de-by-2.0` (attribution
> required), but about one contract in ten and one Gutachten in five is `cc-zero`, and a
> few records are `odbl` or `geoNutz-20130319` (Hamburg's older geodata terms). The attribution text is in `extras` → `terms_of_use` (a JSON
> string): its `attribution_text`, e.g. "Namensnennung: Freie und Hansestadt Hamburg,
> Bezirksversammlung Wandsbek". Quote it when the user wants to reuse a document.

## Step 5 — Report

Lead with the count and the filters used, then the documents newest first:

```
Verträge von öffentlichem Interesse since 2026-09-01: 14 (Transparenzportal Hamburg)

2026-09-17  Mietvertrag Paloma KiezLiebe Quartier GmbH - Hamburg Kreativ GmbH
            workflows · CC0 · 1 PDF (3.2 MB)
            → ckan package mietvertrag-paloma-kiezliebe-quartier-gmbh-hamburg-kreativ-gmbh
…
```

Rules:
- Give the `publishing_date`, publisher, licence and the number and size of PDFs per
  document; the PDF links on request.
- Say which type filter you used (in words, not only the stemmed value).
- For portals other than Hamburg, or datasets rather than documents, hand off to
  **ckan-dataset-finder**; for counts and breakdowns, to **ckan-catalogue-stats**.
