# ckan-cli — Usage

Real, use-case-driven examples for the `ckan` CLI: a read-only client for the **CKAN
Action API** of any CKAN open-data portal — by default the
[Hamburg Transparenzportal](https://transparenz.hamburg.de/) (`suche.transparenz.hamburg.de`).
Search datasets and documents, inspect records and resources, count with facets, and
switch to any other portal.

CKAN wraps every response in `{ help, success, result }`. This CLI prints the
**unwrapped `result`** and exits non-zero on an error, so the examples below pipe straight
into [`jq`](https://jqlang.github.io/jq/).

## Install

```bash
npm i -g @maschinenlesbar.org/ckan-cli
```

This installs the **`ckan`** binary. Without a global install you can run it straight from
the build output: `node dist/src/cli/index.js <command>`. The examples use `ckan`.

## Use cases

### 1. Full-text search

```bash
ckan search elbe --rows 5
ckan --compact search elbe --rows 5 | jq -r '.results[] | "\(.name)  \(.title)"'
```

`count` is the total number of hits; `results` holds at most `--rows` of them.

### 2. Newest records first

```bash
ckan search Radverkehr --rows 10 --sort "metadata_created desc"
```

### 3. Filter — one or several `--fq`

```bash
# Hamburg's administrative regulations (Verwaltungsvorschriften)
ckan search --fq extras_registerobject_type:verwaltungsvorschrift --rows 5

# Two filters: both must match (sent as CKAN's fq_list)
ckan search --fq extras_registerobject_type:gutacht --fq 'metadata_created:[2025-01-01T00:00:00Z TO *]' --rows 5
```

On Hamburg, filter the document type with its **stemmed** value (`gutacht`,
`vertrageoffinteress`, `senatmitteil` …); see the [Glossary](GLOSSARY.md).

### 4. Count with facets

```bash
# Which publishers and formats, and how often (all values, not just the top 50)
ckan --compact search --rows 0 --facet organization --facet res_format --facet-limit -1 | jq '.facets'

# Hamburg's document types
ckan --compact search --rows 0 --facet extras_registerobject_type --facet-limit -1 | jq '.facets.extras_registerobject_type'
```

### 5. Page through a large result set

```bash
ckan --compact search elbe --rows 100 --start 0   | jq '.results | length'
ckan --compact search elbe --rows 100 --start 100 | jq '.results | length'
```

`--rows` is capped by the portal (1000 on Hamburg); page on with `--start`.

### 6. One record and its resources

```bash
ckan package bezirk-wandsbek-drucksache-22-3573-2
ckan --compact package bezirk-wandsbek-drucksache-22-3573-2 | jq '.resources[] | {format, url}'
ckan resource 4bb495c8-1180-434d-b1a5-10191a795a48
```

### 7. Publishers, themes and tags

```bash
ckan organizations
ckan --compact organizations --all-fields | jq '.[] | {name, title, package_count}'
ckan groups
ckan tags --query Alster
```

`--all-fields` lists are complete: CKAN caps them at 25 entries, and the client pages past
that.

### 8. Another portal

```bash
ckan portals                                       # the known German portals
ckan --portal berlin search Radverkehr --rows 3    # one of them, by id
ckan --base-url https://ckan.govdata.de status     # any CKAN, by site URL
export CKAN_BASE_URL=https://www.opendata-hro.de   # for a whole session
ckan status
```

### 9. Check the known portals live

```bash
ckan --compact portals --check | jq -r '.[] | "\(.id)\t\(.working)\t\(.datasets)"'
```

### 10. Call any read action

```bash
ckan action package_autocomplete --param q=elbe --param limit=3
ckan action help_show --param name=package_search
```

## Global options

| Option | Description |
| --- | --- |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `--base-url <url>` | CKAN site URL (env `CKAN_BASE_URL`; default `https://suche.transparenz.hamburg.de`) |
| `--portal <id>` | a known portal by id (`ckan portals`); cannot be combined with `--base-url` |
| `--timeout <ms>` | Per-request timeout (default `30000`; at most `2147483647`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (`0`–`10`, default `2`; each waits the server's `Retry-After`, up to 30 s) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

Blank values (`search ""`, `--fq ""`, an empty id, `--param q=`) are usage errors, never an unfiltered
search. Exit codes: `0` success, `4` not found (HTTP 404), `1` anything else.
