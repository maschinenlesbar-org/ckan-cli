// CLI <-> library parity: the same input through run() and through CkanClient, on
// one recording mock transport, must give the same outcome (2026-10-03 parity
// report). Each test names the finding it covers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CkanClient } from "../src/client/client.js";
import { checkPortals } from "../src/client/portals.js";
import { PORTALS } from "../src/client/portals-list.js";
import type { HttpRequest } from "../src/client/http.js";
import { assertBothReject, assertSameRequests, jsonResponse, parity } from "./helpers.js";

const SEARCH = () => jsonResponse({ help: "h", success: true, result: { count: 0, results: [] } });
const LIST = () => jsonResponse({ help: "h", success: true, result: ["alpha"] });

// Finding 1 (PAT-9): a blank search, filter, sort, facet, tag query or action
// parameter is refused on both sides, never sent or dropped.
test("parity: blank search, filter, sort, facet, tag-query and param values are refused", async () => {
  const cases: [string[], (c: CkanClient) => Promise<unknown>][] = [
    [["search", ""], (c) => c.packageSearch({ q: "" })],
    [["search", " "], (c) => c.packageSearch({ q: " " })],
    [["search", "--fq", ""], (c) => c.packageSearch({ fq: [""] })],
    [["search", "--fq", " "], (c) => c.packageSearch({ fq: [" "] })],
    [["search", "--fq", "organization:a", "--fq", ""], (c) => c.packageSearch({ fq: ["organization:a", ""] })],
    [["search", "--sort", ""], (c) => c.packageSearch({ sort: "" })],
    [["search", "--sort", " "], (c) => c.packageSearch({ sort: " " })],
    [["search", "--facet", ""], (c) => c.packageSearch({ facet_field: [""] })],
    [["tags", "--query", ""], (c) => c.tagList({ query: "" })],
    [["tags", "--query", " "], (c) => c.tagList({ query: " " })],
    [["action", "package_search", "--param", "q="], (c) => c.action("package_search", { q: "" })],
    [["action", "package_search", "--param", "q= "], (c) => c.action("package_search", { q: " " })],
    [["action", "package_search", "--param", "=x"], (c) => c.action("package_search", { "": "x" })],
    [["action", "package_search", "--param", " =x"], (c) => c.action("package_search", { " ": "x" })],
  ];
  for (const [argv, call] of cases) {
    const result = await parity(argv, (transport) => call(new CkanClient({ transport })), { responder: SEARCH });
    assertBothReject(result);
  }
});

test("parity: non-blank search and tag values go out the same on both sides", async () => {
  assertSameRequests(
    await parity(
      ["search", "elbe", "--fq", "organization:a", "--fq", "res_format:CSV", "--sort", "name asc", "--facet", "tags"],
      (transport) =>
        new CkanClient({ transport }).packageSearch({
          q: "elbe",
          fq: ["organization:a", "res_format:CSV"],
          sort: "name asc",
          facet_field: ["tags"],
        }),
      { responder: SEARCH },
    ),
  );
  assertSameRequests(
    await parity(["tags", "--query", "wasser"], (transport) => new CkanClient({ transport }).tagList({ query: "wasser" }), {
      responder: LIST,
    }),
  );
});

// Finding 3 (PAT-11): rows, start, offset and facet_limit are range-checked by
// the library, before any request and before the all_fields pager starts.
test("parity: out-of-range rows, start, offset and facet_limit are refused", async () => {
  const cases: [string[], (c: CkanClient) => Promise<unknown>][] = [
    [["search", "--rows", "-5"], (c) => c.packageSearch({ rows: -5 })],
    [["search", "--start", "-1"], (c) => c.packageSearch({ start: -1 })],
    [["search", "--facet", "x", "--facet-limit", "-2"], (c) => c.packageSearch({ facet_field: ["x"], facet_limit: -2 })],
    [["packages", "--offset", "1.5"], (c) => c.packageList({ offset: 1.5 })],
    [["groups", "--all-fields", "--offset", "-3"], (c) => c.groupList({ all_fields: true, offset: -3 })],
    [["organizations", "--offset", "-2"], (c) => c.organizationList({ offset: -2 })],
  ];
  for (const [argv, call] of cases) {
    assertBothReject(await parity(argv, (transport) => call(new CkanClient({ transport })), { responder: SEARCH }));
  }
});

test("parity: facet_limit -1 and in-range paging go out the same on both sides", async () => {
  assertSameRequests(
    await parity(
      ["search", "--rows", "0", "--start", "20", "--facet", "x", "--facet-limit", "-1"],
      (transport) => new CkanClient({ transport }).packageSearch({ rows: 0, start: 20, facet_field: ["x"], facet_limit: -1 }),
      { responder: SEARCH },
    ),
  );
  assertSameRequests(
    await parity(["packages", "--offset", "0"], (transport) => new CkanClient({ transport }).packageList({ offset: 0 }), {
      responder: LIST,
    }),
  );
});

// Finding 4 (PAT-8): the engine range-checks its numeric limits in the
// constructor, so a bad value cannot switch off the timeout or size cap.
test("parity: out-of-range timeout, retries and response cap are refused", async () => {
  const cases: [string[], Record<string, number>][] = [
    [["--timeout", "-1", "status"], { timeoutMs: -1 }],
    [["--timeout", "NaN", "status"], { timeoutMs: NaN }],
    [["--timeout", "2147483648", "status"], { timeoutMs: 2_147_483_648 }],
    [["--max-retries", "50", "status"], { maxRetries: 50 }],
    [["--max-retries", "Infinity", "status"], { maxRetries: Infinity }],
    [["--max-response-bytes", "-1", "status"], { maxResponseBytes: -1 }],
    [["--max-response-bytes", "NaN", "status"], { maxResponseBytes: NaN }],
  ];
  for (const [argv, options] of cases) {
    assertBothReject(await parity(argv, (transport) => new CkanClient({ transport, ...options }).status()));
  }
});

test("parity: in-range engine limits are accepted on both sides", async () => {
  const result = await parity(
    ["--timeout", "0", "--max-retries", "10", "--max-response-bytes", "0", "status"],
    (transport) => new CkanClient({ transport, timeoutMs: 0, maxRetries: 10, maxResponseBytes: 0 }).status(),
  );
  assertSameRequests(result);
  assert.deepEqual(
    result.cli.requests.map((r) => [r.timeoutMs, r.maxResponseBytes]),
    result.lib.requests.map((r) => [r.timeoutMs, r.maxResponseBytes]),
  );
});

// Finding 5 (PAT-5): the engine checks the User-Agent like the CLI's
// --user-agent parser, at construction and before any request.
test("parity: a blank or unsendable User-Agent is refused", async () => {
  const DEL = String.fromCharCode(0x7f);
  for (const ua of ["", "  ", "a\r\nX-Evil: 1", "agent€", `x${DEL}`]) {
    assertBothReject(
      await parity(["--user-agent", ua, "status"], (transport) => new CkanClient({ transport, userAgent: ua }).status()),
    );
  }
});

test("parity: a tab and Latin-1 in the User-Agent go out the same on both sides", async () => {
  for (const ua of ["ok\tua", "café"]) {
    const result = await parity(["--user-agent", ua, "status"], (transport) =>
      new CkanClient({ transport, userAgent: ua }).status(),
    );
    assertSameRequests(result);
    assert.equal(result.cli.requests[0]!.headers?.["User-Agent"], ua);
    assert.equal(result.lib.requests[0]!.headers?.["User-Agent"], ua);
  }
});

// Finding 2 (PAT-1): a base URL with whitespace is refused by the library, which
// would otherwise glue it into every request URL as given.
test("parity: a base URL with surrounding or embedded whitespace is refused", async () => {
  const values = [
    "https://x.example/ckan ",
    " https://x.example/ckan",
    "https://x.org/api/3/action ",
    "https://x.org/ckan/ ",
    "https://x.org/a b",
    "https://x.org/a\tb",
    "https://x.org/a\nb",
  ];
  for (const baseUrl of values) {
    assertBothReject(
      await parity(["--base-url", baseUrl, "status"], (transport) => new CkanClient({ transport, baseUrl }).status()),
    );
    assertBothReject(
      await parity(["status"], (transport) => new CkanClient({ transport, baseUrl }).status(), {
        env: { CKAN_BASE_URL: baseUrl },
      }),
    );
  }
});

test("parity: a clean base URL goes out the same on both sides", async () => {
  assertSameRequests(
    await parity(["--base-url", "https://x.example/ckan/api/3/action", "status"], (transport) =>
      new CkanClient({ transport, baseUrl: "https://x.example/ckan/api/3/action" }).status(),
    ),
  );
});

// Finding 7 (PAT-21): `portals --check` is one library call, checkPortals.
test("parity: portals --check equals checkPortals over the built-in list", async () => {
  const responder = (req: HttpRequest) => {
    const url = new URL(req.url);
    if (url.host === "datenregister.berlin.de") return jsonResponse({}, 404);
    return url.pathname.endsWith("/status_show")
      ? jsonResponse({ success: true, result: { ckan_version: "2.10.4" } })
      : jsonResponse({ success: true, result: { count: 42, results: [] } });
  };
  const result = await parity(
    ["--compact", "--max-retries", "0", "--timeout", "5000", "--base-url", "https://mine.example", "portals", "--check"],
    (transport) => checkPortals(PORTALS, { engineOptions: { transport, maxRetries: 0, timeoutMs: 5000 } }),
    { responder },
  );
  assert.equal(result.cli.code, 0, result.cli.err);
  assert.equal(result.lib.ok, true, String(result.lib.error));
  assert.deepEqual(JSON.parse(result.cli.out), result.lib.value);
  const urls = (rs: HttpRequest[]) => rs.map((r) => r.url).sort();
  assert.deepEqual(urls(result.cli.requests), urls(result.lib.requests));
  assert.equal(result.cli.requests.length, PORTALS.length * 2 - 1);
});

// Finding 6 (PAT-2): one set of base-URL rules, in the library; a bad base URL is
// a CkanValidationError (a configuration mistake), never a CkanNetworkError.
test("parity: a malformed base URL is refused with the same reason on both sides", async () => {
  const cases: [string, RegExp][] = [
    ["ftp://h.example", /Unsupported scheme "ftp:"\. Expected an http\(s\) URL\./],
    ["ftp://h.example?x", /Unsupported scheme "ftp:"\. Expected an http\(s\) URL\./],
    ["not-a-url", /Expected an absolute http\(s\) URL\./],
    ["http://", /Expected an absolute http\(s\) URL\./],
    ["", /Expected an absolute http\(s\) URL\./],
    ["https://h.example?x=1", /Expected a site URL without a query string or fragment\./],
    ["https://h.example/#top", /Expected a site URL without a query string or fragment\./],
    ["https://h.example ", /A base URL cannot have surrounding whitespace\./],
  ];
  for (const [baseUrl, message] of cases) {
    assertBothReject(
      await parity(["--base-url", baseUrl, "status"], (transport) => new CkanClient({ transport, baseUrl }).status()),
      message,
    );
    if (baseUrl !== "") {
      assertBothReject(
        await parity(["status"], (transport) => new CkanClient({ transport, baseUrl }).status(), {
          env: { CKAN_BASE_URL: baseUrl },
        }),
        message,
      );
    }
  }
});
