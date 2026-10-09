import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPortal, checkPortalUrls, checkPortals, findPortal, portalKey } from "../src/client/portals.js";
import { CkanNetworkError, CkanValidationError, toWellFormed } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import type { Portal } from "../src/client/types.js";
import { PORTALS } from "../src/client/portals-list.js";
import { DEFAULT_BASE_URL } from "../src/client/engine.js";
import { CkanClient, siteRoot } from "../src/client/client.js";

function portal(id: string, url: string, extra: Partial<Portal> = {}): Portal {
  return {
    id,
    title: id,
    url,
    sources: ["curated"],
    working: true,
    checked: "2026-09-19",
    problem: null,
    ckanVersion: "2.10.11",
    datasets: 1,
    note: null,
    ...extra,
  };
}

const LIST = [
  portal("hamburg", "https://suche.transparenz.hamburg.de"),
  portal("bw", "https://www.daten-bw.de/ckan"),
];

test("portalKey ignores scheme, www., case, a trailing slash and a pasted API suffix", () => {
  const same = [
    "https://www.daten-bw.de/ckan",
    "http://daten-bw.de/ckan/",
    "https://WWW.Daten-BW.de/ckan/api/3/action",
  ];
  for (const url of same) assert.equal(portalKey(url), "daten-bw.de/ckan", url);
  assert.equal(portalKey("https://ckan.govdata.de"), "ckan.govdata.de");
  assert.notEqual(portalKey("https://www.govdata.de/ckan"), portalKey("https://ckan.govdata.de"));
});

test("findPortal finds a portal by id (any case) or by any form of its URL", () => {
  assert.equal(findPortal("hamburg", LIST)?.id, "hamburg");
  assert.equal(findPortal("Hamburg", LIST)?.id, "hamburg");
  assert.equal(findPortal("http://daten-bw.de/ckan/api/3/action", LIST)?.id, "bw");
  assert.equal(findPortal("berlin", LIST), undefined);
  assert.equal(findPortal("https://ckan.govdata.de", LIST), undefined);
});

const ok = (result: unknown) => jsonResponse({ help: "h", success: true, result });

/** A portal answering package_search and status_show as given. */
function portalServer(search: () => HttpResponse, status: () => HttpResponse) {
  return makeMockTransport((req: HttpRequest) =>
    new URL(req.url).pathname.endsWith("/status_show") ? status() : search(),
  );
}

test("checkPortal: a portal that answers a search works; status_show adds the version", async () => {
  const mt = portalServer(
    () => ok({ count: 2626, results: [] }),
    () => ok({ ckan_version: "2.10.11", site_title: "Transparenzportal Hamburg", site_url: "http://suche.transparenz.hamburg.de" }),
  );
  const res = await checkPortal(new CkanClient({ baseUrl: "https://suche.transparenz.hamburg.de", transport: mt.transport }));
  assert.deepEqual(res, {
    working: true,
    problem: null,
    datasets: 2626,
    ckanVersion: "2.10.11",
    siteTitle: "Transparenzportal Hamburg",
    siteUrl: "http://suche.transparenz.hamburg.de",
  });
  const search = new URL(mt.calls[0]!.url);
  assert.equal(search.pathname, "/api/3/action/package_search");
  assert.equal(search.searchParams.get("rows"), "0");
});

test("checkPortal: a locked status_show (Berlin, HTTP 403) still counts as working", async () => {
  const mt = portalServer(
    () => ok({ count: 2626, results: [] }),
    () => jsonResponse({ success: false, error: { __type: "Authorization Error", message: "Zugriff verweigert" } }, 403),
  );
  const res = await checkPortal(new CkanClient({ baseUrl: "https://datenregister.berlin.de", transport: mt.transport }));
  assert.equal(res.working, true);
  assert.equal(res.datasets, 2626);
  assert.equal(res.ckanVersion, null);
});

test("checkPortal names the problem when the search fails", async () => {
  const cases: [string, () => HttpResponse | Promise<HttpResponse>][] = [
    ["HTTP 404", () => jsonResponse({}, 404)],
    ["not JSON (text/html)", () => rawResponse("<!DOCTYPE html>", "text/html")],
    ["not a CKAN Action API", () => jsonResponse({ hello: "world" })],
    ["unexpected response shape", () => jsonResponse({ help: "h", success: true, result: [] })],
    ["host not found", () => Promise.reject(new CkanNetworkError("getaddrinfo ENOTFOUND x", { cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }) }))],
    ["timeout", () => Promise.reject(new CkanNetworkError("Request timed out after 15000ms"))],
    ["redirect loop", () => ({ status: 301, headers: { location: "/api/3/action/package_search" }, body: Buffer.from("") })],
  ];
  for (const [problem, respond] of cases) {
    const mt = makeMockTransport(respond);
    const res = await checkPortal(new CkanClient({ baseUrl: "https://x.example.test", transport: mt.transport, maxRetries: 0 }));
    assert.equal(res.working, false, problem);
    assert.equal(res.problem, problem);
    assert.ok(
      mt.calls.every((c) => !c.url.includes("/status_show")),
      `${problem}: status_show is not tried after a failed search`,
    );
  }
});

test("the built-in list: unique short ids, one entry per portal, site-root URLs, the default included", () => {
  assert.ok(PORTALS.length > 0);
  const ids = PORTALS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const keys = PORTALS.map((p) => portalKey(p.url));
  assert.equal(new Set(keys).size, keys.length, "duplicate portal");
  for (const p of PORTALS) {
    assert.equal(siteRoot(p.url), p.url, p.id);
    assert.match(p.url, /^https?:\/\/[^?#]+$/, p.id);
    assert.ok(p.sources.length > 0, p.id);
  }
  assert.equal(findPortal(DEFAULT_BASE_URL, PORTALS)?.id, "hamburg");
  assert.ok(Object.isFrozen(PORTALS) && Object.isFrozen(PORTALS[0]));
});

test("checkPortals checks each portal and folds the result into a dated entry", async () => {
  const mt = makeMockTransport((req) =>
    new URL(req.url).host === "www.daten-bw.de"
      ? jsonResponse({}, 404)
      : jsonResponse({ success: true, result: new URL(req.url).pathname.endsWith("status_show") ? { ckan_version: "2.11.0" } : { count: 5, results: [] } }),
  );
  const list = await checkPortals(LIST, { engineOptions: { transport: mt.transport, maxRetries: 0 }, date: "2026-10-03" });
  assert.deepEqual(
    list.map((p) => [p.id, p.working, p.checked, p.problem, p.datasets, p.ckanVersion]),
    [
      ["hamburg", true, "2026-10-03", null, 5, "2.11.0"],
      ["bw", false, "2026-10-03", "HTTP 404", 1, "2.10.11"],
    ],
  );
});

test("checkPortalUrls repeats a failed check once after retryDelayMs, and only then", async () => {
  let searches = 0;
  const mt = makeMockTransport((req) => {
    if (new URL(req.url).pathname.endsWith("status_show")) return jsonResponse({ success: true, result: {} });
    searches += 1;
    return searches === 1 ? jsonResponse({}, 404) : jsonResponse({ success: true, result: { count: 1, results: [] } });
  });
  const slept: number[] = [];
  const sleep = async (ms: number) => void slept.push(ms);
  const [check] = await checkPortalUrls(["https://a.example"], {
    engineOptions: { transport: mt.transport, maxRetries: 0 },
    retryDelayMs: 3000,
    sleep,
  });
  assert.equal(check?.working, true);
  assert.deepEqual(slept, [3000]);

  searches = 0;
  const [once] = await checkPortalUrls(["https://a.example"], { engineOptions: { transport: mt.transport, maxRetries: 0 }, sleep });
  assert.equal(once?.working, false, "no retry without retryDelayMs");
  assert.deepEqual(slept, [3000]);
});

test("checkPortalUrls reports a URL the client refuses as a failed check, not a throw", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const [check] = await checkPortalUrls(["https://a.example/ x"], { engineOptions: { transport: mt.transport } });
  assert.equal(check?.working, false);
  assert.match(check?.problem ?? "", /base URL/);
  assert.equal(mt.calls.length, 0);
});

test("checkPortals refuses a concurrency below 1 before any request", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  for (const concurrency of [0, -1, 1.5]) {
    await assert.rejects(
      () => checkPortals(LIST, { engineOptions: { transport: mt.transport }, concurrency }),
      (err: unknown) => err instanceof CkanValidationError && /^Invalid concurrency: /.test(err.message),
    );
  }
  assert.equal(mt.calls.length, 0);
});

test("checkPortalUrls settles at timeoutMs with a transport that never answers (result 04 Bug 1)", async () => {
  const transport = () => new Promise<HttpResponse>(() => {});
  const started = Date.now();
  const [check] = await checkPortalUrls(["https://a.example"], { engineOptions: { transport, timeoutMs: 200, maxRetries: 0 } });
  assert.equal(check?.working, false);
  assert.equal(check?.problem, "timeout");
  assert.ok(Date.now() - started < 2000);
});

test("a portal entry without a url is a failed check, never Hamburg's (result 04 Bug 3)", async () => {
  const mt = makeMockTransport(() => jsonResponse({ help: "h", success: true, result: { count: 245000, results: [] } }));
  const [entry] = await checkPortals([{ id: "mine", title: "My portal" } as unknown as Portal], {
    engineOptions: { transport: mt.transport },
    date: "2026-10-06",
  });
  assert.equal(entry?.working, false);
  assert.match(entry?.problem ?? "", /^Invalid base URL/);
  assert.notEqual(entry?.datasets, 245000, "not Hamburg's count");
  for (const url of [undefined, null, 5]) {
    const [check] = await checkPortalUrls([url as unknown as string], { engineOptions: { transport: mt.transport } });
    assert.equal(check?.working, false, String(url));
    assert.match(check?.problem ?? "", /^Invalid base URL/);
  }
  assert.equal(mt.calls.length, 0, "no request, to Hamburg or anywhere");
});

test("checkPortal's problem, cut to 80 characters, never leaves half a character", async () => {
  for (const message of ["\u{1f600}".repeat(100), "a" + "\u{1f600}".repeat(100)]) {
    const mt = makeMockTransport(() => jsonResponse({ success: false, error: { message } }));
    const res = await checkPortal(new CkanClient({ baseUrl: "https://x.example.test", transport: mt.transport, maxRetries: 0 }));
    assert.equal(res.working, false);
    assert.ok((res.problem ?? "").length <= 80, res.problem ?? "");
    assert.equal(toWellFormed(res.problem ?? ""), res.problem);
  }
});
