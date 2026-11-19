// Recorded answers of CKAN Action APIs (2026-11-20 ~01:10–01:20 CET), cut to the fields the
// operations read (datasets: the extras of interest, tags at most 5, descriptions at most 300
// characters), and a mock of the APIs over their own hosts and paths (`ckanApi()`), which answers
// from them as CKAN does: package_search by host, q and fq (the format, organization, group, type,
// files and tag filters applied to the recorded datasets), paged with start and rows, facets cut at
// facet.limit; package_show by name, an unknown one with CKAN's 404. A portal of the list without a
// recording answers every search with count 0 (a stand-in).
//
// What they hold:
// - Transparenzportal Hamburg (suche.transparenz.hamburg.de, the client's default): a search for
//   Radverkehr (3753 hits, 4 recorded: three Gutachten-like documents of the Hamburg Port
//   Authority, two without a stored document type, one CC0, one Stadtreinigung dataset with GML,
//   XSD, XML and HTML files and no organization); the whole portal's facets (254249 records: the
//   20 stemmed document types, 6 organizations, 33 lower-case formats including shapefiles, 6
//   licences with two spellings of DL-DE Zero, 14 groups, 3 record types); Gutachten about
//   Radverkehr (52, 3 recorded: a CC0 PDF, two Magistralen maps as WMS and a metaver page); the 4
//   newest contracts of public interest (3069: CC0 PDFs, a file number, stored type
//   vertraegeoeffinteresse); the record kbq-verkehrstechnische-untersuchung-radverkehr; CKAN's 404
//   for an unknown name; and one HTTP 500 its search server answered while recording
//   ("Search Connection Error");
// - Berlin (datenregister.berlin.de): Radverkehr's facets (14 datasets; formats, licences
//   dl-de-zero-2.0, cc-by/4.0, cc-by and other-closed, 4 organizations, 2 groups) and its 2 CSV
//   datasets (a CSV link that is a landing page, an other-closed licence);
// - Open.NRW (open.nrw): a search for Radverkehr (105, 3 recorded: licences as DCAT-AP.de URIs,
//   cc-zero/1.0 and other-closed, on the dataset and its file);
// - GovData (ckan.govdata.de): the count for Radverkehr (266).

import type { HttpRequest, HttpResponse } from "../src/http.js";
import { jsonResponse, makeMockTransport, type MockTransport } from "./helpers.js";

export const HAMBURG_RADVERKEHR = {
  "count": 3753,
  "sort": "score desc, metadata_modified desc",
  "results": [
    {
      "id": "f2724f9c-d5d2-429b-a905-aa8a2c9714bf",
      "name": "potentialermittlung-radverkehr",
      "title": "Potentialermittlung Radverkehr",
      "type": "document",
      "notes": "Potentialermittlung Radverkehr im Zusammenhang mit der Köhlbrandquerung",
      "url": null,
      "num_resources": 1,
      "license_id": "dl-de-by-2.0",
      "license_title": "Datenlizenz Deutschland - Namensnennung - 2.0",
      "metadata_created": "2023-12-22T17:06:32.464524",
      "metadata_modified": "2023-12-22T17:06:32.464529",
      "author": "Hamburg Port Authority",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        }
      ],
      "tags": [
        {
          "name": "Köhlbrandquerung"
        },
        {
          "name": "Ost-West-Achse"
        },
        {
          "name": "Potentialanalyse"
        },
        {
          "name": "Radverkehr"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2034-01-22T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2023-12-22T00:00:00"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2023-12-22T00:00:00"
        },
        {
          "key": "temporal_coverage_to",
          "value": "2028-12-31T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"dl-de-by-2.0\", \"license_url\": \"http://www.govdata.de/dl-de/by-2-0\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "724742d9-1643-41e3-a49b-6dd0ce8a4b17",
          "name": "Upload: 220405_PTV-PGV Alruzt_Radverkehr Potenzialermittlung_mit Anl_Nr55",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/76d19194-264a-48f9-91b7-a1f1c52215a9/Upload__220405_PTV-PGV_Alruzt_Radverkehr_Potenzialermittlung_mit_Anl_Nr55.PDF",
          "size": 18405186
        }
      ]
    },
    {
      "id": "d16fea7f-53ef-47c9-bacf-b72e5f367527",
      "name": "gutachten-koehlbrandquerung-radverkehr",
      "title": "Gutachten Köhlbrandquerung Radverkehr",
      "type": "document",
      "notes": "Köhlbrandquerung  Gutachten Tunnellüftung Radverkehr",
      "url": null,
      "num_resources": 1,
      "license_id": "dl-de-by-2.0",
      "license_title": "Datenlizenz Deutschland - Namensnennung - 2.0",
      "metadata_created": "2023-12-21T17:06:21.930986",
      "metadata_modified": "2023-12-21T17:06:21.930993",
      "author": "Hamburg Port Authority",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        }
      ],
      "tags": [
        {
          "name": "Köhlbrandquerung Radverkehr"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2034-01-21T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2023-12-21T00:00:00"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2023-12-21T00:00:00"
        },
        {
          "key": "temporal_coverage_to",
          "value": "2028-12-31T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"dl-de-by-2.0\", \"license_url\": \"http://www.govdata.de/dl-de/by-2-0\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "92bdb8c2-0bd6-4ca5-9170-bdd43f8661e7",
          "name": "Upload: 2021-09_HBI Haerter_Tunnellueftung Radroehre_Nr43_geschwaerzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/48f2fca4-2712-439a-905f-2bae3d729730/Upload__2021-09_HBI_Haerter_Tunnellueftung_Radroehre_Nr43_geschwaerzt.PDF",
          "size": 908554
        }
      ]
    },
    {
      "id": "8e4352bf-d4d9-44a1-b458-8d34b858cac7",
      "name": "kbq-verkehrstechnische-untersuchung-radverkehr",
      "title": "KBQ_Verkehrstechnische Untersuchung Radverkehr",
      "type": "document",
      "notes": "KBQ_Verkehrstechnische Untersuchung Radverkehr der Firma Masuch&Olbrisch",
      "url": null,
      "num_resources": 1,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-08-03T16:04:41.050732",
      "metadata_modified": "2026-08-03T16:04:41.050736",
      "author": "Hamburg Port Authority",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        }
      ],
      "tags": [
        {
          "name": "KBQ Radverkehr"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2036-09-03T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-08-03T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "gutachten"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-08-03T00:00:00"
        },
        {
          "key": "temporal_coverage_to",
          "value": "2036-08-03T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "77d89487-3b4e-4300-a792-397c1d726e40",
          "name": "Upload: VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/2ee58073-be63-4840-8420-6c7715297dac/Upload__VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwaerzt.PDF",
          "size": 7555605
        }
      ]
    },
    {
      "id": "8db960e5-e7af-4ab5-ac22-25c74a6d7897",
      "name": "winterdienst-fur-den-radverkehr-durch-srh-hamburg2",
      "title": "Winterdienst für den Radverkehr durch SRH Hamburg",
      "type": "dataset",
      "notes": "<b>++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\nDiese Daten werden aktualisiert und befinden sich in der Verarbeitung.\nIn der Zwischenzeit finden Sie weitere Informationen unter: <a href=\"https://www.stadtreinigung.hamburg/winterdienst\">www.stadtreinigung.h…",
      "url": null,
      "num_resources": 6,
      "license_id": "dl-de-by-2.0",
      "license_title": "Datenlizenz Deutschland - Namensnennung - 2.0",
      "metadata_created": "2021-05-01T17:02:57.085634",
      "metadata_modified": "2021-12-10T18:02:30.928864",
      "author": "Stadtreinigung Hamburg",
      "maintainer": "Stadtreinigung Hamburg",
      "organization": null,
      "groups": [
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        }
      ],
      "tags": [
        {
          "name": "Geodaten"
        },
        {
          "name": "Stadtreinigung"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2100-12-31T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2021-05-01T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "geodaten"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"dl-de-by-2.0\", \"license_url\": \"https://www.govdata.de/dl-de/by-2-0\", \"is_free_to_use\": true, \"attribution_text\": \"Stadtreinigung Hamburg\"}"
        }
      ],
      "resources": [
        {
          "id": "c671bfb4-6b1b-4d88-a205-d48347e8ae6a",
          "name": "Download WFS Winterdienst für den Radverkehr durch SRH Hamburg (GML)",
          "format": "GML",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/hh_wfs_winterdienst_radverkehr_srh_74480_snap_4.GML",
          "size": 23914506
        },
        {
          "id": "8ad90582-0cce-4cc3-a184-caa28eedc2d1",
          "name": "Download WFS-Schemadatei Winterdienst für den Radverkehr durch SRH Hamburg (XSD)",
          "format": "XSD",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/hh_wfs_winterdienst_radverkehr_srh_103100_snap_8.XSD",
          "size": 2527
        },
        {
          "id": "020c8980-5cb5-4a56-9016-fc8678f44de4",
          "name": "Dienst \"WMS Winterdienst für den Radverkehr durch SRH Hamburg\" (GetCapabilities)",
          "format": "XML",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/hh_wms_winterdienst_radverkehr_srh_74482_snap_4.XML",
          "size": 24080
        },
        {
          "id": "00a893a4-ae26-4f3a-8089-bc5956a6db41",
          "name": "Dienst \"WFS Winterdienst für den Radverkehr durch SRH Hamburg\" (GetCapabilities)",
          "format": "XML",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/hh_wfs_winterdienst_radverkehr_srh_94504_snap_5.XML",
          "size": 33878
        },
        {
          "id": "6f099c3f-7e37-45f6-9783-7fbbc3c3855b",
          "name": "Qualifizierter Link auf die Karte „Winterdienst für den Radverkehr“",
          "format": "HTML",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/qualifizierter-link-auf-die-karte-winterdienst-fur-den-radverkehr_94505_snap_4.HTML",
          "size": 585
        },
        {
          "id": "21f8db32-ba99-4a64-b9aa-1de6a138315c",
          "name": "Metadatenbeschreibung aus dem MetaVer",
          "format": "HTML",
          "url": "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/trefferanzeige_103101_snap_8.HTML",
          "size": 97350
        }
      ]
    }
  ]
};

export const HAMBURG_FACETS = {
  "count": 254249,
  "search_facets": {
    "extras_registerobject_type": {
      "title": "extras_registerobject_type",
      "items": [
        {
          "name": "verwaltungsvorschrift",
          "display_name": "verwaltungsvorschrift",
          "count": 1378
        },
        {
          "name": "verwaltungsbelang",
          "display_name": "verwaltungsbelang",
          "count": 901
        },
        {
          "name": "vertrageoffinteress",
          "display_name": "vertrageoffinteress",
          "count": 3069
        },
        {
          "name": "vergleichbar",
          "display_name": "vergleichbar",
          "count": 1841
        },
        {
          "name": "subvention",
          "display_name": "subvention",
          "count": 69
        },
        {
          "name": "statist",
          "display_name": "statist",
          "count": 13403
        },
        {
          "name": "stadtischebeteil",
          "display_name": "stadtischebeteil",
          "count": 189
        },
        {
          "name": "senatpetitum",
          "display_name": "senatpetitum",
          "count": 6507
        },
        {
          "name": "senatmitteil",
          "display_name": "senatmitteil",
          "count": 4772
        },
        {
          "name": "ohneveroffentlichungspflicht",
          "display_name": "ohneveroffentlichungspflicht",
          "count": 3513
        },
        {
          "name": "messung",
          "display_name": "messung",
          "count": 5043
        },
        {
          "name": "gutacht",
          "display_name": "gutacht",
          "count": 2089
        },
        {
          "name": "geodat",
          "display_name": "geodat",
          "count": 10056
        },
        {
          "name": "dienstanweis",
          "display_name": "dienstanweis",
          "count": 1371
        },
        {
          "name": "daseinsvorsorg",
          "display_name": "daseinsvorsorg",
          "count": 923
        },
        {
          "name": "beschluss",
          "display_name": "beschluss",
          "count": 101951
        },
        {
          "name": "baumkatast",
          "display_name": "baumkatast",
          "count": 83
        },
        {
          "name": "bauleitplan",
          "display_name": "bauleitplan",
          "count": 51389
        },
        {
          "name": "baugenehm",
          "display_name": "baugenehm",
          "count": 39734
        },
        {
          "name": "andereveroffentlichungspflicht",
          "display_name": "andereveroffentlichungspflicht",
          "count": 3993
        }
      ]
    },
    "organization": {
      "title": "organization",
      "items": [
        {
          "name": "workflows",
          "display_name": "Workflows",
          "count": 8499
        },
        {
          "name": "statistikamt",
          "display_name": "Statistikamt",
          "count": 12139
        },
        {
          "name": "stadthamburg",
          "display_name": "StadtHamburg",
          "count": 9183
        },
        {
          "name": "hmdklgv",
          "display_name": "HMDKLGV",
          "count": 27116
        },
        {
          "name": "dokrates",
          "display_name": "DOKRATES",
          "count": 4107
        },
        {
          "name": "allris",
          "display_name": "ALLRIS",
          "count": 34668
        }
      ]
    },
    "res_format": {
      "title": "res_format",
      "items": [
        {
          "name": "zip",
          "display_name": "zip",
          "count": 11084
        },
        {
          "name": "xsd",
          "display_name": "xsd",
          "count": 5984
        },
        {
          "name": "xml",
          "display_name": "xml",
          "count": 11390
        },
        {
          "name": "xlsx",
          "display_name": "xlsx",
          "count": 6150
        },
        {
          "name": "xls",
          "display_name": "xls",
          "count": 1772
        },
        {
          "name": "wms",
          "display_name": "wms",
          "count": 423
        },
        {
          "name": "wfs",
          "display_name": "wfs",
          "count": 417
        },
        {
          "name": "web",
          "display_name": "web",
          "count": 3
        },
        {
          "name": "txt",
          "display_name": "txt",
          "count": 133
        },
        {
          "name": "tiff",
          "display_name": "tiff",
          "count": 10
        },
        {
          "name": "sta",
          "display_name": "sta",
          "count": 91
        },
        {
          "name": "shapefiles",
          "display_name": "shapefiles",
          "count": 22
        },
        {
          "name": "rar",
          "display_name": "rar",
          "count": 73
        },
        {
          "name": "pptx",
          "display_name": "pptx",
          "count": 1
        },
        {
          "name": "png",
          "display_name": "png",
          "count": 305
        },
        {
          "name": "pdf",
          "display_name": "pdf",
          "count": 138665
        },
        {
          "name": "ov2",
          "display_name": "ov2",
          "count": 12
        },
        {
          "name": "oaf",
          "display_name": "oaf",
          "count": 7617
        },
        {
          "name": "mqtt",
          "display_name": "mqtt",
          "count": 94
        },
        {
          "name": "json",
          "display_name": "json",
          "count": 610
        },
        {
          "name": "jpg",
          "display_name": "jpg",
          "count": 7
        },
        {
          "name": "jpeg",
          "display_name": "jpeg",
          "count": 89
        },
        {
          "name": "html",
          "display_name": "html",
          "count": 168379
        },
        {
          "name": "gml",
          "display_name": "gml",
          "count": 56015
        },
        {
          "name": "geotiff",
          "display_name": "geotiff",
          "count": 51
        },
        {
          "name": "ert",
          "display_name": "ert",
          "count": 30
        },
        {
          "name": "dxf",
          "display_name": "dxf",
          "count": 31
        },
        {
          "name": "docx",
          "display_name": "docx",
          "count": 20
        },
        {
          "name": "doc",
          "display_name": "doc",
          "count": 3
        },
        {
          "name": "data",
          "display_name": "data",
          "count": 4
        },
        {
          "name": "csv",
          "display_name": "csv",
          "count": 4476
        },
        {
          "name": "citygml",
          "display_name": "citygml",
          "count": 42
        },
        {
          "name": "ascii",
          "display_name": "ascii",
          "count": 74
        }
      ]
    },
    "license_id": {
      "title": "license_id",
      "items": [
        {
          "name": "odbl",
          "display_name": "odbl",
          "count": 59
        },
        {
          "name": "geoNutz-20130319",
          "display_name": "geoNutz-20130319",
          "count": 48
        },
        {
          "name": "dl-zero-de-2.0",
          "display_name": "dl-zero-de-2.0",
          "count": 265
        },
        {
          "name": "dl-de-zero-2.0",
          "display_name": "Datenlizenz Deutschland - Zero - Version 2.0",
          "count": 3
        },
        {
          "name": "dl-de-by-2.0",
          "display_name": "Datenlizenz Deutschland - Namensnennung - 2.0",
          "count": 248581
        },
        {
          "name": "cc-zero",
          "display_name": "Creative Commons CCZero",
          "count": 2424
        }
      ]
    },
    "groups": {
      "title": "groups",
      "items": [
        {
          "name": "verwaltung-haushalt-und-steuern",
          "display_name": "Öffentliche Verwaltung, Haushalt & Steuern",
          "count": 59855
        },
        {
          "name": "wirtschaft-und-arbeit",
          "display_name": "Wirtschaft & Arbeit",
          "count": 8697
        },
        {
          "name": "verbraucherschutz",
          "display_name": "Verbraucherschutz",
          "count": 4113
        },
        {
          "name": "umwelt-und-klima",
          "display_name": "Umwelt & Klima",
          "count": 24839
        },
        {
          "name": "transport-und-verkehr",
          "display_name": "Transport & Verkehr",
          "count": 24228
        },
        {
          "name": "soziales",
          "display_name": "Soziales",
          "count": 18877
        },
        {
          "name": "politik-und-wahlen",
          "display_name": "Politik & Wahlen",
          "count": 103354
        },
        {
          "name": "kultur-sport-und-tourismus",
          "display_name": "Kultur, Sport & Tourismus",
          "count": 19499
        },
        {
          "name": "infrastruktur-bauen-und-wohnen",
          "display_name": "Infrastruktur, Bauen & Wohnen",
          "count": 122371
        },
        {
          "name": "gesundheit",
          "display_name": "Gesundheit",
          "count": 4787
        },
        {
          "name": "gesetze-und-justiz",
          "display_name": "Gesetze & Justiz",
          "count": 4733
        },
        {
          "name": "geografie-geologie-und-geodaten",
          "display_name": "Geographie, Geologie &Geodaten",
          "count": 8852
        },
        {
          "name": "bildung-und-wissenschaft",
          "display_name": "Bildung & Wissenschaft ",
          "count": 4740
        },
        {
          "name": "bevolkerung",
          "display_name": "Bevölkerung",
          "count": 30344
        }
      ]
    },
    "type": {
      "title": "type",
      "items": [
        {
          "name": "document",
          "display_name": "document",
          "count": 172940
        },
        {
          "name": "dataset",
          "display_name": "dataset",
          "count": 81202
        },
        {
          "name": "app",
          "display_name": "app",
          "count": 107
        }
      ]
    }
  }
};

export const HAMBURG_GUTACHTEN_RADVERKEHR = {
  "count": 52,
  "sort": "metadata_created desc",
  "results": [
    {
      "id": "8e4352bf-d4d9-44a1-b458-8d34b858cac7",
      "name": "kbq-verkehrstechnische-untersuchung-radverkehr",
      "title": "KBQ_Verkehrstechnische Untersuchung Radverkehr",
      "type": "document",
      "notes": "KBQ_Verkehrstechnische Untersuchung Radverkehr der Firma Masuch&Olbrisch",
      "url": null,
      "num_resources": 1,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-08-03T16:04:41.050732",
      "metadata_modified": "2026-08-03T16:04:41.050736",
      "author": "Hamburg Port Authority",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        }
      ],
      "tags": [
        {
          "name": "KBQ Radverkehr"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2036-09-03T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-08-03T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "gutachten"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-08-03T00:00:00"
        },
        {
          "key": "temporal_coverage_to",
          "value": "2036-08-03T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "77d89487-3b4e-4300-a792-397c1d726e40",
          "name": "Upload: VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/2ee58073-be63-4840-8420-6c7715297dac/Upload__VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwaerzt.PDF",
          "size": 7555605
        }
      ]
    },
    {
      "id": "7db64950-a073-4858-8602-9f73bad874ce",
      "name": "magistralen-masterplan-strategiekarte-lebendigkeit-und-vielfalt-der-magistrale-staerken1",
      "title": "Magistralen Masterplan - Strategiekarte Lebendigkeit und Vielfalt der Magistrale stärken",
      "type": "dataset",
      "notes": "Strategiekarte \nLebendigkeit und Vielfalt der Magistralen stärken\n\nSynergien zwischen Magistralen- und Zentrenentwicklung nutzen\nEin Großteil der Haupt-, Stadtteil- und Ortsteilzentren des Hamburger Zentrenkonzepts liegt an Magistralen. Sie reihen sich entlang der Magistralen wie Perlen an einer Ke…",
      "url": null,
      "num_resources": 2,
      "license_id": "dl-de-by-2.0",
      "license_title": "Datenlizenz Deutschland - Namensnennung - 2.0",
      "metadata_created": "2025-08-07T22:31:37.182649",
      "metadata_modified": "2025-10-31T01:45:47.588151",
      "author": "Behörde für Stadtentwicklung und Wohnen (BSW)",
      "maintainer": "Behörde für Stadtentwicklung und Wohnen (BSW)",
      "organization": {
        "name": "hmdklgv",
        "title": "HMDKLGV"
      },
      "groups": [
        {
          "name": "infrastruktur-bauen-und-wohnen",
          "title": "Infrastruktur, Bauen & Wohnen",
          "display_name": "Infrastruktur, Bauen & Wohnen"
        },
        {
          "name": "verwaltung-haushalt-und-steuern",
          "title": "Öffentliche Verwaltung, Haushalt & Steuern",
          "display_name": "Öffentliche Verwaltung, Haushalt & Steuern"
        }
      ],
      "tags": [
        {
          "name": "Gutachten und Studien"
        },
        {
          "name": "Lebendigkeit und Vielfalt der Magistralen"
        },
        {
          "name": "Magistralenentwicklung Hamburg"
        },
        {
          "name": "Masterplan Magistralen 2040+"
        },
        {
          "name": "Strategiekarte"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2100-12-31T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2025-08-08T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "gutachten"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"dl-de-by-2.0\", \"license_url\": \"https://www.govdata.de/dl-de/by-2-0\", \"attribution_text\": \"Freie und Hansestadt Hamburg, Behörde für Stadtentwicklung und Wohnen\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "f44e163e-4513-4c71-8a1a-054d90b4a398",
          "name": "Dienst \"WMS Magistralen Masterplan - Strategiekarte Lebendigkeit und Vielfalt der Magistralen stärken\" (GetCapabilities)",
          "format": "WMS",
          "url": "https://geodienste.hamburg.de/wms_magistralen_masterplan_lebendigkeit_und_vielfalt_staerken?SERVICE=WMS&REQUEST=GetCapabilities",
          "size": 68697
        },
        {
          "id": "351590a8-a994-488a-9b69-37a110f2b55c",
          "name": "Metadatenbeschreibung aus dem MetaVer",
          "format": "HTML",
          "url": "http://metaver.de/trefferanzeige?docuuid=af24ce81-bfc1-4fca-8cef-a9fd55123bd2",
          "size": 99094
        }
      ]
    },
    {
      "id": "270743cd-c1da-428a-bcd8-a4ab2131ed9d",
      "name": "magistralen-masterplan-strategiekarte-mobilitaetsraeume-zukunftsfaehig-gestalten1",
      "title": "Magistralen Masterplan - Strategiekarte Mobilitätsräume zukunftsfähig gestalten",
      "type": "dataset",
      "notes": "Strategiekarte \n Mobilitätsräume zukunftsfähig gestalten\n\nVerlagerungspotenziale des Verkehrsaufkommens durch …\nEin wichtiger Faktor für die positive Entwicklung der Magistralen, aber auch für die verkehrliche Entlastung der gesamten Stadt sind Anreize für den Umstieg auf umweltfreundliche Mobilitä…",
      "url": null,
      "num_resources": 2,
      "license_id": "dl-de-by-2.0",
      "license_title": "Datenlizenz Deutschland - Namensnennung - 2.0",
      "metadata_created": "2025-08-07T22:29:19.613041",
      "metadata_modified": "2025-10-31T01:42:01.100179",
      "author": "Behörde für Stadtentwicklung und Wohnen (BSW)",
      "maintainer": "Behörde für Stadtentwicklung und Wohnen (BSW)",
      "organization": {
        "name": "hmdklgv",
        "title": "HMDKLGV"
      },
      "groups": [
        {
          "name": "infrastruktur-bauen-und-wohnen",
          "title": "Infrastruktur, Bauen & Wohnen",
          "display_name": "Infrastruktur, Bauen & Wohnen"
        },
        {
          "name": "verwaltung-haushalt-und-steuern",
          "title": "Öffentliche Verwaltung, Haushalt & Steuern",
          "display_name": "Öffentliche Verwaltung, Haushalt & Steuern"
        }
      ],
      "tags": [
        {
          "name": "Gutachten und Studien"
        },
        {
          "name": "Magistralenentwicklung Hamburg"
        },
        {
          "name": "Masterplan Magistralen 2040+"
        },
        {
          "name": "Mobilitätsräume zukunftsfähig gestalten"
        },
        {
          "name": "Strategiekarte"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2100-12-31T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2025-08-08T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "gutachten"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"dl-de-by-2.0\", \"license_url\": \"https://www.govdata.de/dl-de/by-2-0\", \"attribution_text\": \"Freie und Hansestadt Hamburg, Behörde für Stadtentwicklung und Wohnen\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "e410ace3-2f4f-46f6-b465-8d4c650b29ba",
          "name": "Dienst \"WMS Magistralen Masterplan - Strategiekarte Mobilitätsräume zukunftsfähig gestalten\" (GetCapabilities)",
          "format": "WMS",
          "url": "https://geodienste.hamburg.de/wms_magistralen_masterplan_mobilitaetsraeume_gestalten?SERVICE=WMS&REQUEST=GetCapabilities",
          "size": 71712
        },
        {
          "id": "e9e7e80e-63c6-4e3d-968a-3b46a98a0e5a",
          "name": "Metadatenbeschreibung aus dem MetaVer",
          "format": "HTML",
          "url": "http://metaver.de/trefferanzeige?docuuid=8078e6af-b272-495d-beb5-0816da75849b",
          "size": 99345
        }
      ]
    }
  ]
};

export const HAMBURG_CONTRACTS = {
  "count": 3069,
  "sort": "metadata_created desc",
  "results": [
    {
      "id": "a533dbf0-2273-4b39-9037-525a64db9819",
      "name": "vergabe-hafun-06-mittelspannungsanlagen",
      "title": "Vergabe HAFUN_06_Mittelspannungsanlagen",
      "type": "document",
      "notes": "Vergabe HAFUN_06_Mittelspannungsanlagen",
      "url": null,
      "num_resources": 4,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-11-17T17:04:37.637287",
      "metadata_modified": "2026-11-17T17:04:37.637292",
      "author": "Sprinkenhof GmbH",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "bildung-und-wissenschaft",
          "title": "Bildung & Wissenschaft ",
          "display_name": "Bildung & Wissenschaft "
        }
      ],
      "tags": [
        {
          "name": "Vergabe HAFUN_06_Mittelspannungsanlagen"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2036-11-17T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-11-17T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "vertraegeoeffinteresse"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-08-13T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "1e970803-2090-4022-9214-c86032859050",
          "name": "Upload: 6-040_Angebot_07 2024_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/48bcfa8c-7bba-4d25-924a-e086f8f6aaa3/Upload__6-040_Angebot_07_2024_geschwaerzt.PDF",
          "size": 844976
        },
        {
          "id": "89efe95b-9496-4151-bd1e-3614209567ee",
          "name": "Upload: 261102_Zuschlag_WISAG Elektrotechnik Nord_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/81451cf8-d5a5-4421-9a29-35d10b2d6d4a/Upload__261102_Zuschlag_WISAG_Elektrotechnik_Nord_geschwaerzt.PDF",
          "size": 21698
        },
        {
          "id": "bf124d1f-bc54-4ccb-9626-65c2b80897c0",
          "name": "Upload: B4410_Leistungsverzeichnis_oP_neu",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/912db36b-1f95-4038-945c-d30dda9d9508/Upload__B4410_Leistungsverzeichnis_oP_neu.PDF",
          "size": 4040900
        },
        {
          "id": "87e01ce1-c969-46cb-a7e5-2a2481c19bdc",
          "name": "Upload: Besondere Vertragsbedingungen (BVB) mit Wartung 4410_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/86925ed5-cab0-4874-ac90-ccb61f8682da/Upload__Besondere_Vertragsbedingungen__BVB__mit_Wartung_4410_geschwaerzt.PDF",
          "size": 245208
        }
      ]
    },
    {
      "id": "0741bc14-7f76-471e-9527-44fd075fa521",
      "name": "haus-der-jugend-hammer-park-3-zusatzvertrag-vom-11-09-2026-zum-architektenvertrag-objek-08-2023",
      "title": "Haus der Jugend Hammer Park - 3. Zusatzvertrag vom 11.09.2026 zum Architektenvertrag Objektplanung Freianlagen vom 14.08.2023",
      "type": "document",
      "notes": "3. Zusatzvertrag vom 11.09.2026 zum Architektenvertrag - Freianlagen - vom 14.08.2023 zum Projekt \"Modellvorhaben \"Mitte machen\": Neubau im Hammer Park\" (Otto-Linne-Haus – Haus der Generationen).",
      "url": null,
      "num_resources": 1,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-11-13T17:04:15.585146",
      "metadata_modified": "2026-11-13T17:04:15.585150",
      "author": "Bezirksamt Mitte",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "bevolkerung",
          "title": "Bevölkerung",
          "display_name": "Bevölkerung"
        },
        {
          "name": "kultur-sport-und-tourismus",
          "title": "Kultur, Sport & Tourismus",
          "display_name": "Kultur, Sport & Tourismus"
        },
        {
          "name": "politik-und-wahlen",
          "title": "Politik & Wahlen",
          "display_name": "Politik & Wahlen"
        },
        {
          "name": "soziales",
          "title": "Soziales",
          "display_name": "Soziales"
        },
        {
          "name": "verbraucherschutz",
          "title": "Verbraucherschutz",
          "display_name": "Verbraucherschutz"
        },
        {
          "name": "wirtschaft-und-arbeit",
          "title": "Wirtschaft & Arbeit",
          "display_name": "Wirtschaft & Arbeit"
        }
      ],
      "tags": [
        {
          "name": "Haus der Jugend Hammer Park 3. Zusatzvertrag Architektenvertrag Objektplanung Freianlagen"
        }
      ],
      "extras": [
        {
          "key": "file_reference_digital",
          "value": "000.00-04"
        },
        {
          "key": "offline_date",
          "value": "2036-12-10T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-11-13T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "vertraegeoeffinteresse"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-09-22T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "4d4d1021-f608-446d-9edc-62fe521f42d9",
          "name": "Akte: 000.00-04",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/31c61bfb-64af-4295-8fdd-4aaf0fa87a5a/Akte__000.00-04.pdf",
          "size": 1495560
        }
      ]
    },
    {
      "id": "e0387eb6-5ace-49fc-92a5-3361e2b818d9",
      "name": "u-bahn-farmsen-baulos-1-strassenbau-los-1",
      "title": "U-Bahn Farmsen Baulos 1, Straßenbau (Los 1)",
      "type": "document",
      "notes": "Busoptimierung Metrobuslinie 26, Baulos 1, Straßenbauarbeiten (Los 1)",
      "url": null,
      "num_resources": 2,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-11-10T17:04:15.111693",
      "metadata_modified": "2026-11-10T17:04:15.111697",
      "author": "Landesbetrieb Straßen, Brücken und Gewässer",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "bevolkerung",
          "title": "Bevölkerung",
          "display_name": "Bevölkerung"
        },
        {
          "name": "geografie-geologie-und-geodaten",
          "title": "Geographie, Geologie &Geodaten",
          "display_name": "Geographie, Geologie &Geodaten"
        },
        {
          "name": "infrastruktur-bauen-und-wohnen",
          "title": "Infrastruktur, Bauen & Wohnen",
          "display_name": "Infrastruktur, Bauen & Wohnen"
        },
        {
          "name": "verwaltung-haushalt-und-steuern",
          "title": "Öffentliche Verwaltung, Haushalt & Steuern",
          "display_name": "Öffentliche Verwaltung, Haushalt & Steuern"
        },
        {
          "name": "soziales",
          "title": "Soziales",
          "display_name": "Soziales"
        },
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        },
        {
          "name": "umwelt-und-klima",
          "title": "Umwelt & Klima",
          "display_name": "Umwelt & Klima"
        },
        {
          "name": "verbraucherschutz",
          "title": "Verbraucherschutz",
          "display_name": "Verbraucherschutz"
        },
        {
          "name": "wirtschaft-und-arbeit",
          "title": "Wirtschaft & Arbeit",
          "display_name": "Wirtschaft & Arbeit"
        }
      ],
      "tags": [
        {
          "name": "Bushaltestellen"
        },
        {
          "name": "Metrobusline 26"
        },
        {
          "name": "Straßenbauarbeiten"
        },
        {
          "name": "U-Bahn Farmsen"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2036-12-10T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-11-10T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "vertraegeoeffinteresse"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-11-10T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "ea55e17a-1a6d-4873-baea-aad195406480",
          "name": "Upload: Leistungsverzeichnis_MB 26_U Farmsen_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/35006026-94a1-47e5-bd35-af9f498f9d8c/Upload__Leistungsverzeichnis_MB_26_U_Farmsen_geschwaerzt.PDF",
          "size": 1734350
        },
        {
          "id": "c26999ba-f824-40fd-a6bd-6ce08e2d8f96",
          "name": "Upload: EUROVIA_Zuschlagsschreiben_MB 26_U Farmsen_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/3e29fcfb-7931-4986-8cd2-13669462270e/Upload__EUROVIA_Zuschlagsschreiben_MB_26_U_Farmsen_geschwaerzt.PDF",
          "size": 625338
        }
      ]
    },
    {
      "id": "dce23294-689d-4c71-a2c9-33ea5d295aa3",
      "name": "steinstrasse-strassenbegleitgruen",
      "title": "Steinstraße Straßenbegleitgrün",
      "type": "document",
      "notes": "Im Rahmen der Baumaßnahme in und an der Steinstraße werden Garten- und Landschaftsbau sowie Pflanzarbeiten realisiert.",
      "url": null,
      "num_resources": 2,
      "license_id": "cc-zero",
      "license_title": "Creative Commons CCZero",
      "metadata_created": "2026-11-09T17:05:41.701420",
      "metadata_modified": "2026-11-09T17:05:41.701425",
      "author": "Landesbetrieb Straßen, Brücken und Gewässer",
      "maintainer": "Fachliche Leitstelle Transparenzportal",
      "organization": {
        "name": "workflows",
        "title": "Workflows"
      },
      "groups": [
        {
          "name": "bevolkerung",
          "title": "Bevölkerung",
          "display_name": "Bevölkerung"
        },
        {
          "name": "geografie-geologie-und-geodaten",
          "title": "Geographie, Geologie &Geodaten",
          "display_name": "Geographie, Geologie &Geodaten"
        },
        {
          "name": "infrastruktur-bauen-und-wohnen",
          "title": "Infrastruktur, Bauen & Wohnen",
          "display_name": "Infrastruktur, Bauen & Wohnen"
        },
        {
          "name": "verwaltung-haushalt-und-steuern",
          "title": "Öffentliche Verwaltung, Haushalt & Steuern",
          "display_name": "Öffentliche Verwaltung, Haushalt & Steuern"
        },
        {
          "name": "soziales",
          "title": "Soziales",
          "display_name": "Soziales"
        },
        {
          "name": "transport-und-verkehr",
          "title": "Transport & Verkehr",
          "display_name": "Transport & Verkehr"
        },
        {
          "name": "umwelt-und-klima",
          "title": "Umwelt & Klima",
          "display_name": "Umwelt & Klima"
        },
        {
          "name": "verbraucherschutz",
          "title": "Verbraucherschutz",
          "display_name": "Verbraucherschutz"
        },
        {
          "name": "wirtschaft-und-arbeit",
          "title": "Wirtschaft & Arbeit",
          "display_name": "Wirtschaft & Arbeit"
        }
      ],
      "tags": [
        {
          "name": "Domplatz"
        },
        {
          "name": "Speesort"
        },
        {
          "name": "Steinstraße"
        },
        {
          "name": "Straßenbegleitgrün"
        },
        {
          "name": "Straßenumbau"
        }
      ],
      "extras": [
        {
          "key": "offline_date",
          "value": "2036-12-09T00:00:00"
        },
        {
          "key": "publishing_date",
          "value": "2026-11-09T00:00:00"
        },
        {
          "key": "registerobject_type",
          "value": "vertraegeoeffinteresse"
        },
        {
          "key": "temporal_coverage_from",
          "value": "2026-11-09T00:00:00"
        },
        {
          "key": "terms_of_use",
          "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
        }
      ],
      "resources": [
        {
          "id": "e34d7f86-0599-40ba-9bc7-70f76fc1ed1a",
          "name": "Upload: Zuschlagsschreiben_Steinstraße Straßenbegleitgrün-_geschwärzt",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/d64a5d0b-c702-43e9-9d36-6de9c524b14a/Upload__Zuschlagsschreiben_Steinstrasse_Strassenbegleitgruen-_geschwaerzt.PDF",
          "size": 2284973
        },
        {
          "id": "353b3769-d76b-47d4-8598-da052e6ce02f",
          "name": "Upload: Leistungsverzeichnis_Steinstraße Straßenbegleitgrün",
          "format": "PDF",
          "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/e3a20197-aa05-4769-81bb-8b32c92f95a3/Upload__Leistungsverzeichnis_Steinstrasse_Strassenbegleitgruen.PDF",
          "size": 549744
        }
      ]
    }
  ]
};

export const HAMBURG_DOCUMENT = {
  "id": "8e4352bf-d4d9-44a1-b458-8d34b858cac7",
  "name": "kbq-verkehrstechnische-untersuchung-radverkehr",
  "title": "KBQ_Verkehrstechnische Untersuchung Radverkehr",
  "type": "document",
  "notes": "KBQ_Verkehrstechnische Untersuchung Radverkehr der Firma Masuch&Olbrisch",
  "url": null,
  "num_resources": 1,
  "license_id": "cc-zero",
  "license_title": "Creative Commons CCZero",
  "metadata_created": "2026-08-03T16:04:41.050732",
  "metadata_modified": "2026-08-03T16:04:41.050736",
  "author": "Hamburg Port Authority",
  "maintainer": "Fachliche Leitstelle Transparenzportal",
  "organization": {
    "name": "workflows",
    "title": "Workflows"
  },
  "groups": [
    {
      "name": "transport-und-verkehr",
      "title": "Transport & Verkehr",
      "display_name": "Transport & Verkehr"
    }
  ],
  "tags": [
    {
      "name": "KBQ Radverkehr"
    }
  ],
  "extras": [
    {
      "key": "offline_date",
      "value": "2036-09-03T00:00:00"
    },
    {
      "key": "publishing_date",
      "value": "2026-08-03T00:00:00"
    },
    {
      "key": "registerobject_type",
      "value": "gutachten"
    },
    {
      "key": "temporal_coverage_from",
      "value": "2026-08-03T00:00:00"
    },
    {
      "key": "temporal_coverage_to",
      "value": "2036-08-03T00:00:00"
    },
    {
      "key": "terms_of_use",
      "value": "{\"license_id\": \"cc-zero\", \"license_url\": \"http://creativecommons.org/publicdomain/zero/1.0/deed.de\", \"attribution_text\": \"Namensnennung: Freie und Hansestadt Hamburg\", \"is_free_to_use\": true}"
    }
  ],
  "resources": [
    {
      "id": "77d89487-3b4e-4300-a792-397c1d726e40",
      "name": "Upload: VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwärzt",
      "format": "PDF",
      "url": "https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/2ee58073-be63-4840-8420-6c7715297dac/Upload__VerkehrstechnUntersuchung_Radverkehr_KBQ_geschwaerzt.PDF",
      "size": 7555605
    }
  ]
};

export const BERLIN_FACETS_RADVERKEHR = {
  "count": 14,
  "search_facets": {
    "res_format": {
      "title": "res_format",
      "items": [
        {
          "name": "gpx",
          "display_name": "gpx",
          "count": 1
        },
        {
          "name": "XLSX",
          "display_name": "XLSX",
          "count": 1
        },
        {
          "name": "WMS",
          "display_name": "WMS",
          "count": 5
        },
        {
          "name": "WFS",
          "display_name": "WFS",
          "count": 5
        },
        {
          "name": "JSON",
          "display_name": "JSON",
          "count": 1
        },
        {
          "name": "CSV",
          "display_name": "CSV",
          "count": 2
        }
      ]
    },
    "license_id": {
      "title": "license_id",
      "items": [
        {
          "name": "other-closed",
          "display_name": "Siehe Website des Datensatzes",
          "count": 1
        },
        {
          "name": "dl-de-zero-2.0",
          "display_name": "Datenlizenz Deutschland – Zero – Version 2.0",
          "count": 11
        },
        {
          "name": "cc-by/4.0",
          "display_name": "Creative Commons Attribution 4.0",
          "count": 1
        },
        {
          "name": "cc-by",
          "display_name": "Creative Commons Attribution",
          "count": 1
        }
      ]
    },
    "organization": {
      "title": "organization",
      "items": [
        {
          "name": "simra-projekt",
          "display_name": "SimRa-Projekt",
          "count": 1
        },
        {
          "name": "senatsverwaltung-fur-stadtentwicklung-und-umwelt",
          "display_name": "Senatsverwaltung für Umwelt, Mobilität, Verbraucher- und Klimaschutz",
          "count": 2
        },
        {
          "name": "harvester-fis-broker",
          "display_name": "Harvester FIS Broker",
          "count": 10
        },
        {
          "name": "adfc",
          "display_name": "ADFC",
          "count": 1
        }
      ]
    },
    "groups": {
      "title": "groups",
      "items": [
        {
          "name": "verkehr",
          "display_name": "Verkehr",
          "count": 3
        },
        {
          "name": "geo",
          "display_name": "Geographie und Stadtplanung",
          "count": 11
        }
      ]
    }
  }
};

export const BERLIN_CSV_RADVERKEHR = {
  "count": 2,
  "sort": "metadata_modified desc",
  "results": [
    {
      "id": "8974af43-7302-4c85-831b-5359f9b9fbf5",
      "name": "berlin-zaehlt-mobilitaet",
      "title": "Berlin zählt Mobilität",
      "type": "dataset",
      "notes": "Im Rahmen des Gemeinschaftsprojektes [Berlin zählt Mobilität](https://berlin.adfc.de/artikel/berlin-zaehlt-mobilitaet-adfc-berlin-dlr-rufen-zu-citizen-science-projekt-auf-1/) des [ADFC Berlin](https://berlin.adfc.de/) und des [DLR](https://www.dlr.de/de/das-dlr/standorte-und-bueros/berlin) erfassen…",
      "url": "https://berlin-zaehlt.de/",
      "num_resources": 2,
      "license_id": "cc-by/4.0",
      "license_title": "Creative Commons Attribution 4.0",
      "metadata_created": "2023-12-10T12:40:34.856727",
      "metadata_modified": "2026-04-21T13:24:47.000135",
      "author": "ADFC Berlin",
      "maintainer": "Roland Rutz",
      "organization": {
        "name": "adfc",
        "title": "ADFC"
      },
      "groups": [
        {
          "name": "verkehr",
          "title": "Verkehr",
          "display_name": "Verkehr"
        }
      ],
      "tags": [
        {
          "name": "Autos"
        },
        {
          "name": "Autoverkehr"
        },
        {
          "name": "Fahrräder"
        },
        {
          "name": "Fußgänger"
        },
        {
          "name": "LKW"
        }
      ],
      "extras": [],
      "resources": [
        {
          "id": "410b008b-a077-4382-92eb-2e504baf93f2",
          "name": "ADFC Berlin Zähldaten Download",
          "format": "CSV",
          "url": "https://berlin-zaehlt.de/csv/"
        },
        {
          "id": "ca4c1149-dfa5-474e-8622-c9ee13a6b74d",
          "name": "Telraam API zur Abfrage der Zähldaten ",
          "format": "JSON",
          "url": "https://documenter.getpostman.com/view/8210376/TWDRqyaV"
        }
      ]
    },
    {
      "id": "4cfa7a41-f776-4a18-87ed-73456285a4e5",
      "name": "simra",
      "title": "Fahrten und Gefahrensituationen im Radverkehr aus Projekt SimRa seit 2019",
      "type": "dataset",
      "notes": "Das Datenset enthält die Rohdaten, der in Berlin seit Juni 2019 mit der SimRa-App aufgezeichneten Fahrradfahrten. Konkret enthalten sind:\r\n1. Aufgezeichnete Fahrten. Enthält: GPS-Trace, Sensortrace der Bewegungssensoren, annotierte Gefahrensituationen (sofern aufgetreten), Metainformationen zur rad…",
      "url": "https://simra-project.github.io/",
      "num_resources": 2,
      "license_id": "other-closed",
      "license_title": "Siehe Website des Datensatzes",
      "metadata_created": "2024-07-04T14:50:33.406858",
      "metadata_modified": "2024-07-04T14:56:30.811366",
      "author": "TU Berlin, Fachgebiet Skalierbare Softwaresysteme",
      "maintainer": "David Bermbach",
      "organization": {
        "name": "simra-projekt",
        "title": "SimRa-Projekt"
      },
      "groups": [
        {
          "name": "verkehr",
          "title": "Verkehr",
          "display_name": "Verkehr"
        }
      ],
      "tags": [
        {
          "name": "Fahrrad"
        },
        {
          "name": "Fahrten"
        },
        {
          "name": "Gefahren"
        }
      ],
      "extras": [],
      "resources": [
        {
          "id": "b12ed38f-f960-46fb-b965-4e1d1138728b",
          "name": "SimRa-Rohdaten Berlin",
          "format": "CSV",
          "url": "https://github.com/simra-project/dataset/"
        },
        {
          "id": "8dc73f9e-2672-4f8c-992f-ac072549b78a",
          "name": "Gefahrenkarten (alle SimRa-Regionen)",
          "format": "CSV",
          "url": "https://simra-project.github.io/dashboard/"
        }
      ]
    }
  ]
};

export const NRW_RADVERKEHR = {
  "count": 105,
  "sort": "score desc, metadata_modified desc",
  "results": [
    {
      "id": "f633d60b-ff28-4e66-9154-b448a9e90f85",
      "name": "bochum-radverkehr-erzbahntrasse-rvr",
      "title": "Bochum - Radverkehr - Erzbahntrasse",
      "type": "dataset",
      "notes": "Radverkehr-Zählstelle (Eco-Counter) an der Erzbahntrasse in Bochum.",
      "url": "https://data.eco-counter.com/ParcPublic/?id=6603",
      "num_resources": 1,
      "license_id": "http://dcat-ap.de/def/licenses/cc-zero/1.0",
      "license_title": "http://dcat-ap.de/def/licenses/cc-zero/1.0",
      "metadata_created": "2026-09-18T00:49:54.611774",
      "metadata_modified": "2026-11-19T01:47:56.538847",
      "author": "Stabsstelle Digitalisierung",
      "maintainer": "Nahmobilität",
      "organization": {
        "name": "rvr",
        "title": "RVR"
      },
      "groups": [],
      "tags": [
        {
          "name": "Bochum"
        },
        {
          "name": "Eco-Counter"
        },
        {
          "name": "Fahrradverkehr"
        },
        {
          "name": "Mobilität"
        },
        {
          "name": "Radverkehr"
        }
      ],
      "extras": [
        {
          "key": "issued",
          "value": "2025-04-28T15:01:49.696656"
        },
        {
          "key": "metadata_harvested_portal",
          "value": "https://opendata.ruhr/"
        },
        {
          "key": "metadata_original_html",
          "value": "https://data.eco-counter.com/ParcPublic/?id=6603"
        },
        {
          "key": "metadata_original_portal",
          "value": "https://opendata.ruhr"
        },
        {
          "key": "modified",
          "value": "2026-06-09T10:25:54.774458"
        },
        {
          "key": "opennrw_datapublisher",
          "value": "Bochum"
        }
      ],
      "resources": [
        {
          "id": "d983145e-0c06-4ae5-af30-0b7f37e4414a",
          "name": "bochum_ecocounter_erzbahntrasse.csv",
          "format": "CSV",
          "url": "https://gitlab.opencode.de/StadtBochum/open-data/radverkehr-zaehlstellen-eco-counter/-/raw/main/data/brueckstrasse/bochum_ecocounter_erzbahntrasse.csv?ref_type=heads",
          "license": "http://dcat-ap.de/def/licenses/cc-zero/1.0"
        }
      ]
    },
    {
      "id": "1e2c6d67-a5ed-4ab3-894b-f8f0a9cb94a4",
      "name": "bochum-radverkehr-universitatsstrasse-rvr",
      "title": "Bochum - Radverkehr - Universitätsstraße",
      "type": "dataset",
      "notes": "Radverkehr-Zählstelle an der Universitätsstraße in Bochum. Weitere Informationen sowie Visualisierungen sind auf der Seite des Dienstleisters [Eco-Counter](https://data.eco-counter.com/ParcPublic/?id=6603) zu finden. Zusätzlich ist das [openCode.de Dashboard](https://stadtbochum.usercontent.opencod…",
      "url": "https://data.eco-counter.com/ParcPublic/?id=6603",
      "num_resources": 1,
      "license_id": "http://dcat-ap.de/def/licenses/other-closed",
      "license_title": "Andere geschlossene Lizenz",
      "metadata_created": "2026-09-18T00:44:39.714326",
      "metadata_modified": "2026-11-19T01:44:18.510786",
      "author": "Stabsstelle Digitalisierung",
      "maintainer": "Stabsstelle Digitalisierung",
      "organization": {
        "name": "rvr",
        "title": "RVR"
      },
      "groups": [],
      "tags": [
        {
          "name": "Bochum"
        },
        {
          "name": "Eco-Counter"
        },
        {
          "name": "Fahrradverkehr"
        },
        {
          "name": "Mobilität"
        },
        {
          "name": "Rad"
        }
      ],
      "extras": [
        {
          "key": "issued",
          "value": "2025-04-28T15:01:09.270299"
        },
        {
          "key": "metadata_harvested_portal",
          "value": "https://opendata.ruhr/"
        },
        {
          "key": "metadata_original_html",
          "value": "https://data.eco-counter.com/ParcPublic/?id=6603"
        },
        {
          "key": "metadata_original_portal",
          "value": "https://opendata.ruhr"
        },
        {
          "key": "modified",
          "value": "2026-11-18T03:21:05.616769"
        },
        {
          "key": "opennrw_datapublisher",
          "value": "Bochum"
        },
        {
          "key": "temporal_start",
          "value": "2024-01-01"
        }
      ],
      "resources": [
        {
          "id": "c0f1bf4d-2b3b-4519-b2c3-95dc91c4524e",
          "name": "bochum_ecocounter_universitaetsstrasse.csv",
          "format": "CSV",
          "url": "https://gitlab.opencode.de/StadtBochum/open-data/radverkehr-zaehlstellen-eco-counter/-/raw/main/data/universitaetsstrasse/bochum_ecocounter_universitaetsstrasse.csv",
          "license": "http://dcat-ap.de/def/licenses/other-closed"
        }
      ]
    },
    {
      "id": "f391f881-b033-4ec1-9367-4bfc2e4a9657",
      "name": "bochum-radverkehr-bruckstrasse-rvr",
      "title": "Bochum - Radverkehr - Brückstraße",
      "type": "dataset",
      "notes": "Radverkehr-Zählstelle an der Brückstraße in Bochum. Weitere Informationen sowie Visualisierungen sind auf der Seite des Dienstleisters [Eco-Counter](https://data.eco-counter.com/ParcPublic/?id=6603) zu finden. Zusätzlich ist das [openCode.de Dashboard](https://stadtbochum.usercontent.opencode.de/op…",
      "url": "https://data.eco-counter.com/ParcPublic/?id=6603",
      "num_resources": 1,
      "license_id": "http://dcat-ap.de/def/licenses/other-closed",
      "license_title": "Andere geschlossene Lizenz",
      "metadata_created": "2026-09-18T00:44:38.514648",
      "metadata_modified": "2026-11-19T01:44:17.678325",
      "author": "Stabsstelle Digitalisierung",
      "maintainer": "Stabsstelle Digitalisierung",
      "organization": {
        "name": "rvr",
        "title": "RVR"
      },
      "groups": [],
      "tags": [
        {
          "name": "Bochum"
        },
        {
          "name": "Eco-Counter"
        },
        {
          "name": "Fahrradverkehr"
        },
        {
          "name": "Mobilität"
        },
        {
          "name": "Rad"
        }
      ],
      "extras": [
        {
          "key": "issued",
          "value": "2025-04-28T15:01:13.531837"
        },
        {
          "key": "metadata_harvested_portal",
          "value": "https://opendata.ruhr/"
        },
        {
          "key": "metadata_original_html",
          "value": "https://data.eco-counter.com/ParcPublic/?id=6603"
        },
        {
          "key": "metadata_original_portal",
          "value": "https://opendata.ruhr"
        },
        {
          "key": "modified",
          "value": "2026-11-18T03:21:06.574012"
        },
        {
          "key": "opennrw_datapublisher",
          "value": "Bochum"
        },
        {
          "key": "temporal_start",
          "value": "2024-01-01"
        }
      ],
      "resources": [
        {
          "id": "de1e97e8-8f55-4ba1-8bd1-771eeb58b7ca",
          "name": "bochum_ecocounter_brueckstrasse.csv",
          "format": "CSV",
          "url": "https://gitlab.opencode.de/StadtBochum/open-data/radverkehr-zaehlstellen-eco-counter/-/raw/main/data/brueckstrasse/bochum_ecocounter_brueckstrasse.csv",
          "license": "http://dcat-ap.de/def/licenses/other-closed"
        }
      ]
    }
  ]
};

export const GOVDATA_RADVERKEHR_COUNT = 266;

export const NOT_FOUND = {
  "help": "http://suche.transparenz.hamburg.de/api/3/action/help_show?name=package_show",
  "error": {
    "__type": "Not Found Error",
    "message": "Not found"
  },
  "success": false
};

export const SEARCH_SERVER_DOWN = {
  "help": "http://suche.transparenz.hamburg.de/api/3/action/help_show?name=package_search",
  "error": {
    "__type": "Search Connection Error",
    "message": "Unable to connect to the search server"
  },
  "success": false
};

/** A recorded dataset, as far as the mock reads it. */
interface Dataset {
  type?: string;
  num_resources?: number;
  organization: { name: string } | null;
  groups: { name: string }[];
  tags: { name: string }[];
  resources: { format?: string }[];
}

/** A CKAN success envelope. */
const ok = (result: unknown): HttpResponse => jsonResponse({ help: "https://example.org/api/3/action/help_show?name=package_search", success: true, result });

/** The spellings of a format in a `res_format:("A" OR "B")` filter, or undefined for another filter. */
function formatsIn(filter: string): string[] | undefined {
  const match = /^res_format:\((.*)\)$/.exec(filter);
  if (match === null) return undefined;
  return [...(match[1] as string).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] as string).replace(/\\(.)/g, "$1"));
}

/** Whether a recorded dataset passes one filter (those the operations send; a date range passes). */
function passes(dataset: Dataset, filter: string): boolean {
  const formats = formatsIn(filter);
  // Solr indexes res_format as sent; Hamburg's index lower-cases it (its facet says pdf, its files PDF).
  if (formats !== undefined) return dataset.resources.some((r) => r.format !== undefined && formats.includes(r.format));
  if (filter === "num_resources:[1 TO *]") return (dataset.num_resources ?? 0) >= 1;
  const organization = /^organization:"?([^"]*)"?$/.exec(filter);
  if (organization !== null) return dataset.organization?.name === organization[1];
  const group = /^groups:"(.*)"$/.exec(filter);
  if (group !== null) return dataset.groups.some((g) => g.name === group[1]);
  const type = /^type:(\w+)$/.exec(filter);
  if (type !== null) return dataset.type === type[1];
  const tag = /^tags:"(.*)"$/.exec(filter);
  if (tag !== null) return dataset.tags.some((t) => t.name === tag[1]);
  return true;
}

type Facets = Record<string, { title: string; items: { name: string; display_name: string; count: number }[] }>;

/** A recorded search on one host: its datasets for a q and type filter, or a count with facets. */
interface Recorded {
  count: number;
  results?: Dataset[];
  facets?: Facets;
}

/** What was recorded on `host` for `q` and the document-type filter in `fq`, if anything. */
function recordedFor(host: string, q: string | null, fq: string[]): Recorded | undefined {
  const typeFilter = fq.find((f) => f.startsWith("extras_registerobject_type:"));
  if (host === "suche.transparenz.hamburg.de") {
    if (typeFilter === "extras_registerobject_type:gutacht") return q === "Radverkehr" ? (HAMBURG_GUTACHTEN_RADVERKEHR as unknown as Recorded) : undefined;
    if (typeFilter === "extras_registerobject_type:vertrageoffinteress") return q === null ? (HAMBURG_CONTRACTS as unknown as Recorded) : undefined;
    if (typeFilter !== undefined) return undefined;
    if (q === "Radverkehr") return HAMBURG_RADVERKEHR as unknown as Recorded;
    if (q === null) return { count: HAMBURG_FACETS.count, facets: HAMBURG_FACETS.search_facets };
  }
  if (host === "datenregister.berlin.de" && q === "Radverkehr") return { count: BERLIN_FACETS_RADVERKEHR.count, results: BERLIN_CSV_RADVERKEHR.results as unknown as Dataset[], facets: BERLIN_FACETS_RADVERKEHR.search_facets };
  if (host === "open.nrw" && q === "Radverkehr") return NRW_RADVERKEHR as unknown as Recorded;
  if (host === "ckan.govdata.de" && q === "Radverkehr") return { count: GOVDATA_RADVERKEHR_COUNT };
  return undefined;
}

/** CKAN's answer to package_search, from the recorded searches and facets. */
function packageSearch(url: URL): HttpResponse {
  const q = url.searchParams.get("q");
  const fq = [...url.searchParams.getAll("fq"), ...new Set(url.searchParams.getAll("fq_list"))];
  const rows = Number(url.searchParams.get("rows") ?? "10");
  const start = Number(url.searchParams.get("start") ?? "0");
  const fields = JSON.parse(url.searchParams.get("facet.field") ?? "[]") as string[];
  const limit = Number(url.searchParams.get("facet.limit") ?? "50");
  const recorded = recordedFor(url.host, q, fq);
  const others = fq.filter((f) => !f.startsWith("extras_registerobject_type:"));
  let count = recorded?.count ?? 0;
  let results: Dataset[] = [];
  if (recorded?.results !== undefined) {
    const matching = recorded.results.filter((d) => others.every((f) => passes(d, f)));
    if (others.length > 0) count = matching.length;
    results = matching.slice(start, start + rows);
  } else if (others.length > 0) {
    count = 0;
  }
  const facets = count === 0 || others.length > 0 ? {} : (recorded?.facets ?? {});
  const searchFacets = Object.fromEntries(
    fields.map((field) => {
      const items = facets[field]?.items ?? [];
      // Solr keeps the facet.limit values with the most datasets; CKAN then lists them unsorted.
      return [field, { title: field, items: limit === -1 ? items : [...items].sort((a, b) => b.count - a.count).slice(0, limit).reverse() }];
    }),
  );
  return ok({ count, results, sort: "score desc, metadata_modified desc", search_facets: searchFacets });
}

/** The APIs' answer to `request`, from the recorded ones. */
export function ckanAnswer(request: HttpRequest): HttpResponse {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/api/3/action/package_search")) return packageSearch(url);
  if (url.pathname.endsWith("/api/3/action/package_show")) {
    return url.host === "suche.transparenz.hamburg.de" && url.searchParams.get("id") === HAMBURG_DOCUMENT.name ? ok(HAMBURG_DOCUMENT) : jsonResponse(NOT_FOUND, 404);
  }
  return jsonResponse(NOT_FOUND, 404);
}

/** A mock of the APIs over their own hosts and paths, answering from the recorded answers. */
export function ckanApi(): MockTransport {
  return makeMockTransport(ckanAnswer);
}
