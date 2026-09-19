# Glossar

Ein Nachschlagewerk für die Fachbegriffe und projektspezifischen Begriffe, die in
`ckan-cli` verwendet werden. Dieses Tool kapselt die **CKAN-Action-API** eines beliebigen
CKAN-Portals – standardmäßig des **Transparenzportals Hamburg**
(`suche.transparenz.hamburg.de`); das Vokabular verteilt sich daher auf **CKAN** selbst
(samt seiner Eigenheiten, z. B. „package“ == „dataset“), die **Portale**, auf denen es läuft,
und die **projekteigenen** Begriffe von Client und CLI.

---

## CKAN und die Portale

**CKAN.** Die quelloffene Software zur Verwaltung und Katalogisierung von Daten (ursprünglich
von der Open Knowledge Foundation), auf der viele Open-Data-Portale der öffentlichen Hand
laufen. Jedes CKAN-Portal bietet dieselbe **Action-API**, die dieser Client kapselt; jedes
Portal ergänzt eigene Felder (`extras`) und Einstellungen.

**Portal.** Eine CKAN-Installation, angesprochen über ihre **Site-URL** (`--base-url`),
z. B. `https://suche.transparenz.hamburg.de` oder `https://www.daten-bw.de/ckan` (ein CKAN
unter einem Unterpfad). Eine aus der API-Dokumentation eines Portals kopierte URL
(`…/api/3/action`) wird auf die Site-URL gekürzt.

**Bekanntes Portal.** Ein deutsches CKAN-Portal aus der in die CLI eingebauten Liste,
angesprochen über eine kurze **ID** mit `--portal` (`hamburg`, `govdata`, `berlin`, `nrw` …).
`ckan portals` listet sie mit dem Ergebnis der letzten Prüfung; `ckan portals --check` prüft
sie live. Die Liste wird aus Wikidata, dem Instanzen-Verzeichnis des CKAN-Projekts und den
Harvest-Quellen von GovData aktualisiert (siehe DEVELOPING.md).

**Transparenzportal Hamburg.** Das Standardportal: das Informationsregister, das das
Hamburgische Transparenzgesetz (**HmbTG**) vorschreibt. Die meisten Einträge sind
**Dokumente** (Verträge, Gutachten, Senatsdrucksachen, Beschlüsse), keine Datensätze.

**GovData.** Der nationale Open-Data-Katalog (`ckan.govdata.de`, `--portal govdata`). Er
**übernimmt** (harvestet) die meisten Länderportale, seine Zahlen überschneiden sich also mit
deren Zahlen.

---

## CKAN-Kernobjekte

**Datensatz (`Package`).** Die zentrale Katalogeinheit: eine beschriebene Sammlung von
Ressourcen mit Titel, Beschreibung, Herausgeber, Schlagwörtern, Lizenz und Zeitstempeln. Die
API nennt ihn **package** (`package_search`, `package_show`). Angesprochen über die ID (UUID)
oder den **Namen** (Slug).

**Typ.** Die Art eines Datensatzes, in `type`: normalerweise `dataset`; Hamburg kennt
außerdem `document` und `app`.

**Ressource (Distribution).** Eine Datei oder ein Dienst innerhalb eines Datensatzes:
`format`, `url`, `size`. Eine Ressourcen-URL ist nicht immer eine Datei: `WMS`/`WFS` sind
Kartendienste, `html`-Ressourcen meist Übersichtsseiten. Nur über die ID ansprechbar
(`ckan resource <id>`).

**Organisation.** Ein **Herausgeber**, dem Datensätze gehören (`ckan organizations`,
`ckan organization <id>`). In Hamburg haben viele Einträge **keine** Organisation.

**Gruppe.** Ein Thema oder eine Kategorie (`ckan groups`, `ckan group <id>`).

**Schlagwort (Tag).** Ein freies Stichwort an einem Datensatz (`ckan tags --query
<Teilzeichenkette>`). In Hamburg sind viele Tags ganze Stichwortlisten in einem String.

**Lizenz (`license_id`).** Die Lizenz eines Eintrags, pro Eintrag gesetzt. Die Portale
schreiben dieselbe Lizenz unterschiedlich (`dl-de-by-2.0`, `dl-by-de/2.0`,
`http://dcat-ap.de/def/licenses/dl-by-de/2.0`); bei GovData und daten.bw ist die Lizenz des
Datensatzes meist leer und steht an den Ressourcen. `ckan licenses` listet die Lizenzen, die
ein Portal anbietet.

**Extras.** Portalspezifische Felder als `{key, value}`-Paare, durchsuchbar als
`extras_<key>`. In Hamburg: `registerobject_type` (der *Informationsgegenstand*),
`publishing_date`, `terms_of_use` (mit dem vorgeschriebenen Namensnennungstext),
`offline_date`.

**Informationsgegenstand.** Hamburgs Dokumenttyp (Vertrag, Gutachten, Senatsmitteilung …),
in `extras_registerobject_type`. Zuverlässig filtern lässt sich nur mit der **gestemmten**
Indexform: `vertrageoffinteress`, nicht `vertraege_oeff_interesse` (Hamburgs eigene
Werteliste, die nichts findet).

---

## Mechanik der CKAN-Action-API

**Action-API.** CKANs RPC-artige HTTP-API unter `<site>/api/3/action/<name>`, eine Aktion
pro Operation (`package_search`, `organization_list`, `status_show` …).

**Aktionsname.** Der Bezeichner `[a-z0-9_]+` einer Aktion. Der Client weist alles andere vor
einer Anfrage ab, damit ein Name keinen Pfad, keine Query und kein Fragment einschleusen kann.

**Umschlag (Envelope).** Jede Antwort ist in `{ help, success, result }` bzw.
`{ success: false, error }` verpackt. Der Client packt `result` aus; ein fehlgeschlagener
Umschlag ist ein Fehler.

**Fehlerformen.** CKAN meldet Fehler auf drei Arten, alle als eine lesbare Zeile ausgegeben:
eine Meldung (`Not Found Error: Not found`, HTTP 404), eine **Validierungs**-Liste je Feld
(`Validation Error: rows: Invalid integer`, HTTP 409) und ein einfacher String für eine
unbekannte Aktion (HTTP 400). Ein Solr-Syntaxfehler wird auf Solrs eigene Begründung
gekürzt.

**`status_show`.** Titel, CKAN-Version und installierte Erweiterungen eines Portals
(`ckan status`); manche Portale sperren die Aktion (Berlin antwortet mit 403).

**Generische Aktion.** `ckan action <name> --param key=value …` ruft jede lesende Aktion auf,
auch solche aus Erweiterungen.

---

## Suchparameter (Solr)

Die CKAN-Suche läuft auf **Apache Solr**, die Parameter folgen daher der Solr-Syntax.

**`q` (Query).** Die Volltextsuche, z. B. `elbe` oder `title:haushalt`. CLI: `search
[query]`.

**`fq` (Filter-Query).** Ein Filter, der die Treffer einschränkt, ohne ihre Reihenfolge zu
ändern, z. B. `organization:allris`. CLI: `--fq`, wiederholbar; jeder Filter muss zutreffen.
CKAN beantwortet einen wiederholten `fq`-Schlüssel mit HTTP 409, deshalb wird ein Filter als
`fq` und mehrere als `fq_list` gesendet.

**`rows` / `start`.** Seitengröße und Versatz ab 0. CKAN begrenzt `rows` (standardmäßig auf
1000), ohne es zu melden; mit `--start` weiterblättern.

**`sort`.** Ein Sortierausdruck, z. B. `metadata_modified desc`. Ein unbekanntes Sortierfeld
wird ignoriert, nicht abgewiesen.

**Facette (`facet.field`, `facet.limit`).** Wertezählungen über ein Suchergebnis, z. B. je
Herausgeber oder Format. CLI: `--facet <Feld>` (wiederholbar) und `--facet-limit <n>`; die
Standardgrenze ist 50 und schneidet die Liste stillschweigend ab, `-1` liefert alle Werte.
Gezählt werden **Datensätze**, nicht Dateien.

**`res_format`.** Das Format einer Ressource, als Filter in `fq` und als Facette nutzbar. Je
Portal anders geschrieben (`pdf`, `PDF`, EU-Dateityp-URIs); Berlins Filter unterscheidet
Groß- und Kleinschreibung.

**`metadata_created` / `metadata_modified`.** Wann ein Eintrag ins Portal kam und wann er
zuletzt geändert wurde; echte Datumsfelder, Zeiträume funktionieren also:
`--fq 'metadata_created:[2026-09-01T00:00:00Z TO *]'`. Ein Zeitraum auf einem Datum in
`extras_*` wird als Text verglichen und liefert Unsinn.

---

## Kennungen und Seitenweise Abfrage

**ID / Name.** Datensätze, Organisationen und Gruppen sind über die ID (UUID) oder den Namen
(Slug) ansprechbar, Ressourcen nur über die ID.

**`limit` / `offset`.** Seitenweise Abfrage für die `*_list`-Aktionen (`packages`,
`organizations`, `groups`), getrennt von `rows` / `start` der Suche.

**`all_fields`.** Bei `organizations` / `groups` vollständige Objekte statt Namen. CKAN
begrenzt eine solche Liste stillschweigend auf 25 Einträge; der Client blättert über diese
Grenze hinweg.

**Leerer Wert.** Ein leerer oder nur aus Leerzeichen bestehender Filter, Suchbegriff oder
eine leere ID ist ein Bedienfehler, nie eine stillschweigend ungefilterte Suche.

---

> **Bibliothek und Interna.** Die Begriffe des TypeScript-Clients und seiner Interna –
> `CkanClient`, Request-Engine, Transport, Wiederholung/Backoff, Fehlertypen, die Portalliste
> und ihr Aktualisierungsskript – stehen in **[DEVELOPING.md](DEVELOPING.md)** (englisch).
