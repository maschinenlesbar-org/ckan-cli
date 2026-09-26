import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPortal, findPortal, portalKey } from "../src/client/portals.js";
import { CkanNetworkError } from "../src/client/errors.js";
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
