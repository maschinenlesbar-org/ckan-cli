# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `ckan`, eines pro Skill: eine
Anfrage, die `ckan`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 19. September 2026 mit `ckan` 0.0.2 gegen die Live-APIs.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten Portal-IDs,
Namen und Filtern können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [ckan-catalogue-stats](#ckan-catalogue-stats) · [ckan-dataset-finder](#ckan-dataset-finder) · [ckan-hamburg-transparency](#ckan-hamburg-transparency)

## ckan-catalogue-stats

> Welche Herausgeber haben die meisten Datensätze auf Open.NRW, in welchen Formaten und unter welchen Lizenzen?

```bash
ckan --compact --portal nrw search --rows 0 --facet organization --facet res_format --facet license_id --facet-limit -1
ckan --compact --portal nrw search --rows 0 --fq 'res_format:PARQUET' --facet organization --facet-limit 3
ckan --compact --portal nrw search --rows 0 --fq 'license_id:"http://dcat-ap.de/def/licenses/other-closed"' --facet organization --facet-limit 4
```

Eine Facetten-Abfrage lieferte alle drei Aufschlüsselungen, mit `--facet-limit -1`, damit
keine Liste bei 50 Werten abbricht (die Formatfacette hat 127 Werte). Der Skill hat die
unsortierten Facetten sortiert, die Namen der Herausgeber aus `search_facets` genommen und die
Schreibweisen zusammengeführt: `SHP`, `SHAPE` und `SHAPEFILES` zu einem Format, und 44
Lizenzwerte – DCAT-AP-URIs, einfache IDs und Freitextsätze – zu 11 Lizenzen. Zwei weitere
Abfragen prüften, wer hinter den Parquet-Dateien und den geschlossenen Daten steht.

```
Open.NRW: 11.099 Datensätze von 23 Herausgebern.

Herausgeber:
  Landesdatenbank NRW     2.373  ████████████
  Geoportal               2.223  ███████████
  RVR                     1.343  ███████
  Dortmund                  774  ████
  Landesbehörden            699  ████
  Köln                      499  ███
  Offenesdatenportal        462  ██
  Neuss                     428  ██
  Düsseldorf                380  ██
  Rhein-Erft-Rur            366  ██
  … 13 weitere, bis hinunter zu Bonn 293 und Aachen 227

Formate (Datensätze mit dem jeweiligen Format; 127 Rohwerte → 119):
  CSV       7.050   XLS      1.352   RDF (Turtle, XML)  je 1.202
  XML       2.897   N3       1.228   SHP                1.083 (SHP, SHAPE, SHAPEFILES)
  JSON      2.166   PARQUET  1.228   GEOJSON            1.071
  JSON-LD   1.203                    KML                  764
  Parquet stammt von Dortmund (774), Neuss (428) und dem RVR (26).
  Keine Formate: DOWNLOAD 752, VIEW 624 und 432 Datensätze mit leerem Format.

Lizenzen (44 Rohwerte → 11; 11.096 von 11.099 Datensätzen haben eine):
  DL-DE BY 2.0            4.364  39 %
  DL-DE Zero 2.0          3.371  30 %
  other-closed            2.430  22 %  ← nicht offen; 1.290 davon vom RVR
  CC BY                     342
  CC0                       338
  DL-DE BY 1.0               88
  sonstige / Freitext        54  (z. B. „Nutzung der Daten nur nach Rücksprache mit dem Dateneigentümer")
  ODbL 35 · CC BY-NC 27 · CC BY-ND 25 · CC BY-SA 22
```

Gezählt sind Datensätze, nicht Dateien. Als nächste Schritte angeboten: dieselbe
Aufschlüsselung für einen Herausgeber (`--fq organization:dortmund`) oder eine Liste der offenen
CSV-Datensätze mit ckan-dataset-finder.

## ckan-dataset-finder

> Welche deutschen Open-Data-Portale haben Daten zum Radverkehr, und was sind die aktuellsten CSV-Daten dazu in Berlin?

```bash
for id in $(ckan --compact portals | jq -r '.[] | select(.working) | .id'); do
  printf '%s\t' "$id"; ckan --compact --portal "$id" search "Radverkehr" --rows 0 | jq '.count'
done
ckan --compact search "Radverkehr" --rows 0 --facet type --facet extras_registerobject_type --facet-limit 5
ckan --compact --portal berlin search "Radverkehr" --rows 0 --facet res_format --facet-limit -1
ckan --compact --portal berlin search "Radverkehr" --fq 'res_format:("CSV" OR "csv")' --rows 25 --sort "metadata_modified desc"
```

Der Skill hat das Thema auf allen 18 bekannten Portalen gezählt und geprüft, woraus sich
Hamburgs große Zahl zusammensetzt. Bevor er Berlin nach Format filterte, hat er Berlins
Schreibweisen abgefragt (der Filter unterscheidet dort Groß- und Kleinschreibung) und beide mit
OR verknüpft. Dann hat er die Ressourcen jedes Treffers gelesen: Beide Datensätze bezeichnen
Übersichtsseiten als CSV, er hat sie daher als Links und nicht als Downloads angegeben.

```
„Radverkehr" auf den bekannten CKAN-Portalen:

  hamburg 3.743 · nrw 108 · bw 37 · ruhr 27 · berlin 14 · karlsruhe 12 · muenchen 10
  hessen 3 · leipzig 3 · aachen 2 · offenesdatenportal 1 · schleswig-holstein 1
  keine auf ble, greifswald, rostock, uni-hannover, zbw-journaldata
  GovData, der nationale Katalog, listet 241 – er übernimmt die meisten Länderportale,
  überschneidet sich also mit den Zahlen oben.

Hamburgs 3.743 sind überwiegend Dokumente (3.082), vor allem Beschlüsse (2.602);
661 sind Datensätze.

Berlin: 14 Datensätze zum Radverkehr. Die meisten sind Kartendienste (WFS 5, WMS 5); 2 haben CSV:

1. Berlin zählt Mobilität                                     ADFC
   CSV, JSON · aktualisiert 2026-04-21 · CC BY 4.0 · 2 Ressourcen
   Das „CSV" ist eine Download-Seite (https://berlin-zaehlt.de/csv/), das „JSON" die
   Dokumentation der Telraam-API.
   → ckan --portal berlin package berlin-zaehlt-mobilitaet
2. Fahrten und Gefahrensituationen im Radverkehr aus Projekt SimRa seit 2019    SimRa-Projekt
   CSV · aktualisiert 2024-07-04 · other-closed (keine offene Lizenz) · 2 Ressourcen
   Beide „CSV"-Links sind Seiten: das GitHub-Repository mit den Rohdaten und ein Dashboard.
   → ckan --portal berlin package simra
```

Als nächste Schritte angeboten: die Kartendienste (WFS) zur Berliner Radinfrastruktur oder
dieselbe Suche auf Open.NRW (108 Datensätze).

## ckan-hamburg-transparency

> Welche Verträge von öffentlichem Interesse hat Hamburg im September 2026 veröffentlicht?

```bash
ckan --compact search --fq extras_registerobject_type:vertrageoffinteress \
  --fq 'metadata_created:[2026-09-01T00:00:00Z TO *]' --rows 50 --sort "metadata_created desc"
```

Der Skill hat auf den gestemmten Typwert gefiltert (`vertrageoffinteress`; Hamburgs
dokumentiertes `vertraege_oeff_interesse` findet nichts) und auf `metadata_created`, weil sich
`publishing_date` nicht nach Zeiträumen filtern lässt. Er hat pro Vertrag das `publishing_date`
angezeigt, Lizenz und Namensnennung aus jedem Eintrag gelesen und einen Test-Upload markiert.

```
Verträge von öffentlichem Interesse, veröffentlicht seit 2026-09-01: 14 (Transparenzportal Hamburg)

2026-09-17  Mietvertrag Paloma KiezLiebe Quartier GmbH - Hamburg Kreativ GmbH
            Hamburg Kreativ Gesellschaft mbH · 1 PDF (3,1 MB)
2026-09-15  Vergabe Aufzugsanlagen JVA Fuhlsbüttel                    Sprinkenhof GmbH · 3 PDFs
2026-09-15  Vergabe Starkstrom DZS                                    Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe Brandschutz- / Schottsysteme Jugendanstalt Hamburg Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe erweiterte Rohbauarbeiten Finanzbehörde am Gänsemarkt  Sprinkenhof GmbH · 4 PDFs
2026-09-15  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HafenCity Universität
2026-09-11  Nachtrag Nr. 1 zum Mietvertrag Quartier Wandsbek Markt    Bezirksamt Wandsbek
2026-09-10  EMS-HH: Bremer Str. / Hohe Straße                         LSBG¹ · 2 PDFs
2026-09-09  Umgestaltung Nebenflächen Reeperbahn                      LSBG¹ · 2 PDFs
2026-09-09  Vertrag über IT-Dienstleistungen für ACTApro in der Cloud Staatsarchiv · 3,3 MB
2026-09-08  Ziel- und Leistungsvereinbarungen 2027/2028 BWFG – HFBK und – HAW Hamburg (2 Verträge)
2026-09-05  V20045-1_geschwärzt      Behörde für Gesundheit, Soziales und Integration · 13,9 MB
+ 1 Test-Upload: „Test110920261" (Staatsarchiv, 2026-09-11) – kein Vertrag.
¹ Landesbetrieb Straßen, Brücken und Gewässer

Alle 14 stehen unter CC0 (portalweit gilt das nur für etwa jeden zehnten Vertrag); Namensnennung
bei allen: „Namensnennung: Freie und Hansestadt Hamburg". Jede Sprinkenhof-Vergabe enthält das
Angebotsformular mit dem Leistungsverzeichnis, das Zuschlagsschreiben oder die Bestellung oder
die Besonderen Vertragsbedingungen (BVB) – überwiegend als geschwärzte PDFs.
```

Als nächste Schritte angeboten: die PDF-Links eines Vertrags (`ckan package vergabe-starkstrom-dzs`)
oder dieselbe Abfrage für Gutachten (`extras_registerobject_type:gutacht`).
