// The known CKAN portals in Germany, maintained with scripts/update-portals.ts.
//
// `npm run update-portals` collects candidates from three lists (Wikidata, the CKAN
// project's instance registry, GovData's harvest sources), checks each live, and
// rewrites this file. It reads PORTALS from here first, so a hand-added entry is
// checked and kept, as long as it stays in the same plain JSON as the rest: append
// { id, title, url, sources: ["curated"], note } plus the other fields (null/false)
// and run it. `id`, `title` and `note` are kept as written; `working`, `checked`,
// `problem`, `ckanVersion` and `datasets` come from the last check, and a failing
// check keeps the last known version and dataset count.
//
// This is the list `ckan portals` shows and `--portal <id>` looks up. It is compiled
// into the CLI, so neither needs any of the upstream lists at run time.

import type { Portal } from "./types.js";

/**
 * Freeze a list and its entries: `readonly` is compile-time only, and these are the
 * data every CLI run reads, so a JS consumer must not be able to change them.
 */
const frozen = <T>(list: T[]): readonly T[] => Object.freeze(list.map((entry) => Object.freeze(entry)));

export const PORTALS: readonly Portal[] = frozen([
  {
    "id": "aachen",
    "title": "Open Data Portal Aachen",
    "url": "https://offenedaten.aachen.de",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.1",
    "datasets": 227,
    "note": null
  },
  {
    "id": "berlin",
    "title": "Berlin Open Data",
    "url": "https://datenregister.berlin.de",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": null,
    "datasets": 2626,
    "note": "status_show requires a login (HTTP 403); search and the other read actions work."
  },
  {
    "id": "ble",
    "title": "Bundesministerium für Ernährung und Landwirtschaft",
    "url": "https://open-data.ble.de",
    "sources": [
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.3",
    "datasets": 38,
    "note": null
  },
  {
    "id": "bw",
    "title": "daten.bw",
    "url": "https://www.daten-bw.de/ckan",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.10",
    "datasets": 2067,
    "note": "CKAN mounted under /ckan."
  },
  {
    "id": "govdata",
    "title": "GovData",
    "url": "https://ckan.govdata.de",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.10",
    "datasets": 167870,
    "note": "The national catalogue; harvests the Länder and federal portals. Also reachable at https://www.govdata.de/ckan."
  },
  {
    "id": "greifswald",
    "title": "Open Data Greifswald",
    "url": "https://opendata.greifswald.de",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.6",
    "datasets": 39,
    "note": null
  },
  {
    "id": "hamburg",
    "title": "Transparenzportal Hamburg",
    "url": "https://suche.transparenz.hamburg.de",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.11",
    "datasets": 245651,
    "note": "The default portal. Mostly documents published under the Hamburg Transparency Act (HmbTG)."
  },
  {
    "id": "hessen",
    "title": "opendata.hessen.de",
    "url": "https://opendata.hessen.de",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.7",
    "datasets": 1559,
    "note": null
  },
  {
    "id": "karlsruhe",
    "title": "Transparenzportal der Stadt Karlsruhe",
    "url": "https://transparenz.karlsruhe.de",
    "sources": [
      "curated",
      "wikidata",
      "ckan-instances"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.3",
    "datasets": 151,
    "note": null
  },
  {
    "id": "leipzig",
    "title": "Open Data-Portal der Stadt Leipzig",
    "url": "https://opendata.leipzig.de",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.7",
    "datasets": 412,
    "note": null
  },
  {
    "id": "muenchen",
    "title": "Open Data Portal München",
    "url": "https://opendata.muenchen.de",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.9.9",
    "datasets": 337,
    "note": null
  },
  {
    "id": "nrw",
    "title": "Open.NRW",
    "url": "https://open.nrw",
    "sources": [
      "curated",
      "wikidata",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.6",
    "datasets": 11099,
    "note": null
  },
  {
    "id": "offenesdatenportal",
    "title": "Offenesdatenportal.de",
    "url": "https://www.offenesdatenportal.de",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.0",
    "datasets": 1118,
    "note": "Shared portal of several municipalities (Moers, Wesel and others), one organization each."
  },
  {
    "id": "rostock",
    "title": "OpenData.HRO",
    "url": "https://www.opendata-hro.de",
    "sources": [
      "curated",
      "wikidata",
      "ckan-instances",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.12.0",
    "datasets": 282,
    "note": null
  },
  {
    "id": "ruhr",
    "title": "Open Data Portal Ruhr",
    "url": "https://opendata.ruhr",
    "sources": [
      "curated",
      "wikidata"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.10.5",
    "datasets": 3211,
    "note": null
  },
  {
    "id": "schleswig-holstein",
    "title": "Open-Data Schleswig-Holstein",
    "url": "https://opendata.schleswig-holstein.de",
    "sources": [
      "curated",
      "govdata-harvest"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.11.5",
    "datasets": 32195,
    "note": null
  },
  {
    "id": "uni-hannover",
    "title": "Forschungsdaten-Repositorium der LUH",
    "url": "https://data.uni-hannover.de",
    "sources": [
      "curated",
      "ckan-instances"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.12.0",
    "datasets": 495,
    "note": "Research data of Leibniz Universität Hannover, not public-sector data."
  },
  {
    "id": "zbw-journaldata",
    "title": "ZBW Journal Data Archive",
    "url": "https://journaldata.zbw.eu",
    "sources": [
      "curated",
      "ckan-instances"
    ],
    "working": true,
    "checked": "2026-09-19",
    "problem": null,
    "ckanVersion": "2.9.6",
    "datasets": 2009,
    "note": "Research data of economics journals, not public-sector data."
  }
]);
