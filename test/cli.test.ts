import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { CkanClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import { PORTALS } from "../src/client/portals-list.js";
import type { Portal } from "../src/client/types.js";

const ACTION = "/api/3/action";

function ckan(result: unknown) {
  return { help: "h", success: true, result };
}

function makeCli(responder: (req: HttpRequest) => HttpResponse, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);
  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    },
    env,
    createClient: (opts) => new CkanClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("status prints the unwrapped status_show result", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ ckan_version: "2.10.11" })));
  const code = await run(["status"], cli.deps);
  assert.equal(code, 0);
  assert.equal(cli.mt.last().url, `https://suche.transparenz.hamburg.de${ACTION}/status_show`);
  assert.deepEqual(JSON.parse(cli.out.join("\n")), { ckan_version: "2.10.11" });
});

test("CKAN_BASE_URL selects the portal when --base-url is not given", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "https://ckan.govdata.de" });
  assert.equal(await run(["status"], cli.deps), 0);
  assert.equal(cli.mt.last().url, `https://ckan.govdata.de${ACTION}/status_show`);
});

test("--base-url wins over CKAN_BASE_URL", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "https://ckan.govdata.de" });
  assert.equal(await run(["--base-url", "https://data.example.test/ckan", "status"], cli.deps), 0);
  assert.equal(cli.mt.last().url, `https://data.example.test/ckan${ACTION}/status_show`);
});

test("a non-http(s) --base-url or CKAN_BASE_URL is rejected before any request", async () => {
  const flag = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--base-url", "file:///etc/passwd", "status"], flag.deps), 1);
  assert.equal(flag.mt.calls.length, 0);

  const env = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "file:///etc/passwd" });
  assert.equal(await run(["status"], env.deps), 1);
  assert.equal(env.mt.calls.length, 0);
  assert.match(env.err.join("\n"), /CKAN_BASE_URL.*Unsupported scheme "file:"/);
});

test("search passes query, rows, start and sort to package_search", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ count: 3686, results: [] })));
  const code = await run(["search", "elbe", "--rows", "5", "--start", "10", "--sort", "metadata_modified desc"], cli.deps);
  assert.equal(code, 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.pathname, `${ACTION}/package_search`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "elbe",
    rows: "5",
    start: "10",
    sort: "metadata_modified desc",
  });
  assert.deepEqual(JSON.parse(cli.out.join("\n")), { count: 3686, results: [] });
});

test("search: repeated --fq becomes fq_list, repeated --facet the facet.field list", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ count: 0, results: [] })));
  const code = await run(
    ["search", "--fq", "type:document", "--fq", "organization:allris", "--facet", "organization", "--facet", "res_format", "--facet-limit", "3"],
    cli.deps,
  );
  assert.equal(code, 0);
  const params = new URL(cli.mt.last().url).searchParams;
  assert.deepEqual(params.getAll("fq"), []);
  assert.deepEqual(params.getAll("fq_list"), ["type:document", "organization:allris"]);
  assert.equal(params.get("facet.field"), '["organization","res_format"]');
  assert.equal(params.get("facet.limit"), "3");
});

test("blank search values are usage errors, never a silently unfiltered search", async () => {
  for (const argv of [
    ["search", ""],
    ["search", " "],
    ["search", "--fq", ""],
    ["search", "--fq", "organization:allris", "--fq", " "],
    ["search", "--facet", ""],
    ["search", "--sort", ""],
  ]) {
    const cli = makeCli(() => jsonResponse(ckan({ count: 245651, results: [] })));
    assert.equal(await run(argv, cli.deps), 1, JSON.stringify(argv));
    assert.equal(cli.mt.calls.length, 0, JSON.stringify(argv));
  }
});

test("the show commands call their *_show action with the id", async () => {
  for (const [command, action] of [
    ["package", "package_show"],
    ["organization", "organization_show"],
    ["group", "group_show"],
    ["resource", "resource_show"],
  ] as const) {
    const cli = makeCli(() => jsonResponse(ckan({ id: "x1" })));
    assert.equal(await run([command, "x1"], cli.deps), 0, command);
    const url = new URL(cli.mt.last().url);
    assert.equal(url.pathname, `${ACTION}/${action}`);
    assert.equal(url.searchParams.get("id"), "x1");
    assert.deepEqual(JSON.parse(cli.out.join("\n")), { id: "x1" });

    const blank = makeCli(() => jsonResponse(ckan({})));
    assert.equal(await run([command, " "], blank.deps), 1, command);
    assert.equal(blank.mt.calls.length, 0);
  }
});

test("the list commands map their options onto the *_list actions", async () => {
  const cases: [string[], string, Record<string, string>][] = [
    [["packages", "--limit", "3", "--offset", "6"], "package_list", { limit: "3", offset: "6" }],
    [["organizations", "--all-fields", "--limit", "5"], "organization_list", { all_fields: "true", limit: "5" }],
    [["groups", "--offset", "2"], "group_list", { offset: "2" }],
    [["tags", "--query", "elbe"], "tag_list", { query: "elbe" }],
    [["licenses"], "license_list", {}],
  ];
  for (const [argv, action, expected] of cases) {
    const cli = makeCli(() => jsonResponse(ckan(["a"])));
    assert.equal(await run(argv, cli.deps), 0, argv.join(" "));
    const url = new URL(cli.mt.calls[0]!.url);
    assert.equal(url.pathname, `${ACTION}/${action}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), expected, argv.join(" "));
    assert.deepEqual(JSON.parse(cli.out.join("\n")), ["a"]);
  }
});

test("--limit 0 is refused on every list command (CKAN reads it as no limit)", async () => {
  for (const argv of [
    ["packages", "--limit", "0"],
    ["organizations", "--limit", "0"],
    ["organizations", "--all-fields", "--limit", "0"],
    ["groups", "--limit", "0"],
  ]) {
    const cli = makeCli(() => jsonResponse(ckan(["a"])));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0, argv.join(" "));
    assert.match(cli.err.join("\n"), /Must be >= 1\./);
  }
});

test("tags --query rejects a blank substring instead of listing every tag", async () => {
  const cli = makeCli(() => jsonResponse(ckan([])));
  assert.equal(await run(["tags", "--query", ""], cli.deps), 1);
  assert.equal(cli.mt.calls.length, 0);
});

test("action calls any CKAN action with --param key=value pairs", async () => {
  const cli = makeCli(() => jsonResponse(ckan([{ name: "elbe-werkstaetten-jahresabschluss2018" }])));
  const code = await run(["action", "package_autocomplete", "--param", "q=elbe", "--param", "limit=3"], cli.deps);
  assert.equal(code, 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.pathname, `${ACTION}/package_autocomplete`);
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: "elbe", limit: "3" });
  assert.deepEqual(JSON.parse(cli.out.join("\n")), [{ name: "elbe-werkstaetten-jahresabschluss2018" }]);
});

test("action --param value may contain '='", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})));
  await run(["action", "package_search", "--param", "fq=title:a=b"], cli.deps);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("fq"), "title:a=b");
});

test("action rejects a bad name, a malformed --param and a duplicate key before any request", async () => {
  for (const argv of [
    ["action", "../../../etc/passwd"],
    ["action", "tag_list", "--param", "nope"],
    ["action", "tag_list", "--param", "=x"],
    ["action", "tag_list", "--param", "query=a", "--param", "query=b"],
  ]) {
    const cli = makeCli(() => jsonResponse(ckan({})));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0, argv.join(" "));
  }
});

test("a 404 exits 4 and prints CKAN's error on stderr", async () => {
  const cli = makeCli(() =>
    jsonResponse({ help: "h", error: { __type: "Not Found Error", message: "Not found" }, success: false }, 404),
  );
  assert.equal(await run(["package", "does-not-exist"], cli.deps), 4);
  assert.deepEqual(cli.out, []);
  assert.match(cli.err.join("\n"), /HTTP 404 .*: Not Found Error: Not found/);
});

test("an unknown action exits 1 with CKAN's message", async () => {
  const cli = makeCli(() => jsonResponse("Bad request - Action name not known: nope", 400));
  assert.equal(await run(["action", "nope"], cli.deps), 1);
  assert.match(cli.err.join("\n"), /HTTP 400 .*: Bad request - Action name not known: nope/);
});

test("a success:false envelope exits 1", async () => {
  const cli = makeCli(() => jsonResponse({ help: "h", success: false, error: { message: "x" } }));
  assert.equal(await run(["status"], cli.deps), 1);
  assert.match(cli.err.join("\n"), /status_show" failed: x/);
});

test("--compact prints JSON on a single line", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ count: 1, results: [{ id: "d1" }] })));
  await run(["--compact", "search", "elbe"], cli.deps);
  assert.equal(cli.out.join("\n"), '{"count":1,"results":[{"id":"d1"}]}');
});

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const result = { title: `Elbe${controls}`, notes: String.fromCharCode(0x1b) + "[31m" };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(ckan(result)));
    assert.equal(await run([...format, "package", "x"], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) => (c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f));
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /Elbe\\u007f\\u0085\\u009b2J/);
    assert.deepEqual(JSON.parse(text), result);
  }
});

test("bidi formatting characters in server data are escaped in the JSON output", async () => {
  const bidi = String.fromCharCode(0x202e, 0x2066, 0x200f, 0x061c);
  const result = { title: `a${bidi}b` };
  const cli = makeCli(() => jsonResponse(ckan(result)));
  assert.equal(await run(["--compact", "package", "x"], cli.deps), 0);
  const text = cli.out.join("\n");
  assert.equal(text, '{"title":"a\\u202e\\u2066\\u200f\\u061cb"}');
  assert.deepEqual(JSON.parse(text), result);
});

test("--timeout accepts up to the largest timer Node supports", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--timeout", "2147483647", "status"], cli.deps), 0);
  assert.equal(cli.mt.last().timeoutMs, 2_147_483_647);

  const over = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--timeout", "2147483648", "status"], over.deps), 1);
  assert.equal(over.mt.calls.length, 0);
  assert.match(over.err.join("\n"), /Must be <= 2147483647/);
});

test("--max-retries is bounded to 0..10", async () => {
  for (const [value, ok] of [["0", true], ["10", true], ["11", false], ["1000000", false]] as const) {
    const cli = makeCli(() => jsonResponse(ckan({})));
    const code = await run(["--max-retries", value, "status"], cli.deps);
    assert.equal(code, ok ? 0 : 1, value);
    if (!ok) {
      assert.match(cli.err.join("\n"), /Must be <= 10\./);
      assert.equal(cli.mt.calls.length, 0);
    }
  }
});

test("a password in --base-url or CKAN_BASE_URL is redacted in errors and in --help", async () => {
  const notFound = makeCli(() =>
    jsonResponse({ success: false, error: { __type: "Not Found Error", message: "Not found" } }, 404),
  );
  assert.equal(await run(["--base-url", "http://user:s3cret@127.0.0.1:9/404", "status"], notFound.deps), 4);
  // The request itself keeps the userinfo (Node sends it as Basic auth)...
  assert.equal(notFound.mt.last().url, `http://user:s3cret@127.0.0.1:9/404${ACTION}/status_show`);
  // ...but the message does not.
  assert.equal(
    notFound.err.join("\n"),
    `Error: HTTP 404 for GET http://***@127.0.0.1:9/404${ACTION}/status_show: Not Found Error: Not found`,
  );

  const html = makeCli(() => rawResponse("<html></html>", "text/html"));
  assert.equal(await run(["--base-url", "http://user:s3cret@127.0.0.1:9/x", "status"], html.deps), 1);
  assert.match(html.err.join("\n"), /Expected JSON from http:\/\/\*\*\*@127\.0\.0\.1:9\/x\//);
  assert.doesNotMatch(html.err.join("\n"), /s3cret/);

  const help = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "http://user:s3cret@127.0.0.1:9/ok" });
  assert.equal(await run(["--help"], help.deps), 0);
  const text = help.out.join("\n");
  assert.doesNotMatch(text, /s3cret/);
  assert.match(text.replace(/\s+/g, " "), /default: "http:\/\/\*\*\*@127\.0\.0\.1:9\/ok"/);
});

test("a bare invocation prints help to stdout and exits 0", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run([], cli.deps), 0);
  assert.match(cli.out.join("\n"), /Usage: ckan/);
  assert.equal(cli.mt.calls.length, 0);
});

test("--base-url and CKAN_BASE_URL with a query string are usage errors", async () => {
  const flag = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--base-url", "https://ckan.govdata.de/?lang=de", "status"], flag.deps), 1);
  assert.match(flag.err.join("\n"), /query string or fragment/);
  const env = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "https://ckan.govdata.de/#x" });
  assert.equal(await run(["status"], env.deps), 1);
  assert.match(env.err.join("\n"), /CKAN_BASE_URL.*query string or fragment/);
  assert.equal(flag.mt.calls.length + env.mt.calls.length, 0);
});

test("--facet-limit -1 asks CKAN for every facet value; other negatives are refused", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ count: 0, results: [] })));
  assert.equal(await run(["search", "--facet", "tags", "--facet-limit", "-1"], cli.deps), 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("facet.limit"), "-1");

  const bad = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["search", "--facet", "tags", "--facet-limit", "-2"], bad.deps), 1);
  assert.equal(bad.mt.calls.length, 0);
});

test("--portal selects a known portal by id and wins over CKAN_BASE_URL", async () => {
  const cli = makeCli(() => jsonResponse(ckan({ count: 0, results: [] })), { CKAN_BASE_URL: "https://ckan.govdata.de" });
  assert.equal(await run(["--portal", "bw", "search", "--rows", "0"], cli.deps), 0);
  assert.equal(new URL(cli.mt.last().url).href.split("?")[0], `https://www.daten-bw.de/ckan${ACTION}/package_search`);
});

test("--portal refuses an unknown id and a combination with --base-url, before any request", async () => {
  const unknown = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--portal", "atlantis", "status"], unknown.deps), 1);
  assert.match(unknown.err.join("\n"), /Unknown portal "atlantis".*ckan portals/);

  const both = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["--portal", "berlin", "--base-url", "https://ckan.govdata.de", "status"], both.deps), 1);
  assert.match(both.err.join("\n"), /cannot be used with/);
  assert.equal(unknown.mt.calls.length + both.mt.calls.length, 0);
});

test("an unused, invalid CKAN_BASE_URL does not block --portal", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})), { CKAN_BASE_URL: "file:///etc/passwd" });
  assert.equal(await run(["--portal", "berlin", "status"], cli.deps), 0);
  assert.equal(new URL(cli.mt.last().url).host, "datenregister.berlin.de");
});

test("portals prints the built-in list without any request", async () => {
  const cli = makeCli(() => jsonResponse(ckan({})));
  assert.equal(await run(["portals"], cli.deps), 0);
  const list = JSON.parse(cli.out.join("\n")) as { id: string; url: string }[];
  assert.deepEqual(list, JSON.parse(JSON.stringify(PORTALS)));
  assert.equal(cli.mt.calls.length, 0);
});

test("portals --check checks every portal live and reports the fresh result", async () => {
  const cli = makeCli((req) => {
    const url = new URL(req.url);
    if (url.host === "datenregister.berlin.de") return jsonResponse({}, 503);
    return url.pathname.endsWith("/status_show")
      ? jsonResponse(ckan({ ckan_version: "9.9.9" }))
      : jsonResponse(ckan({ count: 7, results: [] }));
  });
  assert.equal(await run(["--max-retries", "0", "portals", "--check"], cli.deps), 0);
  const list = JSON.parse(cli.out.join("\n")) as Portal[];
  assert.equal(list.length, PORTALS.length);
  const hosts = new Set(cli.mt.calls.map((c) => new URL(c.url).host));
  for (const p of PORTALS) assert.ok(hosts.has(new URL(p.url).host), p.id);
  const today = new Date().toISOString().slice(0, 10);
  const berlin = list.find((p) => p.id === "berlin")!;
  assert.deepEqual([berlin.working, berlin.problem, berlin.checked], [false, "HTTP 503", today]);
  assert.equal(berlin.datasets, PORTALS.find((p) => p.id === "berlin")!.datasets, "keeps the last known count");
  const hamburg = list.find((p) => p.id === "hamburg")!;
  assert.deepEqual([hamburg.working, hamburg.datasets, hamburg.ckanVersion], [true, 7, "9.9.9"]);
});
