import { test } from "node:test";
import assert from "node:assert/strict";
import { CkanClient } from "../src/client/client.js";
import { CkanError, CkanParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse } from "./helpers.js";

const ACTION = "/api/3/action";

/** A CKAN-style success envelope. */
function ckan(result: unknown) {
  return { help: "h", success: true, result };
}

function clientWith(mt: ReturnType<typeof makeMockTransport>, baseUrl?: string): CkanClient {
  return new CkanClient({ transport: mt.transport, ...(baseUrl ? { baseUrl } : {}) });
}

test("action calls /api/3/action/<name> and unwraps result", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ ckan_version: "2.10.11" })));
  const res = await clientWith(mt, "https://ckan.example.test").action("status_show");
  assert.deepEqual(res, { ckan_version: "2.10.11" });
  assert.equal(mt.last().method, "GET");
  assert.equal(mt.last().url, `https://ckan.example.test${ACTION}/status_show`);
});

test("a success:false envelope throws CkanError with CKAN's message", async () => {
  const mt = makeMockTransport(() =>
    jsonResponse({ help: "h", success: false, error: { __type: "Not Found Error", message: "Not found" } }),
  );
  await assert.rejects(
    () => clientWith(mt).action("package_show"),
    (err: unknown) =>
      err instanceof CkanError && /package_show/.test(err.message) && /Not found/.test(err.message),
  );
});

test("a success:false envelope on HTTP 200 is stripped of terminal escapes, bidi and newlines", async () => {
  // Built from char codes so the source stays free of control bytes.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const CSI8 = String.fromCharCode(0x9b);
  const RLO = String.fromCharCode(0x202e);
  const errors: unknown[] = [
    { __type: `X${ESC}]0;PWNED${BEL}${ESC}[31mRED`, message: `evil ${ESC}[2J${CSI8}31m msg` },
    `str ${ESC}[31merr\nError: forged ${RLO}line`,
  ];
  const expected = [
    'CKAN action "status_show" failed: X]0;PWNED[31mRED: evil [2J31m msg',
    'CKAN action "status_show" failed: str [31merr Error: forged line',
  ];
  for (const [i, error] of errors.entries()) {
    const mt = makeMockTransport(() => jsonResponse({ help: "h", success: false, error }));
    await assert.rejects(
      () => clientWith(mt).action("status_show"),
      (err: unknown) => err instanceof CkanError && err.message === expected[i],
    );
  }
});

test("a validation error (field map, no message) is spelled out per field", async () => {
  const mt = makeMockTransport(() =>
    jsonResponse({
      help: "h",
      success: false,
      error: { name_or_id: ["Missing value"], __type: "Validation Error" },
    }),
  );
  await assert.rejects(
    () => clientWith(mt).action("package_show"),
    (err: unknown) =>
      err instanceof CkanError &&
      err.message === 'CKAN action "package_show" failed: Validation Error: name_or_id: Missing value',
  );
});

test("action rejects a name outside [a-z0-9_] before any request", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({})));
  for (const name of ["../../etc/passwd", "status_show?x=1", "a#b", "", "Package_Show"]) {
    await assert.rejects(() => clientWith(mt).action(name), CkanError, name);
  }
  assert.equal(mt.calls.length, 0);
});

test("action sends its params as the query and drops unset ones", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan([])));
  await clientWith(mt).action("package_list", { limit: 3, offset: undefined, q: "" });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, `${ACTION}/package_list`);
  assert.deepEqual([...url.searchParams], [["limit", "3"]]);
});

test("a CKAN mounted under a sub-path keeps that path", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan(true)));
  await clientWith(mt, "https://data.example.test/ckan/").action("site_read");
  assert.equal(mt.last().url, `https://data.example.test/ckan${ACTION}/site_read`);
});

test("a base URL pasted as the API endpoint is reduced to the site root", async () => {
  for (const pasted of [
    "https://suche.transparenz.hamburg.de/api/3/action",
    "https://suche.transparenz.hamburg.de/api/3/action/",
    "https://suche.transparenz.hamburg.de/api/3",
  ]) {
    const mt = makeMockTransport(() => jsonResponse(ckan(true)));
    await clientWith(mt, pasted).action("site_read");
    assert.equal(mt.last().url, `https://suche.transparenz.hamburg.de${ACTION}/site_read`, pasted);
  }
});

test("status calls status_show", async () => {
  const mt = makeMockTransport(() =>
    jsonResponse(ckan({ site_title: "Transparenzportal Hamburg", ckan_version: "2.10.11", extensions: ["dcat"] })),
  );
  const res = await clientWith(mt).status();
  assert.equal(res.ckan_version, "2.10.11");
  assert.equal(new URL(mt.last().url).pathname, `${ACTION}/status_show`);
});

test("packageSearch sends q, rows, start and sort to package_search", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 3686, results: [] })));
  const res = await clientWith(mt).packageSearch({ q: "elbe", rows: 5, start: 10, sort: "metadata_modified desc" });
  assert.equal(res.count, 3686);
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, `${ACTION}/package_search`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "elbe",
    rows: "5",
    start: "10",
    sort: "metadata_modified desc",
  });
});

test("packageSearch sends a single filter as fq", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 0, results: [] })));
  await clientWith(mt).packageSearch({ fq: ["extras_registerobject_type:verwaltungsvorschriften"] });
  const url = new URL(mt.last().url);
  assert.deepEqual(url.searchParams.getAll("fq"), ["extras_registerobject_type:verwaltungsvorschriften"]);
  assert.equal(url.searchParams.has("fq_list"), false);
});

test("packageSearch sends several filters as fq_list, never a repeated fq (HTTP 409)", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 0, results: [] })));
  await clientWith(mt).packageSearch({ fq: ["type:document", "organization:allris"] });
  const url = new URL(mt.last().url);
  assert.equal(url.searchParams.has("fq"), false);
  assert.deepEqual(url.searchParams.getAll("fq_list"), ["type:document", "organization:allris"]);
});

test("packageSearch drops blank filters and never sends a lone fq_list", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 0, results: [] })));
  await clientWith(mt).packageSearch({ fq: ["", "organization:allris", ""] });
  const url = new URL(mt.last().url);
  assert.deepEqual(url.searchParams.getAll("fq"), ["organization:allris"]);
  assert.equal(url.searchParams.has("fq_list"), false);
});

test("packageSearch sends facet fields as the facet.field JSON list, plus facet.limit", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 0, results: [], search_facets: {} })));
  await clientWith(mt).packageSearch({ rows: 0, facet_field: ["organization", "res_format"], facet_limit: 3 });
  const url = new URL(mt.last().url);
  assert.equal(url.searchParams.get("facet.field"), '["organization","res_format"]');
  assert.equal(url.searchParams.get("facet.limit"), "3");
  assert.equal(url.searchParams.has("facet_field"), false);
});

test("packageSearch omits facet.field when no facet fields are given", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ count: 0, results: [] })));
  await clientWith(mt).packageSearch({ q: "x", facet_field: [] });
  assert.equal(new URL(mt.last().url).searchParams.has("facet.field"), false);
});

test("packageShow sends the id to package_show", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({ name: "bezirk-wandsbek-drucksache-22-3573-2" })));
  const res = await clientWith(mt).packageShow("bezirk-wandsbek-drucksache-22-3573-2");
  assert.equal(res["name"], "bezirk-wandsbek-drucksache-22-3573-2");
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, `${ACTION}/package_show`);
  assert.equal(url.searchParams.get("id"), "bezirk-wandsbek-drucksache-22-3573-2");
});

test("packageShow rejects a blank id before any request", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan({})));
  await assert.rejects(() => clientWith(mt).packageShow("  "), CkanError);
  assert.equal(mt.calls.length, 0);
});

test("organizationShow, groupShow and resourceShow send the id to their *_show action", async () => {
  const cases: [string, (c: CkanClient, id: string) => Promise<unknown>][] = [
    ["organization_show", (c, id) => c.organizationShow(id)],
    ["group_show", (c, id) => c.groupShow(id)],
    ["resource_show", (c, id) => c.resourceShow(id)],
  ];
  for (const [action, call] of cases) {
    const mt = makeMockTransport(() => jsonResponse(ckan({ id: "x1" })));
    assert.deepEqual(await call(clientWith(mt), "x1"), { id: "x1" }, action);
    const url = new URL(mt.last().url);
    assert.equal(url.pathname, `${ACTION}/${action}`);
    assert.equal(url.searchParams.get("id"), "x1");

    const blank = makeMockTransport(() => jsonResponse(ckan({})));
    await assert.rejects(() => call(clientWith(blank), ""), CkanError, action);
    assert.equal(blank.calls.length, 0);
  }
});

test("the list endpoints send only the parameters that were set", async () => {
  const cases: [string, (c: CkanClient) => Promise<unknown>, Record<string, string>][] = [
    ["package_list", (c) => c.packageList({ limit: 3, offset: 6 }), { limit: "3", offset: "6" }],
    ["package_list", (c) => c.packageList(), {}],
    ["organization_list", (c) => c.organizationList({ all_fields: true, limit: 5 }), { all_fields: "true", limit: "5" }],
    ["organization_list", (c) => c.organizationList({ limit: 5, offset: 10 }), { limit: "5", offset: "10" }],
    ["group_list", (c) => c.groupList({ offset: 2 }), { offset: "2" }],
    ["tag_list", (c) => c.tagList({ query: "elbe" }), { query: "elbe" }],
    ["tag_list", (c) => c.tagList({ query: "" }), {}],
    ["license_list", (c) => c.licenseList(), {}],
  ];
  for (const [action, call, expected] of cases) {
    const mt = makeMockTransport(() => jsonResponse(ckan(["a"])));
    assert.deepEqual(await call(clientWith(mt)), ["a"], action);
    const url = new URL(mt.calls[0]!.url);
    assert.equal(url.pathname, `${ACTION}/${action}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), expected, action);
  }
});

test("the library root exports the client, siteRoot and the error types", async () => {
  const lib = await import("../src/index.js");
  assert.equal(lib.CkanClient, CkanClient);
  assert.equal(lib.CkanError, CkanError);
  assert.equal(typeof lib.siteRoot, "function");
  assert.equal(typeof lib.CkanApiError, "function");
  assert.equal(lib.DEFAULT_BASE_URL, "https://suche.transparenz.hamburg.de");
});

/**
 * A CKAN that caps `all_fields` lists (ckan.group_and_organization_list_all_fields_max,
 * 25 by default) and, like Berlin, may return a page shorter than the cap that is not
 * the last one. Offsets count positions in the full list.
 */
function cappedOrgServer(total: number, cap: number, dropPerPage = 0) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `id${i}`, name: `org${i}` }));
  return makeMockTransport((req) => {
    const params = new URL(req.url).searchParams;
    const offset = Number(params.get("offset") ?? 0);
    const limit = Math.min(Number(params.get("limit") ?? cap), cap);
    const page = all.slice(offset, offset + limit);
    return jsonResponse(ckan(page.slice(0, Math.max(0, page.length - dropPerPage))));
  });
}

test("the list methods refuse a limit that is not a positive integer, before any request", async () => {
  const calls: [string, (c: CkanClient) => Promise<unknown>][] = [
    ["packageList 0", (c) => c.packageList({ limit: 0 })],
    ["organizationList 0", (c) => c.organizationList({ limit: 0 })],
    ["organizationList all_fields 0", (c) => c.organizationList({ all_fields: true, limit: 0 })],
    ["groupList -1", (c) => c.groupList({ limit: -1 })],
    ["groupList 1.5", (c) => c.groupList({ limit: 1.5 })],
  ];
  for (const [label, call] of calls) {
    const mt = makeMockTransport(() => jsonResponse(ckan(["a"])));
    await assert.rejects(() => call(clientWith(mt)), /Invalid limit: expected a positive integer/, label);
    assert.equal(mt.calls.length, 0, label);
  }
});

test("organizationList with all_fields pages past the server's cap to return every entry", async () => {
  const mt = cappedOrgServer(60, 25);
  const res = await clientWith(mt).organizationList({ all_fields: true });
  assert.deepEqual(
    res.map((o) => (o as { name: string }).name),
    Array.from({ length: 60 }, (_, i) => `org${i}`),
  );
  assert.equal(mt.calls.length, 4); // 25 + 25 + 10, then an empty page
});

test("all_fields paging survives short pages and a cap below 25, without duplicates", async () => {
  for (const [cap, drop] of [[25, 1], [10, 0]] as const) {
    const mt = cappedOrgServer(55, cap, drop);
    const res = await clientWith(mt).groupList({ all_fields: true });
    const names = res.map((o) => (o as { name: string }).name);
    assert.equal(new Set(names).size, names.length, `cap ${cap}: duplicates`);
    if (drop === 0) assert.equal(names.length, 55, `cap ${cap}`);
  }
});

test("all_fields paging honours an explicit limit and offset", async () => {
  const mt = cappedOrgServer(60, 25);
  const res = await clientWith(mt).organizationList({ all_fields: true, limit: 30, offset: 5 });
  assert.deepEqual(
    res.map((o) => (o as { name: string }).name),
    Array.from({ length: 30 }, (_, i) => `org${i + 5}`),
  );
});

test("all_fields paging stops when a server ignores offset", async () => {
  const mt = makeMockTransport(() => jsonResponse(ckan([{ id: "a", name: "a" }, { id: "b", name: "b" }])));
  const res = await clientWith(mt).organizationList({ all_fields: true });
  assert.equal(res.length, 2);
  assert.equal(mt.calls.length, 2);
});

test("a base URL with a query string or fragment is refused", () => {
  for (const baseUrl of ["https://ckan.govdata.de/?lang=de", "https://ckan.govdata.de/#top"]) {
    assert.throws(() => new CkanClient({ baseUrl }), CkanError, baseUrl);
  }
});

test("JSON that is not a CKAN envelope raises CkanParseError naming the site", async () => {
  for (const body of [{ message: "Not Found" }, [1, 2], "hello", null]) {
    const mt = makeMockTransport(() => jsonResponse(body));
    await assert.rejects(
      () => clientWith(mt, "https://api.example.test").status(),
      (err: unknown) =>
        err instanceof CkanParseError &&
        err.message === 'The answer to "status_show" is not a CKAN Action API response; is https://api.example.test a CKAN site?',
      JSON.stringify(body),
    );
  }
});
