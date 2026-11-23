# ckan-mcp

An [MCP](https://modelcontextprotocol.io/) server for German CKAN open-data portals: by default
the [Transparenzportal Hamburg](https://transparenz.hamburg.de/) (about 250,000 records, most of
them official documents: contracts, Gutachten, Senate papers, council decisions), and per call
any portal of a built-in list: Berlin, Open.NRW, Schleswig-Holstein, München, daten.bw, Hessen,
GovData and more. Find and count datasets, see which portals have data on a topic, and search
Hamburg's transparency register for documents, as tools for AI agents. Read-only, no API key.
The licence is set per record, and each portal has its own terms (see Licence).

It is the MCP side of [ckan-cli](https://github.com/maschinenlesbar-org/ckan-cli), built on
the same typed client, and released with it.

## Install

```bash
npm i -g @maschinenlesbar.org/ckan-mcp
```

This installs the **`ckan-mcp`** command (Node.js 22.12+). Or run the container image, for
linux/amd64 and linux/arm64, which needs no Node.js:

```bash
docker run -i --rm ghcr.io/maschinenlesbar-org/ckan-mcp:latest
```

## Connect a client

The server speaks MCP on stdio by default.

**Claude Code**

```bash
claude mcp add ckan -- ckan-mcp
# or with the image:
claude mcp add ckan -- docker run -i --rm ghcr.io/maschinenlesbar-org/ckan-mcp:latest
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{ "mcpServers": { "ckan": { "command": "ckan-mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)

```json
{ "servers": { "ckan": { "type": "stdio", "command": "ckan-mcp" } } }
```

**Over HTTP** (Streamable HTTP, one endpoint `POST /mcp`):

```bash
ckan-mcp --transport http            # http://127.0.0.1:3000/mcp
claude mcp add --transport http ckan http://127.0.0.1:3000/mcp
```

In a container, publish the port on loopback only:
`docker run --rm -p 127.0.0.1:3000:3000 ghcr.io/maschinenlesbar-org/ckan-mcp:latest --transport http --host 0.0.0.0 --allowed-hosts localhost,127.0.0.1`.

For scripts and shared configs, pin a release and its digest from the
[release notes](https://github.com/maschinenlesbar-org/ckan-cli/releases) instead of
`latest`: `…/ckan-mcp:<version>@sha256:<digest>`. Check an image's provenance with
`gh attestation verify oci://ghcr.io/maschinenlesbar-org/ckan-mcp:<version> --repo maschinenlesbar-org/ckan-cli`.

## Which portal

- **The server's own portal** is the one `--base-url` names, the Transparenzportal Hamburg
  without it: `ckan-mcp --base-url https://datenregister.berlin.de` serves Berlin by default.
  The server reads no environment variable; `CKAN_BASE_URL` is the CLI's.
- **Per call**, the tools take `portal`: an id of the built-in list (`aachen`, `berlin`, `ble`,
  `bw`, `govdata`, `greifswald`, `hamburg`, `hessen`, `karlsruhe`, `leipzig`, `muenchen`, `nrw`,
  `offenesdatenportal`, `rostock`, `ruhr`, `schleswig-holstein`, `uni-hannover`,
  `zbw-journaldata`; `ckan portals` lists them with their URLs). Never a URL: a caller can't make
  the server fetch an address of its choosing. `findHamburgDocuments` always asks Hamburg.
- `govdata` is the national catalogue: it harvests most Länder portals, so its counts overlap
  theirs.

## Tools

| Tool | What it answers |
|---|---|
| `comparePortals` | How many datasets match a topic (and a format) on every portal of the list at once, most first; GovData marked national, a portal that fails listed with its problem. |
| `findDatasets` | Datasets on one portal for a topic and filters (organization or group by name, tag, file format, record type, a date range, only with files), a page at a time: name, title, organization, author, dates, number of files, formats, licences and attribution text. |
| `countDatasets` | How many datasets match on one portal, and their distribution by organization, group, file format, licence, tag, record type or Hamburg's document type, sorted, spellings folded; and per year. |
| `findHamburgDocuments` | Documents of the Transparenzportal Hamburg by document type (Gutachten, Verträge von öffentlichem Interesse, Senatsmitteilungen, …), topic and date, newest first: publication date, office, licence, attribution text, files. |
| `getDataset` | One record by its name, id or page link on one portal: description, organization, author, groups, tags, dates, licences and attribution, details, every file with its kind, format, size and licence. |
| `listOrganizations` | A portal's organizations (or groups) with their slugs and dataset counts; by name, those that contain it. |

Every tool only reads. An answer is JSON (`structuredContent` and the same as text), with the
`source` it came from (the portal's URLs, whole, never cut like the data; an answer a redirect
fetched from another host says so there: "… (answered by https://other.example after a
redirect)", and a WARN record names both) and the data licence. Counts come from the portal's total, never from paging. Every portal spells formats and licences its own way (CSV, csv, an EU
vocabulary URI; dl-de-by-2.0 and its DCAT-AP.de URI): a format filter matches every spelling, a
count folds them (and says when the sum is an upper bound), each licence gets one label and says
whether it is open. Hamburg's document types work only in the stemmed form its search index holds;
the tool sends that form for a German name. An organization or group that fits several names is
reported with the candidates, never guessed; an unknown record or an empty search is said in
words, with what to try. A text over 2000 characters is cut and ends in
`…[cut, N characters in all]`, and the answer says `truncated`. A failure is a tool error that
says what to change (one over 5000 characters loses its middle, never its end, where the reason
is).

## Options

```
--transport <stdio|http>   stdio (default), or Streamable HTTP on POST /mcp
--host <address>           HTTP: the address to listen on (default 127.0.0.1)
--port <n>                 HTTP: the port (default 3000)
--allowed-hosts <list>     HTTP: Host header names to answer (default localhost,127.0.0.1,[::1])
--allowed-origins <list>   HTTP: browser origins allowed to call, exactly (https://app.example.org); none by default
--auth-token-file <path>   HTTP: a file with the bearer token every request must send (mode 600, 32+ characters)
--base-url <url>           the server's own portal (default https://suche.transparenz.hamburg.de)
--timeout <ms>             per upstream request (default 30000)
--call-timeout <ms>        per tool call, retries included (default 45000)
--max-result-chars <n>     cap on one tool result's JSON (default 25000)
--max-pages <n>            pages a tool reads per list and call (default 10)
--user-agent <ua>          User-Agent header value (Latin-1, one line)
--log-format <text|jsonl>  the log records on stderr (default text)
```

## What it does and doesn't do

- **Read-only.** No tool changes anything, here or upstream.
- **No authentication** on HTTP unless you give one. It listens on loopback by default; it checks
  the `Host` header and, from a browser, the `Origin` (only the origins given with
  `--allowed-origins`, matched exactly) against DNS rebinding and other web pages; a page on one
  of those origins gets CORS (its preflight answered, the answers readable). With
  `--auth-token-file <path>` every request must send `Authorization: Bearer <token>` (the file holds
  one token of at least 32 characters, mode 600, owned by the user the server runs as, a regular
  file (a FIFO is refused at once, never waited on); read once at start; `(umask 077; openssl rand
  -hex 32 > mcp-token)` makes one); anything else is answered 401.
  Exposed beyond localhost (it logs a warning then), it belongs behind a proxy that authenticates or
  at least terminates TLS.
- **Gentle with the portals.** One server process sends at most 2 requests at a time and 120 a
  minute, over all portals together, pauses on HTTP 429 (as long as its Retry-After asks, at
  most 30 s), and stops a tool call after its deadline (a tool that has read part of its answer by
  then may answer with that part, and says so). A request those limits would hold longer than it
  or its call may wait is not sent: the call fails at once, naming the limit and when to ask again
  (and the log says so). `comparePortals` makes one count request per portal (18 for the whole
  list).
- **Results are data.** Text from the portals, keys included, is cleaned (control, bidi,
  zero-width, tag and other invisible characters removed, but an emoji keeps its joiners; a key
  that cleaning makes equal to another stays, as `name~2`), but it is still other people's text:
  a model can be told things in it. The server can't act on that (it has no tool that writes),
  but other tools in the same session could.
- **Stops cleanly.** On `docker stop` (SIGTERM) or Ctrl-C the HTTP server takes no new
  connection and lets calls in flight answer for up to 5 s, then exits 143 (130); a second signal
  ends it at once. On stdio a signal ends it at once; when stdin ends, it first answers the
  requests it has read (each within its call deadline), then exits.
- **In a container** it needs at least 12 processes and threads (`--pids-limit`) and about
  256 MB of memory. The answers it reads are small (a search reads at most 50 records; a count
  reads no records).
- **Logs** go to stderr, one record per line; stdout carries only the protocol. A call that fails
  upstream or reaches its deadline leaves a WARN record naming the tool.
- **Never installs anything.**

## Licence

Code: AGPL-3.0-or-later or commercial
([LICENSING.md](https://github.com/maschinenlesbar-org/ckan-cli/blob/main/LICENSING.md)).
Data: the terms are the portal's and, for most records, the record's own licence
([DATA_LICENSE.md](https://github.com/maschinenlesbar-org/ckan-cli/blob/main/DATA_LICENSE.md)).
Every result gives each record's licence (`licences`, under one label whatever the portal's
spelling, with `open` where it is known) and the attribution text where the publisher asks for
one. Most are open (DL-DE BY 2.0, DL-DE Zero 2.0, CC BY, CC0); some are not (other-closed), ODbL
is share-alike, GeoNutzV has its own terms. The Transparenzportal Hamburg allows free use under
the Hamburg Transparency Act (HmbTG § 10), with the attribution each record names; a document
written by a third party can carry rights its record's licence does not grant. Other portals
have their own terms: look them up on the portal (each result names it in `portal`). Every result
carries this note in its `licence` field. We provide the tool, not the data.
