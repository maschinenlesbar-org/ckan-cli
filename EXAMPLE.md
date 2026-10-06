# Examples

Real examples for the Claude Code skills of the `ckan` plugin, one per skill: a request,
the `ckan` commands the skill ran, and the answer Claude gave.

Every example ran against the live APIs on 6 October 2026 with `ckan` 0.2.0.
The data changes, so your results will differ; the portal ids, names and filters shown work
for trying the requests yourself. Long lists are shortened. To keep the load on the portals
small, these runs stayed on two of them (Berlin and Hamburg); the dataset-finder's fan-out
over all known portals is described in its skill.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [ckan-catalogue-stats](#ckan-catalogue-stats) · [ckan-dataset-finder](#ckan-dataset-finder) · [ckan-hamburg-transparency](#ckan-hamburg-transparency)

## ckan-catalogue-stats

> Which publishers have the most datasets on Berlin Open Data, in which formats, and under which licences?

```bash
ckan --compact --portal berlin search --rows 0 --facet organization --facet res_format --facet license_id --facet-limit -1
ckan --compact --portal berlin search --rows 0 --fq res_format:WFS --facet organization --facet-limit 3
```

One facet query gave all three breakdowns, with `--facet-limit -1` so no list stopped at 50
(the format facet has 61 values). The skill sorted the unordered facets, took the publisher
labels from `search_facets`, and folded the spellings: `CSV`, `csv` and `.csv` into one
format (Berlin keeps them as separate values), `geojson`, `GeoJSON`, `gjson` and
`GEOJSON-Datei` into another, and `cc-by` with `cc-by/4.0`. A follow-up query checked who is
behind the map services.

```
Berlin Open Data: 2,626 datasets from 46 publishers.

Publishers:
  Harvester FIS Broker                      1,602  ████████████████  61 %
  Stromnetz Berlin GmbH                       343  ███
  Datenrubrik                                 196  ██
  Amt für Statistik Berlin-Brandenburg        188  ██
  SimpleSearch                                 87  █
  Senatsverw. Wirtschaft, Energie, Betriebe    46
  BerlinOnline GmbH                            20
  Senatsverw. Wissenschaft, Gesundheit, Pflege 18
  Senatsverwaltung für Finanzen                14
  Bezirksamt Lichtenberg                       12
  … 36 more, down to 18 publishers with a single dataset (ADFC, SimRa-Projekt, …)

Formats (datasets carrying each; 61 raw values → 42):
  WMS   767   CSV   386 (CSV, csv, .csv)   PDF   259   JSON   135   XML       92
  WFS   678   XLSX  302                    XLS   257   HTML   115   GeoJSON   45
  KML 42 · RSS 36 · jrss 36 · zip:shp 17 · zipped shapefile sets 15
  The map services (WMS, WFS) come from the FIS-Broker geoportal: 663 of the 678 WFS.
  Not formats: "webseite" 9, API 2, URL 1.

Licences (10 raw values → 9; all 2,626 datasets carry one):
  DL-DE Zero 2.0     1,508  57 %
  CC BY                899  34 %  (cc-by 860, cc-by/4.0 39)
  CC BY 3.0 DE          73
  CC0                   51
  DL-DE BY 2.0          44
  CC BY-SA              36
  other-closed          13  ← not open ("Siehe Website des Datensatzes")
  CC BY-NC 1 · ODbL 1
```

Counts are datasets, not files. Next steps offered: the same breakdown for one publisher
(`--fq organization:stromnetz-berlin-gmbh`), or a list of the open CSV datasets with
ckan-dataset-finder.

## ckan-dataset-finder

> What is the freshest CSV data on Radverkehr in Berlin?

```bash
ckan --compact portals | jq -c '.[] | select(.id == "berlin") | {id, title, working}'
ckan --compact --portal berlin search "Radverkehr" --rows 0 --facet res_format --facet-limit -1
ckan --compact --portal berlin search "Radverkehr" --fq 'res_format:("CSV" OR "csv")' --rows 25 --sort "metadata_modified desc"
```

The user named Berlin, so the skill mapped it to the portal id `berlin` from the built-in list
(no request) instead of fanning out. Before filtering by format it listed Berlin's spellings
(the filter is case-sensitive there): this topic only uses `CSV`, but it ORed `csv` in as the
skill says. It then read each hit's resources: both datasets label pages as CSV, so it called
them links, not downloads.

```
Berlin: 14 datasets on Radverkehr. Most are map services (WFS 5, WMS 5); 2 carry CSV
(also JSON 1, XLSX 1, GPX 1):

1. Berlin zählt Mobilität                                     ADFC
   CSV, JSON · updated 2026-04-21 · CC BY 4.0 · 2 resources
   The "CSV" is a download page (https://berlin-zaehlt.de/csv/), the "JSON" the
   Telraam API documentation.
   → ckan --portal berlin package berlin-zaehlt-mobilitaet
2. Fahrten und Gefahrensituationen im Radverkehr aus Projekt SimRa seit 2019    SimRa-Projekt
   CSV · updated 2024-07-04 · other-closed (not an open licence) · 2 resources
   Both "CSV" links are pages: the GitHub repository with the raw data, and a dashboard.
   → ckan --portal berlin package simra
```

Next steps offered: the map services (WFS) for Berlin's cycling infrastructure, or the same
search on all known portals.

## ckan-hamburg-transparency

> Which contracts of public interest did Hamburg publish in September 2026?

```bash
ckan --compact search --fq extras_registerobject_type:vertrageoffinteress \
  --fq 'metadata_created:[2026-09-01T00:00:00Z TO 2026-10-01T00:00:00Z}' --rows 50 --sort "metadata_created desc"
```

The skill filtered on the stemmed type value (`vertrageoffinteress`; Hamburg's documented
`vertraege_oeff_interesse` matches nothing) and on `metadata_created` for the month, because
`publishing_date` can't be range-filtered. It showed `publishing_date` per document, read the
licence and the attribution text from each record, and flagged what isn't a contract.

```
Verträge von öffentlichem Interesse, published in September 2026: 27 records
(Transparenzportal Hamburg) — 20 contracts, 6 exam papers and 1 test upload.

2026-09-30  Vereinbarung: Fit durch die Schule                         BSFB¹ · 1 PDF (0.8 MB)
2026-09-29  Vertrag zum Bebauungsplan Kleiner Grasbrook 2 (Moldauhafenquartier)
            Behörde für Stadtentwicklung und Wohnen · 1 PDF (0.8 MB)
2026-09-29  Vergabe Heizung - Lüftung - Sanitär HLS Finanzbehörde am Gänsemarkt 36
            Sprinkenhof GmbH · 4 PDFs
2026-09-29  Vergabe Erw. Rohbau, Abbruch- und Innenausbau Sanierung Strafjustizgebäude
            Sievekingplatz 3                                           Sprinkenhof GmbH · 3 PDFs
2026-09-25  EVB-IT Systemvertrag: Software für das Hamburgische Lobbyregister
            Bürgerschaftskanzlei · 1 PDF (25.5 MB)
2026-09-24  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HfMT       1 PDF (8.5 MB)
2026-09-23  GM36-Tischlereiarbeiten, Türen und Möbel                   Sprinkenhof GmbH · 4 PDFs
2026-09-17  Mietvertrag Paloma KiezLiebe Quartier GmbH - Hamburg Kreativ GmbH
            Hamburg Kreativ Gesellschaft mbH · 1 PDF (3.1 MB)
2026-09-15  Vergabe Aufzugsanlagen JVA Fuhlsbüttel                    Sprinkenhof GmbH · 3 PDFs
2026-09-15  Vergabe Starkstrom DZS                                    Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe Brandschutz- / Schottsysteme Jugendanstalt Hamburg Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe erweiterte Rohbauarbeiten Finanzbehörde am Gänsemarkt  Sprinkenhof GmbH · 4 PDFs
2026-09-15  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HafenCity Universität
2026-09-11  Nachtrag Nr. 1 zum Mietvertrag Quartier Wandsbek Markt    Bezirksamt Wandsbek · 1.3 MB
2026-09-10  EMS-HH: Bremer Str. / Hohe Straße                         LSBG² · 2 PDFs
2026-09-09  Umgestaltung Nebenflächen Reeperbahn                      LSBG² · 2 PDFs
2026-09-09  Vertrag über IT-Dienstleistungen für ACTApro in der Cloud Staatsarchiv · 3.4 MB
2026-09-08  Ziel- und Leistungsvereinbarungen 2027/2028 BWFG – HFBK and – HAW Hamburg (2 contracts)
2026-09-05  V20045-1_geschwärzt      Behörde für Gesundheit, Soziales und Integration · 14.0 MB

Filed under this type but not contracts: 6 written Abitur exams 2026 with teacher material
(Chemistry, Physics, Religion; eA and gA each), BSFB¹, 2026-09-29; and the test upload
"Test110920261" (Staatsarchiv, 2026-09-11).
¹ Behörde für Schule, Familie und Berufsbildung  ² Landesbetrieb Straßen, Brücken und Gewässer

All 27 are CC0; attribution text on each: "Namensnennung: Freie und Hansestadt Hamburg".
Each Sprinkenhof tender bundles three or four of: the offer form, the bill of quantities, the
award letter or order, the special contract terms (BVB) — mostly as redacted ("geschwärzt") PDFs.
```

Next steps offered: the PDF links of one contract (`ckan package vergabe-starkstrom-dzs`), or
the same query for Gutachten (`extras_registerobject_type:gutacht`).
