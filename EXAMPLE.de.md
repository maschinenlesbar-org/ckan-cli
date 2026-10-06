# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `ckan`, eines pro Skill: eine
Anfrage, die `ckan`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 6. Oktober 2026 mit `ckan` 0.2.0 gegen die Live-APIs.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten Portal-IDs,
Namen und Filtern können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt. Um
die Portale wenig zu belasten, blieben diese Läufe auf zweien (Berlin und Hamburg); die
Abfrage über alle bekannten Portale beschreibt der Skill ckan-dataset-finder.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [ckan-catalogue-stats](#ckan-catalogue-stats) · [ckan-dataset-finder](#ckan-dataset-finder) · [ckan-hamburg-transparency](#ckan-hamburg-transparency)

## ckan-catalogue-stats

> Welche Herausgeber haben die meisten Datensätze auf Berlin Open Data, in welchen Formaten und unter welchen Lizenzen?

```bash
ckan --compact --portal berlin search --rows 0 --facet organization --facet res_format --facet license_id --facet-limit -1
ckan --compact --portal berlin search --rows 0 --fq res_format:WFS --facet organization --facet-limit 3
```

Eine Facetten-Abfrage lieferte alle drei Aufschlüsselungen, mit `--facet-limit -1`, damit
keine Liste bei 50 Werten abbricht (die Formatfacette hat 61 Werte). Der Skill hat die
unsortierten Facetten sortiert, die Namen der Herausgeber aus `search_facets` genommen und die
Schreibweisen zusammengeführt: `CSV`, `csv` und `.csv` zu einem Format (Berlin führt sie als
getrennte Werte), `geojson`, `GeoJSON`, `gjson` und `GEOJSON-Datei` zu einem weiteren, und
`cc-by` mit `cc-by/4.0`. Eine weitere Abfrage prüfte, wer hinter den Kartendiensten steht.

```
Berlin Open Data: 2.626 Datensätze von 46 Herausgebern.

Herausgeber:
  Harvester FIS Broker                      1.602  ████████████████  61 %
  Stromnetz Berlin GmbH                       343  ███
  Datenrubrik                                 196  ██
  Amt für Statistik Berlin-Brandenburg        188  ██
  SimpleSearch                                 87  █
  Senatsverw. Wirtschaft, Energie, Betriebe    46
  BerlinOnline GmbH                            20
  Senatsverw. Wissenschaft, Gesundheit, Pflege 18
  Senatsverwaltung für Finanzen                14
  Bezirksamt Lichtenberg                       12
  … 36 weitere, bis zu 18 Herausgebern mit je einem Datensatz (ADFC, SimRa-Projekt, …)

Formate (Datensätze, die sie führen; 61 Rohwerte → 42):
  WMS   767   CSV   386 (CSV, csv, .csv)   PDF   259   JSON   135   XML       92
  WFS   678   XLSX  302                    XLS   257   HTML   115   GeoJSON   45
  KML 42 · RSS 36 · jrss 36 · zip:shp 17 · gezippte Shapefile-Sätze 15
  Die Kartendienste (WMS, WFS) kommen aus dem Geoportal FIS-Broker: 663 der 678 WFS.
  Keine Formate: „webseite" 9, API 2, URL 1.

Lizenzen (10 Rohwerte → 9; alle 2.626 Datensätze haben eine):
  DL-DE Zero 2.0     1.508  57 %
  CC BY                899  34 %  (cc-by 860, cc-by/4.0 39)
  CC BY 3.0 DE          73
  CC0                   51
  DL-DE BY 2.0          44
  CC BY-SA              36
  other-closed          13  ← nicht offen („Siehe Website des Datensatzes")
  CC BY-NC 1 · ODbL 1
```

Gezählt sind Datensätze, nicht Dateien. Als nächste Schritte angeboten: dieselbe
Aufschlüsselung für einen Herausgeber (`--fq organization:stromnetz-berlin-gmbh`) oder eine
Liste der offenen CSV-Datensätze mit ckan-dataset-finder.

## ckan-dataset-finder

> Was sind die aktuellsten CSV-Daten zum Radverkehr in Berlin?

```bash
ckan --compact portals | jq -c '.[] | select(.id == "berlin") | {id, title, working}'
ckan --compact --portal berlin search "Radverkehr" --rows 0 --facet res_format --facet-limit -1
ckan --compact --portal berlin search "Radverkehr" --fq 'res_format:("CSV" OR "csv")' --rows 25 --sort "metadata_modified desc"
```

Die Anfrage nennt Berlin, also hat der Skill die Portal-ID `berlin` aus der eingebauten Liste
genommen (ohne Anfrage), statt alle Portale abzufragen. Bevor er nach Format filterte, hat er
Berlins Schreibweisen abgefragt (der Filter unterscheidet dort Groß- und Kleinschreibung): Zu
diesem Thema kommt nur `CSV` vor, er hat `csv` aber wie im Skill beschrieben mit OR verknüpft.
Dann hat er die Ressourcen jedes Treffers gelesen: Beide Datensätze bezeichnen Seiten als CSV,
er hat sie daher als Links und nicht als Downloads angegeben.

```
Berlin: 14 Datensätze zum Radverkehr. Die meisten sind Kartendienste (WFS 5, WMS 5); 2 haben CSV
(außerdem JSON 1, XLSX 1, GPX 1):

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
dieselbe Suche auf allen bekannten Portalen.

## ckan-hamburg-transparency

> Welche Verträge von öffentlichem Interesse hat Hamburg im September 2026 veröffentlicht?

```bash
ckan --compact search --fq extras_registerobject_type:vertrageoffinteress \
  --fq 'metadata_created:[2026-09-01T00:00:00Z TO 2026-10-01T00:00:00Z}' --rows 50 --sort "metadata_created desc"
```

Der Skill hat auf den gestemmten Typwert gefiltert (`vertrageoffinteress`; Hamburgs
dokumentiertes `vertraege_oeff_interesse` findet nichts) und auf `metadata_created` für den
Monat, weil sich `publishing_date` nicht nach Zeiträumen filtern lässt. Er hat pro Dokument das
`publishing_date` angezeigt, Lizenz und Namensnennung aus jedem Eintrag gelesen und markiert,
was kein Vertrag ist.

```
Verträge von öffentlichem Interesse, veröffentlicht im September 2026: 27 Einträge
(Transparenzportal Hamburg) – 20 Verträge, 6 Prüfungsaufgaben und 1 Test-Upload.

2026-09-30  Vereinbarung: Fit durch die Schule                         BSFB¹ · 1 PDF (0,8 MB)
2026-09-29  Vertrag zum Bebauungsplan Kleiner Grasbrook 2 (Moldauhafenquartier)
            Behörde für Stadtentwicklung und Wohnen · 1 PDF (0,8 MB)
2026-09-29  Vergabe Heizung - Lüftung - Sanitär HLS Finanzbehörde am Gänsemarkt 36
            Sprinkenhof GmbH · 4 PDFs
2026-09-29  Vergabe Erw. Rohbau, Abbruch- und Innenausbau Sanierung Strafjustizgebäude
            Sievekingplatz 3                                           Sprinkenhof GmbH · 3 PDFs
2026-09-25  EVB-IT Systemvertrag: Software für das Hamburgische Lobbyregister
            Bürgerschaftskanzlei · 1 PDF (25,5 MB)
2026-09-24  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HfMT       1 PDF (8,5 MB)
2026-09-23  GM36-Tischlereiarbeiten, Türen und Möbel                   Sprinkenhof GmbH · 4 PDFs
2026-09-17  Mietvertrag Paloma KiezLiebe Quartier GmbH - Hamburg Kreativ GmbH
            Hamburg Kreativ Gesellschaft mbH · 1 PDF (3,1 MB)
2026-09-15  Vergabe Aufzugsanlagen JVA Fuhlsbüttel                    Sprinkenhof GmbH · 3 PDFs
2026-09-15  Vergabe Starkstrom DZS                                    Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe Brandschutz- / Schottsysteme Jugendanstalt Hamburg Sprinkenhof GmbH · 4 PDFs
2026-09-15  Vergabe erweiterte Rohbauarbeiten Finanzbehörde am Gänsemarkt  Sprinkenhof GmbH · 4 PDFs
2026-09-15  Ziel- und Leistungsvereinbarung 2027/2028 BWFG – HafenCity Universität
2026-09-11  Nachtrag Nr. 1 zum Mietvertrag Quartier Wandsbek Markt    Bezirksamt Wandsbek · 1,3 MB
2026-09-10  EMS-HH: Bremer Str. / Hohe Straße                         LSBG² · 2 PDFs
2026-09-09  Umgestaltung Nebenflächen Reeperbahn                      LSBG² · 2 PDFs
2026-09-09  Vertrag über IT-Dienstleistungen für ACTApro in der Cloud Staatsarchiv · 3,4 MB
2026-09-08  Ziel- und Leistungsvereinbarungen 2027/2028 BWFG – HFBK und – HAW Hamburg (2 Verträge)
2026-09-05  V20045-1_geschwärzt      Behörde für Gesundheit, Soziales und Integration · 14,0 MB

Unter diesem Typ abgelegt, aber keine Verträge: 6 schriftliche Abiturprüfungen 2026 mit
Lehrermaterial (Chemie, Physik, Religion; je eA und gA), BSFB¹, 2026-09-29; und der
Test-Upload „Test110920261" (Staatsarchiv, 2026-09-11).
¹ Behörde für Schule, Familie und Berufsbildung  ² Landesbetrieb Straßen, Brücken und Gewässer

Alle 27 stehen unter CC0; Namensnennung bei allen: „Namensnennung: Freie und Hansestadt
Hamburg". Jede Sprinkenhof-Vergabe enthält drei oder vier von: Angebotsformular,
Leistungsverzeichnis, Zuschlagsschreiben oder Bestellung, Besondere Vertragsbedingungen (BVB) –
überwiegend als geschwärzte PDFs.
```

Als nächste Schritte angeboten: die PDF-Links eines Vertrags (`ckan package vergabe-starkstrom-dzs`)
oder dieselbe Abfrage für Gutachten (`extras_registerobject_type:gutacht`).
