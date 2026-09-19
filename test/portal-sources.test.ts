import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ckanInstancesCandidates,
  harvestCandidates,
  mergePortals,
  portalId,
  readPortalsSource,
  renderPortalsSource,
  wikidataCandidates,
  type Candidate,
} from "../scripts/portal-sources.js";
import { portalKey, type PortalCheck } from "../src/client/portals.js";
import type { Portal } from "../src/client/types.js";
import { PORTALS } from "../src/client/portals-list.js";
import { readFileSync } from "node:fs";

/** The list file's source; tests run from dist/test, the file is under src/. */
const LIST_SOURCE = readFileSync(new URL("../../src/client/portals-list.ts", import.meta.url), "utf8");

/** One row of a Wikidata SPARQL JSON result. */
function row(label: string, endpoint?: string, website?: string) {
  return {
    portalLabel: { type: "literal", value: label },
    ...(endpoint ? { endpoint: { type: "uri", value: endpoint } } : {}),
    ...(website ? { website: { type: "uri", value: website } } : {}),
  };
}

test("wikidataCandidates: the site root of a CKAN endpoint, and the website's origin", () => {
  const json = {
    results: {
      bindings: [
        row("OpenData.HRO", "https://www.opendata-hro.de/api/3/action/package_list", "https://www.opendata-hro.de/"),
        row("GovData", "https://www.govdata.de/ckan/api/3/", "https://www.govdata.de/"),
        row("Open Data Potsdam", "https://opendata.potsdam.de/api/", "https://opendata.potsdam.de/pages/home/"),
        row("mCLOUD", "https://www.mcloud.de/export/datasets", "https://www.mcloud.de"),
        row("Intranet", "http://localhost:8090/api/3/action/package_list"),
        row("No URLs"),
      ],
    },
  };
  assert.deepEqual(wikidataCandidates(json), [
    { url: "https://www.opendata-hro.de", title: "OpenData.HRO", source: "wikidata" },
    { url: "https://www.govdata.de/ckan", title: "GovData", source: "wikidata" },
    { url: "https://www.govdata.de", title: "GovData", source: "wikidata" },
    { url: "https://opendata.potsdam.de", title: "Open Data Potsdam", source: "wikidata" },
    { url: "https://www.mcloud.de", title: "mCLOUD", source: "wikidata" },
  ]);
});

test("wikidataCandidates tolerates a malformed answer", () => {
  for (const json of [null, {}, { results: {} }, { results: { bindings: [{ endpoint: { value: "not a url" } }] } }]) {
    assert.deepEqual(wikidataCandidates(json), []);
  }
});

test("ckanInstancesCandidates: German entries only, url-api before url, upgraded to https", () => {
  const json = [
    { title: "data.gv.at", url: "http://data.gv.at", "url-api": "http://data.gv.at/katalog", location: "Austria" },
    { title: "GovData", url: "http://govdata.de", location: "Germany" },
    { title: "Rostock", url: "http://www.opendata-hro.de/", location: "Rostock, Germany" },
    { title: "Sub-path", url: "http://example.de/", "url-api": "http://example.de/ckan/api/3", location: "Somewhere, Germany" },
    { title: "Broken", url: "::", location: "Germany" },
  ];
  assert.deepEqual(ckanInstancesCandidates(json), [
    { url: "https://govdata.de", title: "GovData", source: "ckan-instances" },
    { url: "https://www.opendata-hro.de", title: "Rostock", source: "ckan-instances" },
    { url: "https://example.de/ckan", title: "Sub-path", source: "ckan-instances" },
  ]);
  assert.deepEqual(ckanInstancesCandidates({ not: "a list" }), []);
});

test("harvestCandidates: a DCAT feed URL gives its directory and its origin", () => {
  const harvest = (url: string, org: string | null, title = "harvester") => ({
    url,
    title,
    organization: org === null ? null : { title: org },
  });
  const result = {
    count: 5,
    results: [
      harvest("https://www.daten-bw.de/ckan/catalog.rdf", "Open Data Baden-Württemberg"),
      harvest("https://suche.transparenz.hamburg.de/catalog.rdf?part=govdata", "Transparenzportal Hamburg"),
      harvest(" https://open.bydata.de/api/hub/repo/datasets?limit=200", "open.bydata"),
      harvest("http://localhost:8090/omdf/gp-csw/catalog.rdf", "GDI-DE"),
      harvest("https://raw.githubusercontent.com/x/y/main/feed.ttl", null, "Robert Koch-Institut"),
    ],
  };
  assert.deepEqual(harvestCandidates(result), [
    { url: "https://www.daten-bw.de/ckan", title: "Open Data Baden-Württemberg", source: "govdata-harvest" },
    { url: "https://www.daten-bw.de", title: "Open Data Baden-Württemberg", source: "govdata-harvest" },
    { url: "https://suche.transparenz.hamburg.de", title: "Transparenzportal Hamburg", source: "govdata-harvest" },
    { url: "https://open.bydata.de", title: "open.bydata", source: "govdata-harvest" },
    { url: "https://raw.githubusercontent.com/x/y/main", title: "Robert Koch-Institut", source: "govdata-harvest" },
    { url: "https://raw.githubusercontent.com", title: "Robert Koch-Institut", source: "govdata-harvest" },
  ]);
  assert.deepEqual(harvestCandidates({ nope: 1 }), []);
});

test("portalId: a short id from the host, without generic words and the TLD", () => {
  const cases: [string, string][] = [
    ["https://suche.transparenz.hamburg.de", "hamburg"],
    ["https://ckan.govdata.de", "govdata"],
    ["https://open.nrw", "nrw"],
    ["https://opendata.ruhr", "ruhr"],
    ["https://opendata.stadt-muenster.de", "stadt-muenster"],
    ["https://www.offenedaten-koeln.de", "koeln"],
    ["https://www.opendata-hro.de", "hro"],
    ["https://www.daten-bw.de/ckan", "bw"],
    ["https://journaldata.zbw.eu", "journaldata-zbw"],
    ["https://data.example.de/Portal/Mitte", "example-mitte"],
  ];
  for (const [url, id] of cases) assert.equal(portalId(url, new Set()), id, url);
});

test("portalId never returns a taken id", () => {
  assert.equal(portalId("https://opendata.hamburg.de", new Set(["hamburg"])), "hamburg-2");
  assert.equal(portalId("https://opendata.hamburg.de", new Set(["hamburg", "hamburg-2"])), "hamburg-3");
});

function entry(id: string, url: string, extra: Partial<Portal> = {}): Portal {
  return {
    id, title: id, url, sources: ["curated"], working: true, checked: "2026-01-01",
    problem: null, ckanVersion: "2.9.0", datasets: 10, note: null, ...extra,
  };
}

function works(datasets: number, siteUrl: string | null = null, siteTitle: string | null = null): PortalCheck {
  return { working: true, problem: null, datasets, ckanVersion: "2.11.0", siteTitle, siteUrl };
}

const FAILS: PortalCheck = {
  working: false, problem: "HTTP 404", datasets: null, ckanVersion: null, siteTitle: null, siteUrl: null,
};

const cand = (url: string, source: Candidate["source"], title: string | null = null): Candidate => ({ url, title, source });

test("mergePortals refreshes existing entries, keeps failing ones, and adds up their sources", () => {
  const existing = [entry("hamburg", "https://suche.transparenz.hamburg.de"), entry("berlin", "https://datenregister.berlin.de")];
  const { portals } = mergePortals({
    existing,
    existingChecks: [works(245651, "http://suche.transparenz.hamburg.de"), FAILS],
    candidates: [cand("https://suche.transparenz.hamburg.de", "govdata-harvest"), cand("http://www.suche.transparenz.hamburg.de/", "wikidata")],
    candidateChecks: new Map(),
    today: "2026-09-19",
  });
  assert.deepEqual(portals.map((p) => p.id), ["berlin", "hamburg"]);
  const [berlin, hamburg] = portals as [Portal, Portal];
  assert.deepEqual(
    [hamburg.datasets, hamburg.ckanVersion, hamburg.checked, hamburg.sources],
    [245651, "2.11.0", "2026-09-19", ["curated", "wikidata", "govdata-harvest"]],
  );
  assert.deepEqual(
    [berlin.working, berlin.problem, berlin.checked, berlin.datasets, berlin.ckanVersion],
    [false, "HTTP 404", "2026-09-19", 10, "2.9.0"],
  );
});

test("mergePortals adds working new candidates and reports the failing ones", () => {
  const { portals, added, rejected } = mergePortals({
    existing: [],
    existingChecks: [],
    candidates: [
      cand("https://opendata.stadt-muenster.de", "wikidata", "Open Data Münster"),
      cand("https://opendata.stadt-muenster.de", "ckan-instances", "Münster"),
      cand("https://www.offenedaten-koeln.de", "wikidata", "Köln"),
    ],
    candidateChecks: new Map([
      [portalKey("https://opendata.stadt-muenster.de"), works(99, null, "Open Data Portal")],
      [portalKey("https://www.offenedaten-koeln.de"), FAILS],
    ]),
    today: "2026-09-19",
  });
  assert.deepEqual(portals, [
    {
      id: "stadt-muenster", title: "Open Data Münster", url: "https://opendata.stadt-muenster.de",
      sources: ["wikidata", "ckan-instances"], working: true, checked: "2026-09-19", problem: null,
      ckanVersion: "2.11.0", datasets: 99, note: null,
    },
  ]);
  assert.deepEqual(added.map((p) => p.id), ["stadt-muenster"]);
  assert.deepEqual(rejected, [{ url: "https://www.offenedaten-koeln.de", problem: "HTTP 404" }]);
});

test("mergePortals folds an alias into the portal its site_url names", () => {
  const { portals, added } = mergePortals({
    existing: [entry("govdata", "https://ckan.govdata.de")],
    existingChecks: [works(167845, "https://ckan.govdata.de")],
    candidates: [
      cand("https://www.govdata.de/ckan", "wikidata"),
      cand("https://portal.example.de/ckan", "wikidata", "Example"),
      cand("https://ckan.example.de", "govdata-harvest", "Example GmbH"),
    ],
    candidateChecks: new Map([
      [portalKey("https://www.govdata.de/ckan"), works(167845, "https://ckan.govdata.de")],
      [portalKey("https://portal.example.de/ckan"), works(5, "https://ckan.example.de")],
      [portalKey("https://ckan.example.de"), works(5, "https://ckan.example.de")],
    ]),
    today: "2026-09-19",
  });
  assert.deepEqual(portals.map((p) => [p.id, p.url, p.sources]), [
    ["example", "https://ckan.example.de", ["wikidata", "govdata-harvest"]],
    ["govdata", "https://ckan.govdata.de", ["curated", "wikidata"]],
  ]);
  assert.deepEqual(added.map((p) => p.id), ["example"]);
});

test("readPortalsSource reads the list file, and renderPortalsSource writes it back unchanged", () => {
  const read = readPortalsSource(LIST_SOURCE);
  assert.deepEqual(read, JSON.parse(JSON.stringify(PORTALS)));
  assert.equal(renderPortalsSource(LIST_SOURCE, read), LIST_SOURCE);
});

test("renderPortalsSource replaces only the list; the header stays", () => {
  const one = [entry("x", "https://x.example.de")];
  const text = renderPortalsSource(LIST_SOURCE, one);
  assert.ok(text.startsWith(LIST_SOURCE.slice(0, LIST_SOURCE.indexOf("export const PORTALS"))));
  assert.deepEqual(readPortalsSource(text), one);
});

test("readPortalsSource refuses a file it cannot read safely", () => {
  const broken = [
    LIST_SOURCE.replace("export const PORTALS", "export const OTHER"),
    LIST_SOURCE.replace('"id": "hamburg",', '"id": "hamburg"'),
    LIST_SOURCE.replace('"id": "hamburg",', ""),
  ];
  for (const text of broken) assert.throws(() => readPortalsSource(text));
});
