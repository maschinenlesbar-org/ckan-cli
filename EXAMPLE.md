# Examples

Real examples for the Claude Code skills of the `ckan` plugin, one per skill: a request,
the `ckan` commands the skill ran, and the answer Claude gave.

Every example ran against the live APIs on 19 September 2026 with `ckan` 0.0.2.
The data changes, so your results will differ; the portal ids, names and filters shown work
for trying the requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [ckan-catalogue-stats](#ckan-catalogue-stats) · [ckan-dataset-finder](#ckan-dataset-finder) · [ckan-hamburg-transparency](#ckan-hamburg-transparency)

## ckan-catalogue-stats

> Which publishers have the most datasets on Open.NRW, in which formats, and under which licences?

```bash
ckan --compact --portal nrw search --rows 0 --facet organization --facet res_format --facet license_id --facet-limit -1
ckan --compact --portal nrw search --rows 0 --fq 'res_format:PARQUET' --facet organization --facet-limit 3
ckan --compact --portal nrw search --rows 0 --fq 'license_id:"http://dcat-ap.de/def/licenses/other-closed"' --facet organization --facet-limit 4
```

One facet query gave all three breakdowns, with `--facet-limit -1` so no list stopped at 50
(the format facet has 127 values). The skill sorted the unordered facets, took the publisher
labels from `search_facets`, and folded the spellings: `SHP`, `SHAPE` and `SHAPEFILES` into
one format, and 44 licence values — DCAT-AP URIs, plain ids and free-text sentences — into 11
licences. Two follow-up queries checked who is behind the Parquet files and the closed data.

```
Open.NRW: 11,099 datasets from 23 publishers.

Publishers:
  Landesdatenbank NRW     2,373  ████████████
  Geoportal               2,223  ███████████
  RVR                     1,343  ███████
  Dortmund                  774  ████
  Landesbehörden            699  ████
  Köln                      499  ███
  Offenesdatenportal        462  ██
  Neuss                     428  ██
  Düsseldorf                380  ██
  Rhein-Erft-Rur            366  ██
  … 13 more, down to Bonn 293 and Aachen 227

Formats (datasets carrying each; 127 raw values → 119):
  CSV       7,050   XLS      1,352   RDF (Turtle, XML)  1,202 each
  XML       2,897   N3       1,228   SHP                1,083 (SHP, SHAPE, SHAPEFILES)
  JSON      2,166   PARQUET  1,228   GEOJSON            1,071
  JSON-LD   1,203                    KML                  764
  Parquet comes from Dortmund (774), Neuss (428) and RVR (26).
  Not formats: DOWNLOAD 752, VIEW 624, and 432 datasets with an empty format.

Licences (44 raw values → 11; 11,096 of 11,099 datasets carry one):
  DL-DE BY 2.0            4,364  39 %
  DL-DE Zero 2.0          3,371  30 %
  other-closed            2,430  22 %  ← not open; 1,290 of them from RVR
  CC BY                     342
  CC0                       338
  DL-DE BY 1.0               88
  other / free text          54  (e.g. "Nutzung der Daten nur nach Rücksprache mit dem Dateneigentümer")
  ODbL 35 · CC BY-NC 27 · CC BY-ND 25 · CC BY-SA 22
```

Counts are datasets, not files. Next steps offered: the same breakdown for one publisher
(`--fq organization:dortmund`), or a list of the open CSV datasets with ckan-dataset-finder.

## ckan-dataset-finder

> Which German open-data portals have data on Radverkehr, and what is the freshest CSV data on it in Berlin?

```bash
for id in $(ckan --compact portals | jq -r '.[] | select(.working) | .id'); do
  printf '%s\t' "$id"; ckan --compact --portal "$id" search "Radverkehr" --rows 0 | jq '.count'
done
ckan --compact search "Radverkehr" --rows 0 --facet type --facet extras_registerobject_type --facet-limit 5
ckan --compact --portal berlin search "Radverkehr" --rows 0 --facet res_format --facet-limit -1
ckan --compact --portal berlin search "Radverkehr" --fq 'res_format:("CSV" OR "csv")' --rows 25 --sort "metadata_modified desc"
```

The skill counted the topic on all 18 known portals, and checked what Hamburg's large number
is made of. Before filtering Berlin by format it listed Berlin's spellings (the filter is
case-sensitive there) and ORed both. It then read each hit's resources: both datasets label
landing pages as CSV, so it called them links, not downloads.

```
"Radverkehr" on the known CKAN portals:

  hamburg 3,743 · nrw 108 · bw 37 · ruhr 27 · berlin 14 · karlsruhe 12 · muenchen 10
  hessen 3 · leipzig 3 · aachen 2 · offenesdatenportal 1 · schleswig-holstein 1
  none on ble, greifswald, rostock, uni-hannover, zbw-journaldata
  GovData, the national catalogue, lists 241 — it harvests most Länder portals, so it
  overlaps the numbers above.

Hamburg's 3,743 are mostly documents (3,082), above all council decisions (2,602);
661 are datasets.

Berlin: 14 datasets on Radverkehr. Most are map services (WFS 5, WMS 5); 2 carry CSV:

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
search on Open.NRW (108 datasets).

## ckan-hamburg-transparency

> Which contracts of public interest did Hamburg publish in September 2026?

```bash
ckan --compact search --fq extras_registerobject_type:vertrageoffinteress \
  --fq 'metadata_created:[2026-09-01T00:00:00Z TO *]' --rows 50 --sort "metadata_created desc"
```

The skill filtered on the stemmed type value (`vertrageoffinteress`; Hamburg's documented
`vertraege_oeff_interesse` matches nothing) and on `metadata_created`, because
`publishing_date` can't be range-filtered. It showed `publishing_date` per contract, read the
licence and the attribution text from each record, and flagged a test upload.

```
Verträge von öffentlichem Interesse, published since 2026-09-01: 14 (Transparenzportal Hamburg)

2026-09-17  Mietvertrag Paloma KiezLiebe Quartier GmbH - Hamburg Kreativ GmbH
            Hamburg Kreativ Gesellschaft mbH · 1 PDF (3.1 MB)
2026-09-15  Vergabe Aufzugsanlagen JVA Fuhlsbüttel                    Sprinkenhof GmbH · 3 PDFs
2026-09-15  Vergabe Starkstrom DZS                                    Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe Brandschutz- / Schottsysteme Jugendanstalt Hamburg Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe erweiterte Rohbauarbeiten Finanzbehörde am Gänsemarkt  Sprinkenhof GmbH · 4 PDFs
2026-09-15  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HafenCity Universität
2026-09-11  Nachtrag Nr. 1 zum Mietvertrag Quartier Wandsbek Markt    Bezirksamt Wandsbek
2026-09-10  EMS-HH: Bremer Str. / Hohe Straße                         LSBG¹ · 2 PDFs
2026-09-09  Umgestaltung Nebenflächen Reeperbahn                      LSBG¹ · 2 PDFs
2026-09-09  Vertrag über IT-Dienstleistungen für ACTApro in der Cloud Staatsarchiv · 3.3 MB
2026-09-08  Ziel- und Leistungsvereinbarungen 2027/2028 BWFG – HFBK and – HAW Hamburg (2 contracts)
2026-09-05  V20045-1_geschwärzt      Behörde für Gesundheit, Soziales und Integration · 13.9 MB
+ 1 test upload: "Test110920261" (Staatsarchiv, 2026-09-11) — not a contract.
¹ Landesbetrieb Straßen, Brücken und Gewässer

All 14 are CC0 (portal-wide, only about one contract in ten is); attribution text on each:
"Namensnennung: Freie und Hansestadt Hamburg". Each Sprinkenhof tender bundles the offer form
with the bill of quantities, the award letter or order, or the special contract terms (BVB) —
mostly as redacted ("geschwärzt") PDFs.
```

Next steps offered: the PDF links of one contract (`ckan package vergabe-starkstrom-dzs`), or
the same query for Gutachten (`extras_registerobject_type:gutacht`).
