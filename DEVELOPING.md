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
npm run build        # compiles every workspace (tsc -b) to its dist/
node apps/cli/dist/src/cli/index.js --help    # or: npm start -- --help
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

Every optional field of the exported option and parameter types (`EngineOptions`,
`PackageSearchParams`, `ListParams`, `GroupListParams`, `TagListParams`,
`CheckPortalsOptions`) is typed `?: T | undefined`, so a consumer compiled with
`exactOptionalPropertyTypes` can pass `{ baseUrl: process.env.CKAN_BASE_URL }`: an
option given as `undefined` means its default, as an omitted one does
(`packages/client/test/types.test.ts`).

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

Each retry is announced: the engine option `onRetry(event: RetryEvent)` (exported type:
`{ retry` (1-based), `maxRetries`, `delayMs`, `status?` (absent for a reset), `url` (userinfo
redacted) `}`) is called once per retry right before the sleep, never when there is none, and
a throw in it is swallowed. The CLI's `action()` sets it to log one `WARN` record of
`ckan.http`, `HTTP 503 from <host>: retry 1 of 3 in 2 s` (`retryMessage`; host only, whole
seconds, ms under 1 s). Tests: `packages/client/test/retry-hook.test.ts`, `apps/cli/test/retry-log.test.ts`.

`timeoutMs` and `maxResponseBytes` hold for every transport, not only the built-in
one: the engine runs each transport call under the `timeoutMs` deadline (passing an
`AbortSignal` in `HttpRequest.signal`, which the built-in transport honours; the call
rejects at the deadline either way) and checks the size of the body it gets back
(`Response exceeded the size limit of N bytes (maxResponseBytes; --max-response-bytes
on the CLI)`). A custom transport may return its headers as a plain object in any
case, a fetch `Headers` object or a `Map` (read into a record without a prototype, so a
header named `__proto__` is an ordinary header), and its body as a `Buffer`, any
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
and `date`. A URL the client refuses is a failed check, not a throw — a missing one
(`undefined`, an entry without `url`) too: it is never checked as the Hamburg default.

## Architecture

The repository is an **npm workspace** with two folders: `apps/` holds the programs it
publishes, `packages/` the libraries they are built from.

```
package.json         # private workspace manifest: no version, never packed
apps/cli/            # @maschinenlesbar.org/ckan-cli — the published package
  package.json       # its version, bin, files (no workspace package in dependencies)
  src/index.ts       # library entry: re-exports @maschinenlesbar.org/ckan-client
  src/cli/           # the CLI (below)
  test/              # CLI tests and every conformance-*.test.ts
packages/client/     # @maschinenlesbar.org/ckan-client — private, shipped inside the CLI's tarball
  src/               # the API client (below)
  scripts/           # update-portals, which rewrites src/portals-list.ts (below; not shipped)
  test/              # tests that only touch the client, + the transport helpers
tools/pack/          # prepack/postpack: ship the client (dist/node_modules) and commander in the tarball
tools/bump.mjs       # version bump + commit + tag (npm run bump)
tsconfig.docs.json   # TypeDoc only: the package entry, with the client read from its sources
```

- **The client is its own package** so a later MCP app can share it with the CLI. It is
  never published on its own: `apps/cli`'s `prepack` copies it into
  `apps/cli/dist/node_modules/`, where the CLI's imports find it, and the tarball ships it
  as plain files — so npm lists only commander (bundled) as a dependency, never the
  private client. `apps/cli/package.json` therefore doesn't name the client; prepack finds
  it through `apps/cli/tsconfig.json`'s project references. The library
  entry re-exports the client's `"."`, so `import { CkanClient } from
  "@maschinenlesbar.org/ckan-cli"` is unchanged.
- **The client's exports:** `"."` is the public library surface (`src/index.ts`);
  `"./internal/*"` maps to any module (`…/ckan-client/internal/engine`) for what the
  CLI needs beyond that; `"./test/*"` reaches the client's test helpers from the CLI's
  tests (not bundled). Only `"."` is part of the library.
- **Dependencies point one way:** the app depends on the client, the client on nothing
  in the workspace.
- **The version lives in `apps/cli/package.json`.** The root has none; a plain
  `npm version` at the root is refused. Release with `npm run bump -- <patch|minor|major>`,
  which bumps the app, commits (the bare version as the message) and tags `vX.Y.Z`.
- **TypeScript:** `tsconfig.base.json` holds the compiler options; every workspace has a
  `tsconfig.json` (`src/`, and the client's `scripts/`) and a `tsconfig.test.json`
  (`test/`), and the root `tsconfig.json`/`tsconfig.test.json` reference them, built with
  `tsc -b`.

The client (`packages/client/src/`), the CLI (`apps/cli/src/`) and the portal-list script
(`packages/client/scripts/`):

```
packages/client/src/
    types.ts     # CkanEnvelope, Status, PackageSearchResult + parameter objects
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, redirects, JSON decoding, error mapping
    errors.ts    # CkanError / CkanApiError / CkanActionError / CkanNetworkError / CkanParseError / CkanValidationError
    validate.ts  # the input rules (`…Problem` functions) and assertValid
    client.ts    # CkanClient — CKAN actions over the engine (with result-unwrapping)
    portals.ts   # portalKey, findPortal, checkPortal (live check), withCheck, checkPortals
    portals-list.ts  # PORTALS: the built-in list, rewritten by scripts/update-portals.ts
    index.ts     # the client's public surface (the library entry re-exports it)
apps/cli/src/cli/
    io.ts        # injectable I/O + env seam (CliDeps / CliIO), the logger and the clock
    log.ts       # the stderr log: records with ts, level, topic; --log-format text|jsonl
    shared.ts    # option parsers, global-option resolver, JSON renderer
    commands/
      catalogue.ts  # search, package(s), resource, organization(s), group(s), tags
      portal.ts     # status, licenses, portals, action
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
packages/client/scripts/
  portal-sources.ts  # pure: parse the upstream lists, merge, read/write the list file
  update-portals.ts  # I/O: fetch, check, rewrite packages/client/src/portals-list.ts
```

`packages/client/scripts/` is compiled with the client (to `packages/client/dist/scripts/`,
so the pure part is unit-tested) but is not in the npm package: the client ships only its
`dist/src`.

**Design notes**

- **Input validation.** The library owns every input rule. The rules are pure
  `…Problem` functions in `validate.ts` (the reason a value is invalid, or
  `undefined`); client methods enforce them with `assertValid` before any request
  and throw (a promise-returning method rejects with) `CkanValidationError`, a
  `CkanError`, with the message `Invalid <name>: <reason>`. The CLI's value
  parsers call the same functions, so the CLI and the library refuse the same
  inputs, and `run.ts` reports a `CkanValidationError` as a usage error (exit 1).
  A wrong-typed input from JavaScript is refused the same way, never as a raw
  `TypeError`: a non-string id, query, sort, tag query or base URL, a non-list
  `fq`/`facet_field`, a non-boolean `all_fields`, a `params` that is not an object,
  an `action()` parameter value the query string can't carry (an object, `NaN`), a
  `transport` or `sleep` that is not a function, a portal list that is not an array.
  An unusable action name and a blank `*_show` id are `CkanValidationError`s too.
  Messages show at most 500 characters of a URL or of server text
  (`MAX_MESSAGE_VALUE_LENGTH`, `cutForMessage`), never cut inside a surrogate pair
  (`cutText`), so a message stays well-formed. Every other value an own message quotes
  from a server answer or the user's input (a redirect target, a charset or Content-Type,
  an action name, a scheme, a `--param` or `--portal` value, an unknown command) is cut
  there too, so `err.message` stays bounded for a library caller (a typed value after its
  userinfo is redacted, so a cut never leaves part of a password); the error's `url`, `detail` and
  `body` keep the full value.
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
  output: `run.ts` (`redactionFor`, `withRedactedOutput`) takes the exact userinfo of
  every URL argument and of `CKAN_BASE_URL` (`credentialsIn`, exported) and replaces it
  with `***` in everything it prints — commander's usage errors, which echo a rejected
  `--base-url` or `--portal` value or a URL typed where the command goes, the
  client's own messages and the help's defaults — so a password with spaces,
  quotes, `#`, `?` or `/` is caught as well as an ordinary one. Only a value that
  starts with a scheme counts (a bare `a:b@c` is a dataset id, a search text or a
  User-Agent as often as a credential), except as the `--base-url` or `--portal` value
  and in `CKAN_BASE_URL`, where a `user:password@host` without its scheme is still a
  credential. The log replaces it
  in each record's *message*, before the record is cut and escaped, and writes it to
  the raw stderr: the frame (time, level, topic) is never touched, and a password with
  DEL, C1 or bidi characters is matched in its raw form. The forms a server echoes a
  userinfo back in are replaced too: the `Basic` value and the decoded `user:password`
  on stdout and stderr, the password alone (4 characters or more) on stderr only, since
  it may well occur in the data. `redactUrl` falls
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
  `CkanActionError` (a `CkanError` with `action`, CKAN's `__type` as `errorType` and the
  `url` that answered; `GET <url>: CKAN action "<name>" failed: <CKAN's error>`) when
  `success` is false: CKAN can send its error envelope with HTTP 200, and the CLI
  logs it under `api` like the same error on an error status. The typed methods also check the top-level
  shape of `result` (never a deep schema): an object for `status` and the `*_show`
  calls, `{ count, results[] }` for `packageSearch`, an array for the `*_list` calls
  (every `all_fields` page too). A missing `result` or a wrong shape raises
  `CkanParseError` `GET <url>: unexpected response shape: expected …`.
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
  Berlin counts the hidden entries in its `limit`/`offset` window but leaves them out
  of the answer, so the small last window before a `limit` is reached (`limit=1`)
  could hold only a hidden entry and come back empty, one short of the limit. A
  window smaller than a full page that comes back empty (or with nothing new) is
  therefore asked again at the same offset as a full page before it ends the list.
  The pager is bounded: pages are `ALL_FIELDS_PAGE_DELAY_MS` (100 ms) apart, and after
  `MAX_ALL_FIELDS_PAGES` (400 pages, 10,000 entries at 25) without an end it throws
  `CkanParseError` `GET <url of the last page>: <action> with all_fields: stopped after 400
  pages (MAX_ALL_FIELDS_PAGES) …`. A server whose pages keep returning new ids (or id-less
  entries with a changing field, which defeat the duplicate check) once got ~6,000
  requests a second until the process was killed. Both constants are exported.
- **Readable failures.** Every error about an answer names the request first, `GET <url>: …`
  (the URL that answered, userinfo left out, cut at 500 characters; the engine's
  `getAnswer` returns it for the client's own envelope and shape errors). A non-JSON answer
  names the content type (`GET <url>: the answer is not valid JSON (expected JSON, got
  Content-Type "text/html").`); an empty body says so (`empty response body.`); JSON that
  is not a CKAN envelope says so;
  a number JSON.parse cannot carry exactly (out of a double's range, `1e400`; past 2^53 in
  any written form, `12345678901234567890`, `…890.0`, `9007199254740993e0`; non-zero but
  too small, `1e-400`; a subnormal that does not print as written, `3e-324`, printed `5e-324`)
  is a `CkanParseError` `GET <url>: the number <N> cannot be represented exactly.`, never a changed value (`firstInexactNumber`, a
  linear scan that skips strings; below 2^53 and above the smallest normal double,
  2.2250738585072014e-308, a decimal fraction keeps a double's precision;
  past 2^53 the number as written is compared with the number as printed, `String(value)`,
  so a double a server wrote in its shortest form, `1E23` or `1.7976931348623157E308`,
  passes, while `12345678901234567890`, printed `12345678901234567000`, is refused);
  a Solr syntax error is cut down to Solr's `[Reason: …]`; a redirect loop (Bonn and
  Bielefeld redirect every API URL to itself) ends with `stopped after 5 redirects`,
  and a 3xx with a missing or malformed `Location` with `redirect not followed (no
  Location header)` / `redirect to <location> not followed`. A response nested too
  deeply to pretty-print says so (`try --compact`) instead of overflowing the stack.
  `--compact` takes V8's fast path (`JSON.stringify(value)`, the only one that prints very
  deep nesting on Node 26) unless the answer holds a string or key of 64 Mi characters or
  more (`holdsHugeString`): on Node 26 the fast path aborts the process on a ~250 MB
  string from JSON.parse, so such an answer goes through the gap path (an empty gap, the
  same text).
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
- **Free text goes out canonical.** The search text (`q`, `ckan search <query>`) and the
  tag query (`tagList({ query })`, `ckan tags --query`) are sent trimmed and in composed
  Unicode, NFC (`normalizeText`, exported): a decomposed "Gewässer" pasted from a macOS
  file name, or a trailing space, matched nothing. Inner whitespace is kept, and NFC
  changes no character of Solr's query syntax (all ASCII), so a `q` such as
  `title:Haushalt AND -type:x` keeps its meaning. Solr filters (`fq`), the sort
  expression, facet fields, ids and `action()` parameters go out exactly as given: they
  are query syntax over exact-match fields, field names or codes, where only the stored
  form decides what matches. The CLI passes the values on as typed.
- **Known parameters only.** `packageSearch` (q, fq, rows, start, sort,
  facet_field, facet_limit), `packageList` (limit, offset), `organizationList` /
  `groupList` (plus all_fields) and `tagList` (query) throw `CkanValidationError` for
  any other key, naming the known ones: CKAN ignores a parameter it doesn't know, so
  a misspelled `fqs` or a JSON `__proto__` key would run the search unfiltered. Any
  other CKAN parameter goes through `action(name, params)`. In the CLI a
  single-value option given twice is a usage error (`once` in `shared.ts`); `--fq`,
  `--facet` and `--param` repeat.
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
- **Plain `http:` gets a warning, not a refusal.** `cleartextProblem(baseUrl, secrets)`
  (engine, exported) returns one sentence naming the host (`url.host`, never the
  userinfo) and what travels unencrypted — the base URL's credentials when it carries
  userinfo — or `undefined` for `https:`, an unparseable URL and loopback hosts
  (`localhost`, `127.0.0.0/8`, `::1`). The CLI's `action()` wrapper (`shared.ts`,
  `warnOnCleartext`) logs it once per run as a `WARN` record of `ckan.http` on stderr for the
  effective base URL (`--portal` > `--base-url` > `CKAN_BASE_URL` > default), after the
  options are parsed and before the first request; `--help`, `--version`, usage errors and
  `portals` (the built-in https list) never get there.
- **Credentials in logged objects.** The client and the engine keep the base URL in
  real `#private` fields, so `console.log(client)`, `util.inspect` and
  `JSON.stringify` never show its password. The engine scrubs the base URL's
  userinfo (raw and percent-decoded) and the forms a server echoes it back in (the
  `Basic` value, the decoded `user:password`, the password alone from 4 characters:
  `echoedCredentialForms`) from error bodies and details, a CKAN
  `success:false` message, transport error text and the `cause` chain it attaches.
  A transport failure of any kind (the default transport's `CkanNetworkError`, or
  anything a custom transport throws) becomes a `CkanNetworkError`
  `GET <url, redacted> failed: <reason>`, with the original as `cause`.
- **Exit codes** (`run.ts`): 0 success/help/version, 4 for HTTP 404 and for CKAN's
  `Not Found Error` sent with HTTP 200 (`CkanActionError.isNotFound`), 1 for
  everything else.
- **Closed pipes** (`io.ts`, `handleOutputErrors`, installed by the bin before
  `run()`): an EPIPE on stdout (`| head`, `| jq` stopping early) exits 0 quietly; an
  EPIPE on stderr is ignored, so a failed run keeps its exit code (`2>&1 | true` no
  longer turns a usage error into 0). Any other stdout write error (EBADF, EIO) is an
  ERROR record of `ckan.output`, `Could not write to stdout: …`, and exits 1.

## Testing

Developed test-first (red, green, refactor), so every behaviour above has a test.

```bash
npm test          # builds, then runs `node --test` over each workspace's dist/test
npm run coverage  # the same tests in one run, with a coverage report
node --test packages/client/dist/test/client.test.js   # one file, after a build
```

The client's tests are in `packages/client/test/` (`query`, `http`, `engine`, `client`,
`retry-hook`, `portals`, `portal-sources`, `types`), everything that drives the CLI is in
`apps/cli/test/`.

- **`query.test.ts`** — query-string serialisation.
- **`validate.test.ts`** — `assertValid`, the `…Problem` rules, and how `run.ts` reports a `CkanValidationError`.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, the three CKAN error shapes, 429/503 retry, redirects.
- **`client.test.ts`** — action URL/param mapping, base-URL normalisation, result unwrapping, `fq`/`fq_list`, facets, blank ids.
- **`parity.test.ts`** — CLI ↔ library parity: one input through `run()` and through the library on one mock transport (`parity()` in `apps/cli/test/helpers.ts`), same outcome on both sides.
- **`log.test.ts`** — the record helpers of `apps/cli/src/cli/log.ts` on their own
  (`escapeForRecord`, `formatLogRecord`); the CLI-level checks are P23's.
- **`cli.test.ts`** — every command, `--portal`/`CKAN_BASE_URL` precedence, blank-value rejection, output escaping and exit codes.
- **`portals.test.ts`** — `portalKey`, `findPortal`, `checkPortal` outcomes, `checkPortals` / `checkPortalUrls` (retry, concurrency), and the invariants of the built-in list.
- **`conformance-p*.test.ts`** — the shared checks of the 2026-10-05 fix plan, copied
  from autobahn-cli with only their adapter block changed: P1 (no credential in any CLI
  output), P2 (none in a logged client or error), P3 (credentials go to their own
  origin only; from dwd-cli), P4/P19 (an unusable base URL is a usage error; help
  works whatever `CKAN_BASE_URL` holds), P5 (the limits hold for every transport;
  from destatis-genesis-cli, resets not retried), P6 (retries never burst; a Retry-After
  above 30 s fails at once naming the wait; from fim-portal-cli), P7 (closed pipes:
  no stack trace, the exit code kept; runs the built bin; from dwd-cli), P8/P9/P13
  (a declared charset is honoured; a 2xx body that is not a CKAN envelope with the
  expected `result` shape is a `CkanParseError`; a wrong-typed input is a
  `CkanValidationError`), P10 (unknown parameter keys and repeated single-value
  options are refused; from govdata-cli), P20 (a plain-`http:` base URL draws one stderr
  warning naming the host; the other-secret case is skipped: the CLI sends no API token),
  P21 (the README's relative links: README.md ships to npmjs.com, so a link to a document
  the `files` allowlist leaves out must be an absolute GitHub URL), P23 (the log on
  stderr: record format, `--log-format jsonl`, no secret in either format; since the
  2026-10-09 fix plan also one line with nothing raw, well-formed and bounded, the
  secret replaced in the message only, commander's help one record per line, the format
  commander parsed, a malformed answer under `api`, echoed credentials replaced, an
  `a:b@c` value left alone; from dip-bundestag-cli, with a `USAGE_EXIT` adapter switch
  since ckan's usage errors exit 1, and no `OUTPUT_OPTION`: ckan has no `-o`), P24 (an
  input corpus through every text filter, the search text and the tag query, and the one id
  that goes into a path, the action name: canonical or refused on both sides, never sent
  raw; from the 2026-10-21 kit) and P25 (a number the answer can't carry exactly, or an
  empty answer, is an error, never a changed value). Both adapters wrap `parity` into the
  kit's shape; P24's `USAGE_EXIT` is 1, ckan's usage exit (an ERROR record of `ckan.cli`),
  compared as it is. P26
  (`-o` integrity) is not copied: ckan has no `-o`.
- **`portal-sources.test.ts`** — parsing each upstream list, id derivation, the merge rules, and a byte-exact round trip of the list file.

No test touches the network. To check a portal by hand:

```bash
node apps/cli/dist/src/cli/index.js status
node apps/cli/dist/src/cli/index.js search --fq extras_registerobject_type:verwaltungsvorschrift --rows 1
```

## The portal list

`packages/client/src/portals-list.ts` holds the known CKAN portals in Germany as plain JSON in a
TypeScript module, so it is compiled into the CLI: `ckan portals` and `--portal <id>`
never need an outside service. Refresh it with

```bash
npm run update-portals              # build, check, rewrite the list
npm run update-portals -- --dry-run # check and report only
```

`packages/client/scripts/update-portals.ts` collects candidate URLs from three lists — **Wikidata**
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

- **ci.yml** — type-check, build and test on Node 22/24/26 for every push and PR; then pack the
  real tarball, check the pack left nothing behind, install it globally with the registry out
  of reach and run the bin.
- **release.yml** — on a `v*` tag (made by `npm run bump`): verify the tag matches
  `apps/cli/package.json`, test, write the SBOMs (scoped to the `apps/cli` workspace), then
  `npm pack --workspace apps/cli`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch from the release tag (`gh workflow run publish.yml --ref vX.Y.Z`; the version is the tag's): `npm publish --workspace apps/cli` via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — the project website and TypeDoc API docs to GitHub Pages on each `v*` tag.
  TypeDoc runs from the lockfile-pinned `tools/docs/` toolchain; locally, run
  `npm ci --prefix tools/docs` once before `npm run docs`.

## Website

The project website — <https://maschinenlesbar.org/ckan-cli/> in English and
<https://maschinenlesbar.org/ckan-cli/de/> in German — is built from `site/` with
[Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components and
[Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, and the command tree of the built CLI (`site/scripts/cli-reference.mjs`). `Usage.md`,
`GLOSSARY.md` (+ `GLOSSARY.de.md`), `EXAMPLE.md` (+ `EXAMPLE.de.md`) and the skills get pages
too once they exist. The only repo-specific files are `site/_config.yml` (which also says
where the published manifest and the built program are: `manifest: apps/cli/package.json`,
`program: apps/cli/dist/src/cli/program.js`) and `site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

The build also writes `sitemap.xml`: every page in both languages, and `/api/`. Crawlers
find it through `robots.txt` at the root of maschinenlesbar.org, which only the
organisation website can serve; its `site/_data/sites.yml` lists every site's sitemap, so a
new CLI gets a line there.

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

## The log on stderr

Every diagnostic line on stderr is a log record (`apps/cli/src/cli/log.ts`): a timestamp, a level
(`ERROR`, `WARN`, `INFO`) and a topic, `ckan.<area>`. `--log-format text` (the default)
writes it log4j style, `<ISO 8601 UTC> <LEVEL padded to 5> [<topic>] <message>`;
`--log-format jsonl` writes one JSON object per line with exactly `ts`, `level`, `topic`
and `msg`. A record is always one line: `formatLogRecord` runs `escapeForRecord` over
the message (text) or the whole JSON object (jsonl), which writes CR and LF as `\r`/`\n`,
every other C0 control but TAB, DEL and C1 as `\u00XX`, and U+2028, U+2029 and the bidi
controls as `\uXXXX`, so no text that reaches a record, by whatever path, can split it,
forge another one or steer the terminal. Before that a lone surrogate (half a
character, which jq rejects, stopping the whole stream) becomes U+FFFD (`toWellFormed`),
and a message longer than `MAX_RECORD_MESSAGE` (4000 characters, exported) is cut at a
code point and ends in `… (N more characters)`. The areas are `cli` (usage errors, commander's messages and the help it shows
after one, unexpected errors, a response nested too deeply to print), `api` (the portal's
answers: an error status, CKAN's error envelope on HTTP 200, a `CkanActionError`, and a
malformed answer, a `CkanParseError`: bad JSON, not JSON, a number it cannot carry exactly, not a CKAN envelope, the wrong
result shape, an unknown charset), `http` (the connection, the cleartext warning) and `output` (a failed
stdout write). Code logs through
`logOf(deps)` and never writes diagnostics with `io.err` directly. `run()` builds the
logger from argv before commander parses it (`logFormatFromArgv`, which skips the value
of one of the program's own value options and takes the first `--log-format`, used only for the
records of a parse error; the program's first `preAction` hook then sets the format
commander parsed, so `--user-agent --log-format=jsonl` logs text, and so does the
`CKAN_BASE_URL` check after it), so commander's own usage errors are records
too: its `error: …` an ERROR of `cli` (a `(Did you mean …?)` line joined to it; the root
action's own unknown-command error carries the same hint, `suggestSimilar`), the help it
shows after one an INFO record per line, and a command group run without its subcommand
an ERROR "missing command: `ckan <group> <subcommand>`" before that help, so every failed
run has an ERROR record (`writeCommanderErr`). The log is built with the run's redaction (`withRedactedOutput`), which replaces a secret (a
password in `--base-url` or `CKAN_BASE_URL`) in the message only, before it is escaped:
the frame is never touched, and the secret is kept out of the log in either format. `CliDeps.now` makes the
timestamps testable. stdout carries data only. What happens outside `run()`, in the bin
shim, is logged too: a failed stdout write is an ERROR record of `ckan.output`
(`handleOutputErrors`, through `processLogger(argv)`, in the format argv asks for, with
the run's redaction), and so are Node's own process warnings (`NODE_TLS_REJECT_UNAUTHORIZED=0`):
WARN records of `ckan.cli`, through `installWarningLog`, which removes Node's default
`warning` listener and logs `(node) <name>: <message>` through `processLogger(argv)`.
In `defaultDeps` a record waits for stdout (`stderrAfterStdout`): it is held while stdout
has a backlog and written, in order, once it is gone, so with `2>&1 |` and a slow reader
it never lands inside the data. Conformance test P23 checks all of this, and its body is
shared across the *-cli repos.
