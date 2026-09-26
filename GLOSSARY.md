# Glossary

A reference for the domain concepts and project-specific terms used throughout
`ckan-cli`. This tool wraps the **CKAN Action API** of any CKAN portal — by default the
**Hamburg Transparenzportal** (`suche.transparenz.hamburg.de`) — so the vocabulary is
split between **CKAN** itself (and its quirks, e.g. "package" == "dataset"), the
**portals** it runs, and the **project's own** client/CLI terms.

---

## CKAN and the portals

**CKAN.** The open-source data-management and cataloguing software (originally by the
Open Knowledge Foundation) behind many public-sector open-data portals. Every CKAN portal
offers the same **Action API**, which this client wraps; each portal adds its own fields
(`extras`) and settings.

**Portal.** One CKAN installation, addressed by its **site URL** (`--base-url`), e.g.
`https://suche.transparenz.hamburg.de` or `https://www.daten-bw.de/ckan` (a CKAN mounted
under a sub-path). A URL copied from a portal's API docs (`…/api/3/action`) is reduced to
the site URL.

**Known portal.** A German CKAN portal in the list built into the CLI, addressed by a
short **id** with `--portal` (`hamburg`, `govdata`, `berlin`, `nrw`, …). `ckan portals`
lists them with the result of their last check; `ckan portals --check` checks them live.
The list is refreshed from Wikidata, the CKAN project's instance registry and GovData's
harvest sources (see DEVELOPING.md).

**Transparenzportal Hamburg.** The default portal: the register the Hamburg Transparency
Act (**HmbTG**) requires. Most of its records are **documents** (contracts, reports, Senate
papers, council decisions), not datasets.

**GovData.** Germany's national open-data catalogue (`ckan.govdata.de`, `--portal
govdata`). It **harvests** most Länder portals, so its numbers overlap theirs.

---

## CKAN core objects

**Dataset (`Package`).** The primary catalogue unit: a described collection of resources
with a title, description, publisher, tags, licence and timestamps. CKAN's API calls it a
**package** (`package_search`, `package_show`). Addressed by id (UUID) or **name** (slug).

**Type.** A dataset's kind, in `type`: normally `dataset`; Hamburg also has `document`
and `app`.

**Resource (distribution).** One file or service within a dataset: `format`, `url`,
`size`. A resource URL is not always a file: `WMS`/`WFS` are map services, `html`
resources are usually landing pages. Addressed by id only (`ckan resource <id>`).

**Organization.** A data **publisher** that owns datasets (`ckan organizations`,
`ckan organization <id>`). On Hamburg many records have **no** organization.

**Group.** A theme or category (`ckan groups`, `ckan group <id>`).

**Tag.** A free keyword on a dataset (`ckan tags --query <substring>`). On Hamburg many
tags are whole keyword lists in one string.

**Licence (`license_id`).** The licence of a record, set per record. Portals spell the same
licence differently (`dl-de-by-2.0`, `dl-by-de/2.0`,
`http://dcat-ap.de/def/licenses/dl-by-de/2.0`); on GovData and daten.bw the package licence
is mostly empty and the licence sits on the resources. `ckan licenses` lists the licences
a portal offers.

**Extras.** Portal-specific fields as `{key, value}` pairs, searchable as `extras_<key>`.
Hamburg's: `registerobject_type` (the *Informationsgegenstand*), `publishing_date`,
`terms_of_use` (with the required attribution text), `offline_date`.

**Informationsgegenstand.** Hamburg's document type (contract, Gutachten, Senate
communication, …), in `extras_registerobject_type`. Only the **stemmed** index form
filters reliably: `vertrageoffinteress`, not `vertraege_oeff_interesse` (Hamburg's own
value list, which matches nothing).

---

## CKAN Action API mechanics

**Action API.** CKAN's RPC-style HTTP API under `<site>/api/3/action/<name>`, one action
per operation (`package_search`, `organization_list`, `status_show`, …).

**Action name.** The `[a-z0-9_]+` identifier of an action. The client rejects anything else
before a request, so a name can't smuggle in a path, query or fragment.

**Envelope.** Every response is wrapped in `{ help, success, result }`, or `{ success:
false, error }`. The client unwraps `result`; a failed envelope is an error.

**Error shapes.** CKAN reports errors three ways, all shown as one readable line: a
message (`Not Found Error: Not found`, HTTP 404), a **validation** field map
(`Validation Error: rows: Invalid integer`, HTTP 409) and a bare string for an unknown
action (HTTP 400). A Solr syntax error is cut down to Solr's own reason.

**`status_show`.** Site title, CKAN version and installed extensions (`ckan status`); some
portals lock it (Berlin answers 403).

**Generic action.** `ckan action <name> --param key=value …` calls any read action,
including those added by extensions.

---

## Search parameters (Solr)

CKAN search runs on **Apache Solr**, so its parameters use Solr syntax.

**`q` (query).** The full-text query, e.g. `elbe` or `title:haushalt`. CLI: `search
[query]`.

**`fq` (filter query).** A filter that narrows the results without changing their order,
e.g. `organization:allris`. CLI: `--fq`, repeatable; every filter must match. CKAN answers a
repeated `fq` key with HTTP 409, so one filter is sent as `fq` and several as `fq_list`.

**`rows` / `start`.** Page size and zero-based offset. CKAN caps `rows` (1000 by default),
silently; page on with `--start`.

**`sort`.** A sort expression, e.g. `metadata_modified desc`. An unknown sort field is
ignored, not refused.

**Facet (`facet.field`, `facet.limit`).** Value counts over a search result, e.g. per
publisher or format. CLI: `--facet <field>` (repeatable) and `--facet-limit <n>`; the default
limit is 50 and cuts the list off silently, `-1` returns every value. Counts are
**datasets**, not files.

**`res_format`.** A resource format, usable in `fq` and as a facet. Spelled differently per
portal (`pdf`, `PDF`, EU file-type URIs); Berlin's filter is case-sensitive.

**`metadata_created` / `metadata_modified`.** When a record entered the portal and last
changed; real date fields, so ranges work:
`--fq 'metadata_created:[2026-09-01T00:00:00Z TO *]'`. A range on an `extras_*` date is
compared as text and returns nonsense.

---

## Identifiers & pagination

**id / name.** Datasets, organizations and groups are addressed by id (UUID) or name
(slug); resources by id only.

**`limit` / `offset`.** Paging for the `*_list` actions (`packages`, `organizations`,
`groups`), distinct from search's `rows` / `start`. `--limit` is 1 or more: CKAN reads
`limit=0` as "no limit", so the CLI refuses 0; leave `--limit` out for the whole list.

**`all_fields`.** On `organizations` / `groups`, return full objects instead of names. CKAN
caps such a list at 25 entries without saying so; the client pages past the cap.

**Blank value.** An empty or whitespace-only filter, query or id is a usage error, never a
silently unfiltered search.

---

> **Library & internals.** Terms for the TypeScript client and its internals — `CkanClient`,
> the request engine, transport, retry/backoff, error types, the portal list and its update
> script — live in **[DEVELOPING.md](DEVELOPING.md)**.
