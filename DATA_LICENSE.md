# Data license

> **This tool does not include, host, or redistribute any data.**
> `ckan-cli` is a *client*. It only accesses records served live by whichever
> CKAN portal you point it at. Those records are governed by **that portal's**
> terms, and often by a licence set per dataset. The license of this CLI's own
> source code is a separate matter — see [LICENSING.md](LICENSING.md).

> [!IMPORTANT]
> **The terms depend on the portal and usually on the record.** A generic CKAN
> client cannot know them in advance. Every CKAN record carries its own
> `license_id` / `license_title` / `license_url`; check them before reusing a
> record's contents. `ckan licenses` lists the licences a portal offers, and
> `ckan search --rows 0 --facet license_id` shows how often each is used.

## Default portal: Transparenzportal Hamburg

| | |
|---|---|
| **Data provider** | Freie und Hansestadt Hamburg; each record is the responsibility of its publishing body |
| **API / source** | `https://suche.transparenz.hamburg.de/api/3/action` (CKAN Action API) · portal: https://transparenz.hamburg.de/ |
| **Legal basis** | Hamburgisches Transparenzgesetz (HmbTG), § 10 Abs. 3: *"Die Nutzung, Weiterverwendung und Verbreitung der Informationen ist frei, sofern höherrangiges Recht oder spezialgesetzliche Regelungen nichts anderes bestimmen."* |
| **Portal statement** | *"Die Dokumente und Daten aus dem Transparenzportal Hamburg dürfen frei verwendet werden."* Records are published under two licences that allow free reuse, *"ggf. unter Nennung des Namens"*: Datenlizenz Deutschland – Namensnennung 2.0 and – Zero 2.0. |
| **Licence** | **Per record**, in `license_id`. As of 2026-09-19: `dl-de-by-2.0` (242,632 records), `cc-zero` (2,203), `dl-zero-de-2.0` / `dl-de-zero-2.0` (262), `odbl` (59), `geoNutz-20130319` (48). |
| **Attribution** | Per record, in the `terms_of_use` extra (`attribution_text`), e.g. *"Namensnennung: Freie und Hansestadt Hamburg, Bezirksversammlung Wandsbek"*. The wording names the publishing body, so it varies. |
| **Metadata** | Not licensed separately by the portal. |
| **Automated access** | Invited: the API page describes it as the way to fetch *"Inhalte und Metadaten aus dem Transparenzportal automatisiert"*. No rate limits or API terms are published; HmbTG § 10 Abs. 4 makes access *"kostenlos und anonym"*. |

### Watch for

- **`dl-de-by-2.0`** (the vast majority) requires attribution. Use the record's
  own `attribution_text`, and link the licence
  (https://www.govdata.de/dl-de/by-2-0).
- **`odbl`** records are share-alike: derived databases must stay under the ODbL.
- **`geoNutz-20130319`** is Hamburg's older geodata usage licence, not a
  standard open licence. Read its terms before reusing those records.
- **Third-party rights.** HmbTG § 10 Abs. 3 S. 3 only obliges authorities to
  *try* to obtain reuse rights for third-party works (reports, studies), and
  § 8 Abs. 1 lets intellectual-property protection override publication. A
  document written by a third party can carry rights the record's licence does
  not grant.
- **Personal data** is redacted before publication (HmbTG § 4), but some names
  are published on purpose (contract partners, authors of reports, subsidy
  recipients). Data-protection law still applies to what you do with them.
- **The website itself** (layout, graphics, editorial pages) is copyright
  protected per the Impressum; that concerns transparenz.hamburg.de, not the
  register records served by the API.

### Attribution

```
Source: Transparenzportal Hamburg (https://transparenz.hamburg.de/),
<attribution_text of the record>, licensed under <license_title of the record>
(<license_url of the record>).
```

## Other portals

With `--portal`, `--base-url` or `CKAN_BASE_URL` you are subject to that portal's
terms. Being in the built-in list (`ckan portals`) says only that a portal runs a
working CKAN, nothing about its terms.
Look them up on the portal itself; do not assume they match Hamburg's. For
GovData, see the `DATA_LICENSE.md` of
[govdata-cli](https://github.com/maschinenlesbar-org/govdata-cli).

## Sources

- https://transparenz.hamburg.de/verwendung-der-daten-aus-dem-transparenzportal-796520 — free use, the two licences
- https://transparenz.hamburg.de/api-796358 — API notes, automated access
- https://transparenz.hamburg.de/gesetzestext-des-hmbtg-796514 — HmbTG §§ 4, 7, 8, 10
- https://transparenz.hamburg.de/impressum-796468 — responsibility per publishing body, website copyright
- https://www.govdata.de/dl-de/by-2-0 — Datenlizenz Deutschland – Namensnennung – 2.0
- Record counts: `ckan search --rows 0 --facet license_id` against the live API, 2026-09-19

---

*Good-faith summary compiled 2026-09-19; not legal advice. The portal's terms
and each record's licence are authoritative and can change.*
