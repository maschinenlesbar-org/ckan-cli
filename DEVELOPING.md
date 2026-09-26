# Developing & integrating

This document covers `ckan-cli` as a **TypeScript library**, plus its
architecture, testing and release setup. If you just want to use the
command-line tool, start with the **[README](README.md)**.

The package ships both a CLI (`ckan`) and a typed API client (`CkanClient`) for
the read actions of any [CKAN](https://ckan.org/) portal's Action API
(`<site>/api/3/action`). The default portal is the Hamburg Transparenzportal
(`https://suche.transparenz.hamburg.de`).

**Design goals**

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Generic** — nothing portal-specific in the code. Datasets are `JsonObject`s, because every
  portal adds its own extras; portal knowledge lives in the docs.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only, no auth** — only CKAN read actions are wrapped; no key required.

## Build from source

```bash
npm install
npm run build        # compiles TypeScript to dist/
node dist/src/cli/index.js --help
```

## Library usage

```ts
import { CkanClient, CkanError } from "@maschinenlesbar.org/ckan-cli";

const hamburg = new CkanClient(); // defaults to https://suche.transparenz.hamburg.de
const govdata = new CkanClient({ baseUrl: "https://ckan.govdata.de" });

const hits = await hamburg.packageSearch({
  q: "elbe",
  fq: ["extras_registerobject_type:verwaltungsvorschrift"],
  rows: 5,
});
const record = await hamburg.packageShow(hits.results[0]!["name"] as string);
const status = await govdata.status(); // { ckan_version, extensions, … }

// Generic escape hatch for any read action, including extension actions:
const names = await hamburg.action<string[]>("package_autocomplete", { q: "elbe", limit: 3 });

try {
  await hamburg.packageShow("does-not-exist");
} catch (err) {
  if (err instanceof CkanError) console.error(err.message);
}
```

### Client options

```ts
new CkanClient({
  baseUrl: "https://ckan.govdata.de", // site URL; a trailing /api/3/action is dropped
  timeoutMs: 15_000,
  maxRetries: 3,              // 429 / 503 are retried (Retry-After, else linear backoff)
  maxResponseBytes: 50 << 20, // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",
  transport: customTransport, // inject your own HTTP transport
});
```

### Methods

`status`, `packageSearch`, `packageShow`, `packageList`, `resourceShow`,
`organizationList`, `organizationShow`, `groupList`, `groupShow`, `tagList`,
`licenseList`, and the generic `action(name, params)`. `siteRoot(url)` exposes
the base-URL normalisation.

The known portals are exported too: `PORTALS` (the built-in list),
`findPortal(idOrUrl, PORTALS)`, `portalKey(url)` and
`checkPortal(client)`, the short live check `ckan portals --check` runs.

## Architecture

```
src/
  client/
    types.ts     # CkanEnvelope, Status, PackageSearchResult + parameter objects
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects, JSON decoding, error mapping
    errors.ts    # CkanError / CkanApiError / CkanNetworkError / CkanParseError + describeCkanError
    client.ts    # CkanClient — CKAN actions over the engine (with result-unwrapping)
    portals.ts   # portalKey, findPortal, checkPortal (live check), withCheck
    portals-list.ts  # PORTALS: the built-in list, rewritten by scripts/update-portals.ts
  cli/
    io.ts        # injectable I/O + env seam (CliDeps / CliIO)
    shared.ts    # option parsers, global-option resolver, JSON renderer
    commands/
      catalogue.ts  # search, package(s), resource, organization(s), group(s), tags
      portal.ts     # status, licenses, portals, action
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
scripts/
  portal-sources.ts  # pure: parse the upstream lists, merge, read/write the list file
  update-portals.ts  # I/O: fetch, check, rewrite src/client/portals-list.ts
```

`scripts/` is compiled with the rest (to `dist/scripts/`, so the pure part is
unit-tested) but is not in the npm package, which ships only `dist/src`.

**Design notes**

- **Base URL.** `--base-url` or `--portal` (they conflict) > `CKAN_BASE_URL` > the
  Hamburg default. A query string or fragment is refused: the API path is
  appended, so it would land in front of it. `siteRoot()`
  drops a trailing `/api/3/action` or `/api/3`, because portals document their API
  with that suffix, and keeps any other path (a CKAN under `https://host/ckan`).
  commander does not run value parsers on defaults, so a `preAction` hook in
  `program.ts` checks a `CKAN_BASE_URL` value the same way `--base-url` is checked.
- **Envelope.** The client unwraps CKAN's `{ help, success, result }` and raises
  `CkanError` when `success` is false.
- **Three CKAN error shapes**, all turned into one readable line: a message
  (`{"__type": "Not Found Error", "message": "Not found"}`, HTTP 404), a validation
  field map (`{"__type": "Validation Error", "rows": ["Invalid integer"]}`, HTTP 409),
  both via `describeCkanError`, and a bare JSON string for an unknown action
  (`"Bad request - Action name not known: …"`, HTTP 400).
- **Complete `all_fields` lists.** CKAN caps `organization_list`/`group_list` with
  `all_fields` at 25 (`ckan.group_and_organization_list_all_fields_max`) and drops the
  rest silently, even for a larger `limit` (Berlin returned 24 of 55). The client pages
  until an empty page, stepping by the number of entries returned (safe with a lower
  cap), dedupes by `id`, and stops when a page adds nothing (a server that ignores
  `offset`). A page can be short without being the last: Berlin hides entries.
- **Readable failures.** A non-JSON answer names the URL and the content type
  (`Expected JSON from … but got text/html`); JSON that is not a CKAN envelope says so;
  a Solr syntax error is cut down to Solr's `[Reason: …]`; a redirect loop (Bonn and
  Bielefeld redirect every API URL to itself) ends with `stopped after 5 redirects`.
- **Filters.** CKAN reads a repeated `fq=` as a Python list and pastes it into
  Solr (HTTP 409), and splits a lone `fq_list` value into characters. So one
  filter goes out as `fq`, two or more as `fq_list`. Facet fields go out as the
  JSON list `facet.field` expects.
- **Blank input.** A blank id is rejected by the client (`*_show`), and blank
  search values, filters and tag queries are rejected by the CLI's value parsers
  (`parseNonEmpty`, `collectNonEmpty`). Otherwise CKAN would drop them and answer
  with an unfiltered result.
- **Action names** are validated against `^[a-z0-9_]+$`, so the generic `action`
  cannot inject path segments, a query string or a fragment.
- **Redirects** are followed up to `maxRedirects` (default 5). Hamburg redirects
  `http:` to `https:` with a 302. If a redirect crosses origin (scheme + host +
  port), the request headers are dropped, so nothing leaks to another host.
- **Exit codes** (`run.ts`): 0 success/help/version, 4 for HTTP 404, 1 for
  everything else.

## Testing

Developed test-first (red, green, refactor), so every behaviour above has a test.

```bash
npm test          # builds, then runs `node --test` over dist/test
node --test dist/test/client.test.js   # one file, after a build
```

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, the three CKAN error shapes, 429/503 retry, redirects.
- **`client.test.ts`** — action URL/param mapping, base-URL normalisation, result unwrapping, `fq`/`fq_list`, facets, blank ids.
- **`cli.test.ts`** — every command, `--portal`/`CKAN_BASE_URL` precedence, blank-value rejection, output escaping and exit codes.
- **`portals.test.ts`** — `portalKey`, `findPortal`, `checkPortal` outcomes, and the invariants of the built-in list.
- **`portal-sources.test.ts`** — parsing each upstream list, id derivation, the merge rules, and a byte-exact round trip of the list file.

No test touches the network. To check a portal by hand:

```bash
node dist/src/cli/index.js status
node dist/src/cli/index.js search --fq extras_registerobject_type:verwaltungsvorschrift --rows 1
```

## The portal list

`src/client/portals-list.ts` holds the known CKAN portals in Germany as plain JSON in a
TypeScript module, so it is compiled into the CLI: `ckan portals` and `--portal <id>`
never need an outside service. Refresh it with

```bash
npm run update-portals              # build, check, rewrite the list
npm run update-portals -- --dry-run # check and report only
```

`scripts/update-portals.ts` collects candidate URLs from three lists — **Wikidata**
(open-data portals in Germany with their API endpoint or website), the CKAN project's
**instance registry** (`ckan/ckan-instances`) and **GovData's harvest sources** (DCAT
feeds; the feed's directory and origin are tried) — and checks every candidate and every
listed portal live with `checkPortal`: a portal works when `package_search?rows=0`
answers with a CKAN envelope. A failed check is repeated once, and a failed source is
tried twice and otherwise skipped.

Merge rules (`mergePortals`): listed entries are never dropped — a failing one is marked
`working: false` and keeps its last version and count; a new candidate is added only when
it works; a candidate whose `status_show` names another entry's `site_url` is folded into
it (`www.govdata.de/ckan` → `ckan.govdata.de`); `id`, `title` and `note` are kept as
written; `sources` records which lists name a portal. New entries get an id from their
host (`suche.transparenz.hamburg.de` → `hamburg`).

To add a portal by hand, append an entry with `sources: ["curated"]` to the list and run
the script; it is checked and kept like the rest. Commit the rewritten list; the diff
shows what changed.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`, identical to the other
maschinenlesbar.org CLIs:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, SBOMs, and a GitHub Release.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — the project website and TypeDoc API docs to GitHub Pages on each `v*` tag.
  TypeDoc runs from the lockfile-pinned `tools/docs/` toolchain; locally, run
  `npm ci --prefix tools/docs` once before `npm run docs`.

## Website

The project website — <https://maschinenlesbar-org.github.io/ckan-cli/> in English and
<https://maschinenlesbar-org.github.io/ckan-cli/de/> in German — is built from `site/` with
[Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components and
[Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, and the command tree of the built CLI (`site/scripts/cli-reference.mjs`). `Usage.md`,
`GLOSSARY.md` (+ `GLOSSARY.de.md`), `EXAMPLE.md` (+ `EXAMPLE.de.md`) and the skills get pages
too once they exist. The only repo-specific files are `site/_config.yml` and
`site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/ckan-cli/
```

The command reference is read from the CLI as built, so run it without `CKAN_BASE_URL` set,
or the `--base-url` default shown on the site is that value instead of Hamburg's.

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
