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
  timeoutMs: 15_000,          // 0..MAX_TIMEOUT_MS (2^31 - 1); 0 disables
  maxRetries: 3,              // 0..MAX_RETRIES (10); 429 / 503 are retried (linear backoff; a longer Retry-After up to 30 s)
  maxResponseBytes: 50 << 20, // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",    // not blank; no control characters but tab; Latin-1 only
  transport: customTransport, // inject your own HTTP transport
});
```

The numeric options (`timeoutMs`, `maxRetries`, `retryDelayMs` up to
`MAX_RETRY_AFTER_MS`, `maxRedirects` up to `MAX_REDIRECTS`, `maxResponseBytes`) must be non-negative safe integers within their
range. The constructor throws `CkanValidationError` otherwise: a negative or `NaN`
timeout or size cap would silently switch that guard off. The CLI's `--timeout`,
`--max-retries` and `--max-response-bytes` use the same bounds (`intRangeProblem`).

Retries never burst: a 429/503 waits `retryDelayMs * attempt` (linear), and a
`Retry-After` can only lengthen that wait (`Retry-After: 0` or a past date waits the
backoff). A `Retry-After` above `MAX_RETRY_AFTER_MS` (30 s) is not retried; the
`CkanApiError` says so (`the server asked to retry after 3600 s, longer than the 30 s
the client waits; not retried — try again after that`) and carries `retryAfterMs`.
After spent retries the message ends `(after N retries)` and `retries` holds the count.

`timeoutMs` and `maxResponseBytes` hold for every transport, not only the built-in
one: the engine runs each transport call under the `timeoutMs` deadline (passing an
`AbortSignal` in `HttpRequest.signal`, which the built-in transport honours; the call
rejects at the deadline either way) and checks the size of the body it gets back
(`Response exceeded the size limit of N bytes (maxResponseBytes; --max-response-bytes
on the CLI)`). A custom transport may return its headers as a plain object in any
case, a fetch `Headers` object or a `Map`, and its body as a `Buffer`, any
`ArrayBuffer` view (fetch's `Uint8Array`) or an `ArrayBuffer`. Anything it throws, and
a response without a valid status, headers object or body, becomes a
`CkanNetworkError`. A reset connection is not retried (only 429/503 are), and a
redirect to a scheme other than http(s) is refused before the transport sees it.
A minimal fetch transport:

```ts
const transport: Transport = async (req) => {
  const r = await fetch(req.url, { method: req.method, headers: req.headers, redirect: req.redirect, signal: req.signal });
  return { status: r.status, headers: r.headers as never, body: new Uint8Array(await r.arrayBuffer()) as Buffer, url: r.url };
};
```

`userAgent` goes through `assertHeaderValue` (exported; the rule is
`headerValueProblem`, which `--user-agent` uses too): a blank value, a C0 control
other than tab (CR/LF included), DEL or a character above U+00FF throws
`CkanValidationError` at construction, so it never reaches a custom transport as a
forged header. Only `undefined` selects the default `ckan-cli`. Should a transport
call still be handed a header Node cannot send, the default transport rejects with
`CkanNetworkError` `Invalid request: …`, never a raw `TypeError`.

### Methods

`status`, `packageSearch`, `packageShow`, `packageList`, `resourceShow`,
`organizationList`, `organizationShow`, `groupList`, `groupShow`, `tagList`,
`licenseList`, and the generic `action(name, params)`. `siteRoot(url)` exposes
the base-URL normalisation, `validateBaseUrl(url)` the base-URL check.

The known portals are exported too: `PORTALS` (the built-in list),
`findPortal(idOrUrl, PORTALS)`, `portalKey(url)`, `checkPortal(client)` (the short
live check of one portal), and the whole check `ckan portals --check` runs:

```ts
import { checkPortals, PORTALS } from "@maschinenlesbar.org/ckan-cli";

// Every portal checked live (6 at a time), each entry dated today.
const list = await checkPortals(PORTALS, { engineOptions: { timeoutMs: 15_000 } });
```

`checkPortals(portals, options)` folds each result into its entry (`withCheck`);
`checkPortalUrls(urls, options)` returns the bare `PortalCheck`s. Options:
`engineOptions` (`baseUrl` is replaced per portal), `createClient`, `concurrency`
(default `DEFAULT_CHECK_CONCURRENCY`, 6), `retryDelayMs` (when set, a failed check is
repeated once after that pause; the CLI makes a single try, `update-portals` retries)
and `date`. A URL the client refuses is a failed check, not a throw.

## Architecture

```
src/
  client/
    types.ts     # CkanEnvelope, Status, PackageSearchResult + parameter objects
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects, JSON decoding, error mapping
    errors.ts    # CkanError / CkanApiError / CkanNetworkError / CkanParseError / CkanValidationError
    validate.ts  # the input rules (`…Problem` functions) and assertValid
    client.ts    # CkanClient — CKAN actions over the engine (with result-unwrapping)
    portals.ts   # portalKey, findPortal, checkPortal (live check), withCheck, checkPortals
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

- **Input validation.** The library owns every input rule. The rules are pure
  `…Problem` functions in `validate.ts` (the reason a value is invalid, or
  `undefined`); client methods enforce them with `assertValid` before any request
  and throw (a promise-returning method rejects with) `CkanValidationError`, a
  `CkanError`, with the message `Invalid <name>: <reason>`. The CLI's value
  parsers call the same functions, so the CLI and the library refuse the same
  inputs, and `run.ts` reports a `CkanValidationError` as a usage error (exit 1).
- **Base URL.** `--base-url` or `--portal` (they conflict) > `CKAN_BASE_URL` > the
  Hamburg default (an empty `CKAN_BASE_URL` counts as unset; in the library only
  `undefined` selects the default). One rule set, `baseUrlProblem`, applied by the
  exported `validateBaseUrl()` in the `CkanClient` and `RequestEngine` constructors
  and in `siteRoot()`: a blank value, whitespace or a control character anywhere in
  it (`new URL` trims and drops tab and newline, but the value is glued into every
  request URL as given), anything but an absolute http(s) URL, and a query string or
  fragment (the API path is appended, so it would land in front of it), and a `%`
  in the user name or password that does not start an escape (write `%25`; the
  engine decodes the userinfo for the Authorization header) all throw
  `CkanValidationError` `Invalid base URL: …` — a configuration mistake, never a
  `CkanNetworkError`, which stays for transport failures (the default transport
  still re-checks the scheme on every hop and redirect). Userinfo is allowed and
  redacted in messages; the reasons never repeat the value. The CLI also redacts on
  output: `run.ts` (`withRedactedOutput`) takes the exact userinfo of every
  argument and of `CKAN_BASE_URL` (`credentialsIn`, exported) and replaces it with
  `***` in everything it prints — commander's usage errors, which echo a rejected
  `--base-url` or `--portal` value or a URL typed where the command goes, the
  client's own messages and the help's defaults — so a password with spaces,
  quotes, `#`, `?` or `/` is caught as well as an ordinary one. `redactUrl` falls
  back to the same text-based cut (`redactCredentials`) for a value that doesn't
  parse as a URL, so an unparseable `CKAN_BASE_URL` shows as `https://***@…` in
  `--help` too. `siteRoot()` drops a trailing `/api/3/action` or `/api/3`,
  because portals document their API with that suffix, and keeps any other path (a
  CKAN under `https://host/ckan`). The CLI's `parseBaseUrl` calls `baseUrlProblem`;
  commander does not run value parsers on defaults, so a `preAction` hook in
  `program.ts` checks a `CKAN_BASE_URL` value the same way `--base-url` is checked —
  for the commands that use it: help, a bare `ckan` and `portals` (which prints the
  built-in list, or checks each portal at its own URL) work whatever the variable
  holds.
- **Envelope.** The client unwraps CKAN's `{ help, success, result }` and raises
  `CkanError` when `success` is false. The typed methods also check the top-level
  shape of `result` (never a deep schema): an object for `status` and the `*_show`
  calls, `{ count, results[] }` for `packageSearch`, an array for the `*_list` calls
  (every `all_fields` page too). A missing `result` or a wrong shape raises
  `CkanParseError` `Unexpected response shape from /api/3/action/<name>: expected …`.
  The generic `action()` passes any `result` through, `null` included.
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
  Bielefeld redirect every API URL to itself) ends with `stopped after 5 redirects`,
  and a 3xx with a missing or malformed `Location` with `redirect not followed (no
  Location header)` / `redirect to <location> not followed`. A response nested too
  deeply to pretty-print says so (`try --compact`) instead of overflowing the stack.
- **Filters.** CKAN reads a repeated `fq=` as a Python list and pastes it into
  Solr (HTTP 409), and splits a lone `fq_list` value into characters. So one
  filter goes out as `fq`, two or more as `fq_list`. Facet fields go out as the
  JSON list `facet.field` expects.
- **Blank input.** The client refuses a blank (empty or whitespace-only) value
  before any request: a blank id (`*_show`), a blank `q`, `sort`, `fq` entry or
  `facet_field` entry (`packageSearch`), a blank tag query (`tagList`), and in
  `action()` a blank parameter name or value (or list entry). The rule is
  `blankProblem` (`CkanValidationError` `Invalid <name>: Expected a non-empty
  value.`); `undefined` still means "not given". CKAN would otherwise drop the
  value and answer with an unfiltered result. The CLI's value parsers
  (`parseNonEmpty`, `collectNonEmpty`, `--param`) apply the same rule as a usage
  error.
- **Paging bounds.** The client refuses, before any request, a `limit` that is not a
  positive integer, a `rows`, `start` or `offset` that is not a non-negative safe
  integer (`countProblem`) and a `facet_limit` other than -1 or a non-negative
  integer (`facetLimitProblem`), all with `CkanValidationError`. The `offset` check
  runs before the `all_fields` pager steps on from it. The generic `action()` passes
  its params through unchecked apart from blank values.
- **Action names** are validated against `^[a-z0-9_]+$`, so the generic `action`
  cannot inject path segments, a query string or a fragment.
- **Redirects** are followed up to `maxRedirects` (default 5). Hamburg redirects
  `http:` to `https:` with a 302. If a redirect crosses origin (scheme + host +
  port), only the engine's own `Accept` and `User-Agent` go along (an allowlist), so no
  other header leaks to another host.
- **Credentials per hop.** A base URL's userinfo (`https://user:pw@host`) never reaches
  the transport inside the URL: the engine sends it as an `Authorization: Basic …`
  header that it manages per hop. A redirect on the same origin keeps it, relative or
  absolute `Location`; one to another origin drops it (the allowlist above), and a
  401/403 after such a drop says so (`the server redirected http→https, which dropped
  the base URL's credentials; use an https base URL`). A userinfo inside a `Location`
  is never used. `HttpRequest.redirect` is always `"manual"`: a transport must not
  follow redirects itself, and a response whose `HttpResponse.url` lies on another
  origin is rejected as a `CkanNetworkError`. Messages show the request URL without
  the userinfo.
- **Credentials in logged objects.** The client and the engine keep the base URL in
  real `#private` fields, so `console.log(client)`, `util.inspect` and
  `JSON.stringify` never show its password. The engine scrubs the base URL's
  userinfo (raw and percent-decoded) from error bodies and details, a CKAN
  `success:false` message, transport error text and the `cause` chain it attaches.
  A transport failure of any kind (the default transport's `CkanNetworkError`, or
  anything a custom transport throws) becomes a `CkanNetworkError`
  `GET <url, redacted> failed: <reason>`, with the original as `cause`.
- **Exit codes** (`run.ts`): 0 success/help/version, 4 for HTTP 404, 1 for
  everything else.

## Testing

Developed test-first (red, green, refactor), so every behaviour above has a test.

```bash
npm test          # builds, then runs `node --test` over dist/test
node --test dist/test/client.test.js   # one file, after a build
```

- **`query.test.ts`** — query-string serialisation.
- **`validate.test.ts`** — `assertValid`, the `…Problem` rules, and how `run.ts` reports a `CkanValidationError`.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, the three CKAN error shapes, 429/503 retry, redirects.
- **`client.test.ts`** — action URL/param mapping, base-URL normalisation, result unwrapping, `fq`/`fq_list`, facets, blank ids.
- **`parity.test.ts`** — CLI ↔ library parity: one input through `run()` and through the library on one mock transport (`parity()` in `helpers.ts`), same outcome on both sides.
- **`cli.test.ts`** — every command, `--portal`/`CKAN_BASE_URL` precedence, blank-value rejection, output escaping and exit codes.
- **`portals.test.ts`** — `portalKey`, `findPortal`, `checkPortal` outcomes, `checkPortals` / `checkPortalUrls` (retry, concurrency), and the invariants of the built-in list.
- **`conformance-p*.test.ts`** — the shared checks of the 2026-10-05 fix plan, copied
  from autobahn-cli with only their adapter block changed: P1 (no credential in any CLI
  output), P2 (none in a logged client or error), P3 (credentials go to their own
  origin only; from dwd-cli), P4/P19 (an unusable base URL is a usage error; help
  works whatever `CKAN_BASE_URL` holds), P5 (the limits hold for every transport;
  from destatis-genesis-cli, resets not retried), P6 (retries never burst; a Retry-After
  above 30 s fails at once naming the wait; from fim-portal-cli).
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
listed portal live with `checkPortalUrls` (the library function `ckan portals --check`
uses too): a portal works when `package_search?rows=0` answers with a CKAN envelope. A
failed check is repeated once (`retryDelayMs`), and a failed source is tried twice and
otherwise skipped.

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
