# ckan-cli

[![CI](https://github.com/maschinenlesbar-org/ckan-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/ckan-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/ckan-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/ckan-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/ckan-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/ckan-cli)

**Website:** [English](https://maschinenlesbar-org.github.io/ckan-cli/) · [Deutsch](https://maschinenlesbar-org.github.io/ckan-cli/de/) — command reference, guides and API docs

Search any [CKAN](https://ckan.org/) open-data portal from your terminal. `ckan`
is a command-line tool over the CKAN Action API (`<portal>/api/3/action`), which
many public-sector catalogues run on. Out of the box it talks to the
[Hamburg Transparenzportal](https://transparenz.hamburg.de/api-796358)
(`suche.transparenz.hamburg.de`), and `--base-url` points it at any other CKAN:
search, inspect, filter and pipe straight into [`jq`](https://jqlang.github.io/jq/).

- **Any CKAN portal** — Hamburg by default; 18 known German portals by name
  (`--portal berlin`), and any other CKAN 2.x portal with `--base-url` or
  `CKAN_BASE_URL`.
- **No account, no API key** — only the open read actions are used.
- **Clean JSON output** — the CKAN envelope is unwrapped for you; `--compact`
  for one-line/scripting.
- **Thirteen commands** — `search`, `package`, `packages`, `resource`,
  `organizations`, `organization`, `groups`, `group`, `tags`, `licenses`,
  `status`, `portals`, and a generic `action` escape hatch for everything else.

> Want to use this as a TypeScript library or understand how it's built?
> See **[DEVELOPING.md](DEVELOPING.md)**.

## Install

```bash
npm i -g @maschinenlesbar.org/ckan-cli
```

This installs the **`ckan`** command. Requires **Node.js 20+**.

## Quickstart

The two examples from Hamburg's API page, as commands. A full-text search:

```bash
ckan search elbe --rows 5
```

All administrative regulations (*Verwaltungsvorschriften*), using a filter
query on one of Hamburg's own fields. The filter takes the **stemmed** value
the search index holds: Hamburg's API page writes `verwaltungsvorschriften`,
which also matches the *Dienstanweisungen* and returns twice as many records.

```bash
ckan search --fq extras_registerobject_type:verwaltungsvorschrift --rows 5
```

The result is unwrapped from CKAN's `{ help, success, result }` envelope, so you
get `{ count, results, … }` directly. Pull out the titles with `jq`, then fetch
one full record by its `name`:

```bash
ckan search elbe --rows 5 | jq -r '.results[] | "\(.name)  \(.title)"'
ckan package bezirk-wandsbek-drucksache-22-3573-2
```

## Choosing a portal

`--portal <id>` picks a known portal by name, `--base-url` takes any CKAN site
URL, and `CKAN_BASE_URL` sets a URL for a whole shell session. Either flag wins
over the variable, and the variable over the Hamburg default.

```bash
ckan --portal berlin search Radverkehr --rows 3
ckan --base-url https://ckan.govdata.de search Haushalt --rows 3
export CKAN_BASE_URL=https://www.opendata-hro.de
ckan status
```

Give the portal's **site URL**. A URL copied from a portal's API docs works too:
a trailing `/api/3/action` (or `/api/3`) is dropped, and a CKAN mounted under a
sub-path keeps it (`https://open.canada.ca/data`). `ckan status` is a good first
call on an unfamiliar portal: it shows the CKAN version and the installed
extensions.

### Known portals

`ckan portals` lists the CKAN portals in Germany this version knows, with the
result of their last check; `ckan portals --check` checks them all live now.
The list is built into the CLI, so it needs no outside service:

| `--portal` | Portal | Datasets |
| --- | --- | --- |
| `hamburg` | Transparenzportal Hamburg (default) | 245,651 |
| `govdata` | GovData, the national catalogue | 167,870 |
| `schleswig-holstein` | Open-Data Schleswig-Holstein | 32,195 |
| `nrw` | Open.NRW | 11,099 |
| `ruhr` | Open Data Portal Ruhr | 3,211 |
| `berlin` | Berlin Open Data | 2,626 |
| `bw` | daten.bw | 2,067 |
| `zbw-journaldata` | ZBW Journal Data Archive | 2,009 |
| `hessen` | opendata.hessen.de | 1,559 |
| `offenesdatenportal` | Offenesdatenportal.de (Moers, Wesel, …) | 1,118 |
| `uni-hannover` | Forschungsdaten-Repositorium der LUH | 495 |
| `leipzig` | Open Data Leipzig | 412 |
| `muenchen` | Open Data München | 337 |
| `rostock` | OpenData.HRO | 282 |
| `aachen` | Open Data Aachen | 227 |
| `karlsruhe` | Transparenzportal Karlsruhe | 151 |
| `greifswald` | Open Data Greifswald | 39 |
| `ble` | Bundesministerium für Ernährung und Landwirtschaft | 38 |

Counts as of the last check, 2026-09-19. The list is refreshed from Wikidata,
the CKAN project's instance registry and GovData's harvest sources, keeping only
portals that pass a live check (see [DEVELOPING.md](DEVELOPING.md#the-portal-list)).
Many portals those lists name have left CKAN (Köln, Düsseldorf, Bonn, …).

## Commands

```text
search [query] [filters…]              search datasets
package <id>                           show one dataset by id or name
packages [--limit <n>] [--offset <n>]  list dataset names
resource <id>                          show one resource (distribution)
organizations [--all-fields] [paging]  list organizations (publishers)
organization <id>                      show one organization
groups [--all-fields] [paging]         list groups (themes/categories)
group <id>                             show one group
tags [--query <substring>]             list tags
licenses                               list the licences the portal offers
status                                 site title, CKAN version, extensions
portals [--check]                      list (and check) the known portals
action <name> [--param key=value …]    call any CKAN action (generic)
```

### `search` filters

| Flag | Meaning |
| --- | --- |
| `[query]` | free-text Solr query, e.g. `elbe` or `title:haushalt` |
| `--fq <filter>` | Solr filter query, e.g. `organization:allris` (repeatable; every filter must match) |
| `--facet <field>` | count the values of a field, e.g. `res_format` (repeatable); counts come back in `facets` / `search_facets` |
| `--facet-limit <n>` | max values per facet (CKAN's default is 50; `-1` for all) |
| `--rows <n>` | max results to return |
| `--start <n>` | zero-based offset for paging |
| `--sort <expr>` | Solr sort expression, e.g. `metadata_modified desc` |

> **`--rows` is capped by the server.** CKAN limits one search page
> (`ckan.search.rows_max`, 1000 by default; Hamburg uses 1000). Asking for more
> is not an error: you get at most the cap back, while `count` still reports the
> true total. Page on with `--start`.

> **Several `--fq` filters** are sent as CKAN's `fq_list`, never as a repeated
> `fq` key, which CKAN answers with HTTP 409.

> **Blank values are refused.** `ckan search ""`, `--fq ""`, `tags --query ""` or
> `action … --param q=` exit 1 before any request, instead of silently running an unfiltered search.
> So does a forgotten value (`--fq --rows 5`): a value of `--fq`, `--facet`,
> `--sort` or `tags --query` cannot start with `--`.

### Paging and list flags

| Command | Flags |
| --- | --- |
| `packages` | `--limit <n>` (1 or more; omit for the whole list), `--offset <n>` |
| `organizations`, `groups` | `--all-fields` (full objects instead of names), `--limit <n>`, `--offset <n>` |

> **`--all-fields` lists are complete.** CKAN caps them at 25 entries
> (`ckan.group_and_organization_list_all_fields_max`) and drops the rest
> silently, even for a larger `--limit`; `ckan` pages through them for you.
| `tags` | `--query <substring>` |

### `action`

`ckan action <name> --param key=value …` calls any read action the portal
exposes, including actions added by extensions, e.g.
`ckan action package_autocomplete --param q=elbe --param limit=3`. The name must
match `^[a-z0-9_]+$`, and duplicate `--param` keys are rejected; both are checked
before any request is sent.

## Hamburg: what to know

- **Mostly documents, not datasets.** Hamburg publishes what the Hamburg
  Transparency Act (HmbTG) requires: council papers, contracts, reports,
  regulations, geodata. Most records have `type: "document"`.
- **The *Informationsgegenstand*** is in `extras_registerobject_type`. Filter
  it with the **stemmed** value the search index holds (`verwaltungsvorschrift`,
  `vertrageoffinteress`, `gutacht`, `geodat`, …). Hamburg's own value list at
  <https://suche.transparenz.hamburg.de/api/rest/enums> (Hamburg-specific, not
  part of the CKAN Action API) gives other spellings: `vertraege_oeff_interesse`
  matches nothing, and a full word such as `verwaltungsvorschriften` over-matches.
  List the values that work, with their counts:
  `ckan --compact search --rows 0 --facet extras_registerobject_type --facet-limit -1`.
  The [Glossary](GLOSSARY.md) has the details.
- **Several filters work.** Hamburg's API page says only one filter can be
  used; with `fq_list` (repeat `--fq`) they combine:
  `ckan search --fq extras_registerobject_type:verwaltungsvorschrift --fq organization:workflows`.
- **Tags are free text.** Many tags are whole keyword lists in a single string,
  so `tags --query` matches substrings of those strings.

## Portal quirks

Found by running the same commands against many portals:

- **Some portals lock `status_show`** (Berlin: HTTP 403). Everything else works.
- **An unknown `--sort` field is ignored**, not refused: CKAN returns an
  unsorted result and echoes the sort back. A malformed sort expression is refused.
- **`packages` and `search` count differently**: `package_list` includes records
  that search does not show (a few dozen more on GovData and NRW).
- **The default sort differs** (ZBW sorts by `metadata_created desc`).
- **Field types vary**: licence ids are URIs on GovData, and some portals send
  booleans as the strings `"True"`/`"False"`.
- **Solr syntax errors** come back as HTTP 409; `ckan` prints Solr's own reason,
  e.g. `Search Error: Cannot parse 'title:(': Encountered "<EOF>" …`.
- **A site that is not (or no longer) a CKAN** answers with a 404, an HTML page or
  a redirect loop; `ckan` says which, e.g.
  `Expected JSON from … but got text/html`.

## Output & scripting

Every command prints the **unwrapped `result`** as pretty JSON to stdout.
Errors go to stderr, so piping stdout into `jq` stays clean. `--compact`
prints one line. Every global option works before or after the command.

```bash
# How many records a portal has
ckan search --rows 0 | jq '.count'

# Which publishers and formats dominate
ckan --compact search --rows 0 --facet organization --facet res_format --facet-limit 5 | jq '.facets'

# The download URLs of a record
ckan package bezirk-wandsbek-drucksache-22-3573-2 | jq '.resources[] | {format, url}'
```

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | success (also `--help`, `help [command]`, `--version` and a bare `ckan`) |
| `4` | not found (HTTP `404`), e.g. an unknown dataset id |
| `1` | any other error — bad usage, validation error (`409`), unknown action (`400`), CKAN `success:false`, network failure |

CKAN's error text is shown on stderr, e.g.
`Validation Error: rows: Invalid integer` or
`Bad request - Action name not known: …`.

> **Numbers pass through JavaScript.** The output is the parsed and re-serialised
> JSON, so an integer above 2⁵³ (9,007,199,254,740,992) loses its last digits and a
> number beyond the double range (`1e400`) prints as `null`. CKAN metadata rarely
> holds such numbers; for an exact copy of the raw answer, use `curl` on
> `<site>/api/3/action/<name>`.

## Global options

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version number |
| `-h, --help` | Show help for the program or a command |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `--base-url <url>` | CKAN site URL (env `CKAN_BASE_URL`; default `https://suche.transparenz.hamburg.de`) |
| `--portal <id>` | a known portal by id (`ckan portals`); cannot be combined with `--base-url` |
| `--timeout <ms>` | Per-request timeout (default `30000`; at most `2147483647`) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (`0`–`10`, default `2`). Each retry waits the server's `Retry-After` (up to 30 s; a longer one is not retried) or else backs off linearly |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

## Claude Code skills

Three [Agent Skills](SKILLS.md) teach Claude Code to use `ckan` for real questions: find
which portals have data on a topic and rank the hits (**ckan-dataset-finder**), build
publisher/format/licence statistics (**ckan-catalogue-stats**), and search the Hamburg
Transparenzportal's contracts, Gutachten and Senate papers
(**ckan-hamburg-transparency**). Install them from the maschinenlesbar.org marketplace:

```
/plugin marketplace add maschinenlesbar-org/plugins
/plugin install ckan@maschinenlesbar
```

Real runs of each skill are in [EXAMPLE.md](EXAMPLE.md).

## Data license

This CLI is a **client**. It accesses data it does not own or redistribute, and
the data is licensed **separately from this tool's code**: by each portal, and
often per dataset. See **[DATA_LICENSE.md](DATA_LICENSE.md)**.

## License

**Dual-licensed** — use it under **either**:

- **[AGPL-3.0-or-later](LICENSE)** (default, free). Note the AGPL's §13 network
  clause: if you run a modified version as a network service, you must offer that
  modified source to the service's users.
- **Commercial license** (paid), for closed-source / proprietary or SaaS use
  without the AGPL's obligations.

See **[LICENSING.md](LICENSING.md)** for details, and **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the contribution policy (this project does not accept external code
contributions). Commercial enquiries: **sebs@2xs.org**.
