// The use cases (operations.ts) against the recorded answers (ckan.ts), with the skills' traps as
// cases: every portal spells formats and licences its own way (CSV, csv, the EU URI; dl-de-by-2.0,
// dl-by-de/2.0, the DCAT-AP.de URI), so a filter must OR the spellings and a count must fold them;
// facet values unsorted and cut at CKAN's limit without a sign; GovData harvests the others, so it
// is never added to a sum; a portal that fails is not "no data"; Hamburg's document types work
// only in their stemmed form, its records often lack an organization, its licence and attribution
// are per record; links that are services or landing pages; metadata-only records; a portal is an
// id of the list, never a URL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CkanClient } from "../src/client.js";
import { CkanApiError, CkanValidationError } from "../src/errors.js";
import {
  comparePortals,
  countDatasets,
  datasetIdFrom,
  documentType,
  findDatasets,
  findHamburgDocuments,
  formatFilter,
  formatOf,
  getDataset,
  licenceOf,
  linkKind,
  listOrganizations,
  portalById,
  requestsOf,
} from "../src/operations.js";
import { PORTALS } from "../src/portals-list.js";
import type { HttpRequest } from "../src/http.js";
import { ckanAnswer, ckanApi, SEARCH_SERVER_DOWN } from "./ckan.js";
import { jsonResponse, makeMockTransport } from "./helpers.js";

const clientOf = (mock: ReturnType<typeof ckanApi>, baseUrl?: string) => new CkanClient({ transport: mock.transport, maxRetries: 0, ...(baseUrl === undefined ? {} : { baseUrl }) });
const params = (request: HttpRequest | undefined) => new URL(request?.url ?? "http://x/").searchParams;
const fqOf = (request: HttpRequest | undefined) => [...params(request).getAll("fq"), ...params(request).getAll("fq_list")];
const EU = "http://publications.europa.eu/resource/authority/file-type/";

// ---- formats, licences, links, document types ----------------------------------------------------

test("a format value becomes one short name whatever the portal's spelling: csv and CSV, the EU URI, _SRVC, Shapefiles", () => {
  assert.equal(formatOf("csv"), "CSV", "Hamburg and part of Berlin write it lower case");
  assert.equal(formatOf("CSV"), "CSV");
  assert.equal(formatOf(`${EU}CSV`), "CSV", "GovData and daten.bw write the EU URI");
  assert.equal(formatOf(`${EU}WMS_SRVC`), "WMS");
  assert.equal(formatOf("shapefiles"), "SHP", "Hamburg's facet value");
  assert.equal(formatOf("Shape"), "SHP");
  assert.equal(formatOf("text/csv"), "CSV");
  assert.equal(formatOf("GML+XML"), "GML", "Open.NRW (seen live, 2026-11-20)");
  assert.equal(formatOf("gezippte Shapedatei"), "SHP", "Open.NRW (seen live, 2026-11-20)");
  assert.equal(formatOf("web"), undefined, "Hamburg's 'web' names no format");
  assert.equal(formatOf("Shape, CSV"), undefined);
  assert.equal(formatOf(null), undefined);
});

test("a format filter ORs every spelling: Berlin's filter is case-sensitive and holds CSV and csv apart, GovData's the EU URI", () => {
  const filter = formatFilter("CSV");
  for (const spelling of ['"CSV"', '"csv"', `"${EU}CSV"`, '"text/csv"']) assert.ok(filter.includes(spelling), spelling);
  assert.ok(formatFilter("SHP").includes('"shapefiles"'), "Hamburg's lower-case shapefiles");
  assert.ok(formatFilter("SHP").includes('"GEZIPPTE SHAPEDATEI"'), "Open.NRW's capitals");
  assert.ok(formatFilter("WMS").includes(`"${EU}WMS_SRVC"`));
});

test("one licence under every portal's spelling gets one label; other-closed is not open; an unknown one keeps the portal's title", () => {
  for (const id of ["dl-de-by-2.0", "dl-by-de/2.0", "http://dcat-ap.de/def/licenses/dl-by-de/2.0", "http://dcat-ap.de/def/licenses/dl-by-de/2_0"]) {
    assert.deepEqual(licenceOf(id), { id, label: "DL-DE BY 2.0", open: true }, id);
  }
  for (const id of ["dl-de-zero-2.0", "dl-zero-de-2.0", "http://dcat-ap.de/def/licenses/dl-zero-de/2.0"]) assert.equal(licenceOf(id)?.label, "DL-DE Zero 2.0", id);
  for (const id of ["cc-zero", "http://dcat-ap.de/def/licenses/cc-zero/1.0"]) assert.equal(licenceOf(id)?.label, "CC0 1.0", id);
  assert.equal(licenceOf("cc-by/4.0")?.label, "CC BY 4.0", "Berlin");
  assert.equal(licenceOf("CC-BY-4.0")?.label, "CC BY 4.0");
  assert.equal(licenceOf("geoNutz-20130319")?.label, "GeoNutzV (Geodaten des Bundes)", "Hamburg's older geodata terms");
  assert.equal(licenceOf("odbl")?.label, "ODbL");
  assert.equal(licenceOf("http://dcat-ap.de/def/licenses/other-closed")?.open, false, "NRW: not open");
  assert.equal(licenceOf("other-closed", "Siehe Website des Datensatzes")?.open, false);
  assert.deepEqual(licenceOf("hausrecht-7", "Nutzung nur nach Absprache"), { id: "hausrecht-7", label: "Nutzung nur nach Absprache" }, "unknown: the portal's title, open not claimed");
  assert.equal(licenceOf(""), undefined);
});

test("a link's kind: a WMS GetCapabilities is a service, a metaver page and a URL ending in / are pages, Hamburg's GetRessource PDFs are files", () => {
  assert.equal(linkKind("https://geodienste.hamburg.de/wms_magistralen?SERVICE=WMS&REQUEST=GetCapabilities", "WMS"), "service");
  assert.equal(linkKind("http://metaver.de/trefferanzeige?docuuid=af24ce81-bfc1-4fca-8cef-a9fd55123bd2", "HTML"), "page", "labelled HTML: a page, whatever its query");
  assert.equal(linkKind("https://berlin-zaehlt.de/csv/", "CSV"), "page", "labelled CSV, but a landing page");
  assert.equal(linkKind("https://daten.transparenz.hamburg.de/Dataport.HmbTG.ZS.Webservice.GetRessource100/GetRessource100.svc/2ee58073-be63-4840-8420-6c7715297dac/Upload__X.PDF", "PDF"), "file");
});

test("Hamburg's document type is found from its stemmed value, its German name, the stored and the published value; a word that fits two is refused", () => {
  assert.equal(documentType("gutacht"), "gutacht");
  assert.equal(documentType("Gutachten"), "gutacht");
  assert.equal(documentType("Verträge von öffentlichem Interesse"), "vertrageoffinteress");
  assert.equal(documentType("vertraegeoeffinteresse"), "vertrageoffinteress", "the stored value");
  assert.equal(documentType("vertraege_oeff_interesse"), "vertrageoffinteress", "the published value, which finds nothing");
  assert.equal(documentType("verwaltungsvorschriften"), "verwaltungsvorschrift", "the full word over-matches the Dienstanweisungen: sent stemmed");
  assert.equal(documentType("Senatspetita"), "senatpetitum");
  assert.equal(documentType("verwaltung"), undefined, "Verwaltungsvorschriften or Verwaltungsbelange: not guessed");
  assert.equal(documentType("Rechnungen"), undefined);
});

test("a portal is an id of the built-in list, never a URL", () => {
  assert.equal(portalById(" Berlin ").url, "https://datenregister.berlin.de");
  assert.throws(() => portalById("https://datenregister.berlin.de"), CkanValidationError);
  assert.throws(() => portalById("http://169.254.169.254"), /not an id of the built-in list/);
});

test("a dataset id from a page link", () => {
  assert.equal(datasetIdFrom("https://suche.transparenz.hamburg.de/dataset/potentialermittlung-radverkehr?forceWeb=true"), "potentialermittlung-radverkehr");
  assert.equal(datasetIdFrom(" simra "), "simra");
});

// ---- findDatasets --------------------------------------------------------------------------------

test("findDatasets on the client's own portal (Hamburg): hits with formats folded, the record's licence, its attribution text, and the request as sent", async () => {
  const mock = ckanApi();
  const answer = await findDatasets(clientOf(mock), { query: "Radverkehr", limit: 4 });
  assert.equal(answer.status, "ok");
  assert.equal(answer.total, 3753);
  assert.equal(answer.nextOffset, 4);
  assert.deepEqual(answer.portal, { id: "hamburg", title: PORTALS.find((p) => p.id === "hamburg")?.title, url: "https://suche.transparenz.hamburg.de" });
  const kbq = answer.datasets.find((d) => d.name === "kbq-verkehrstechnische-untersuchung-radverkehr");
  assert.deepEqual(kbq?.licences, [{ id: "cc-zero", label: "CC0 1.0", open: true }]);
  assert.equal(kbq?.attribution, "Namensnennung: Freie und Hansestadt Hamburg");
  assert.equal(kbq?.type, "document");
  const winter = answer.datasets.find((d) => d.name === "winterdienst-fur-den-radverkehr-durch-srh-hamburg2");
  assert.equal(winter?.organization, undefined, "Hamburg records often have no organization");
  assert.equal(winter?.author, "Stadtreinigung Hamburg");
  assert.deepEqual(winter?.formats, ["GML", "XSD", "XML", "HTML"]);
  assert.deepEqual(requestsOf(answer), ["package_search?q=Radverkehr&rows=4&start=0"]);
});

test("findDatasets on another portal of the list: the request goes to its host, the source is absolute; a CSV filter ORs CSV and csv (Berlin is case-sensitive)", async () => {
  const mock = ckanApi();
  const answer = await findDatasets(clientOf(mock), { portal: "berlin", query: "Radverkehr", format: "csv", sort: "modified", limit: 3 });
  assert.equal(new URL(mock.last().url).host, "datenregister.berlin.de");
  assert.ok(fqOf(mock.last())[0]?.includes('"csv"'));
  assert.equal(answer.total, 2);
  assert.equal(answer.searched["format"], "CSV");
  assert.ok(answer.datasets.every((d) => d.hasFormat === true));
  const simra = answer.datasets.find((d) => d.name === "simra");
  assert.equal(simra?.licences[0]?.open, false, "other-closed: not open");
  assert.ok(answer.notes.some((n) => n.includes("not open")));
  assert.ok(requestsOf(answer)[0]?.startsWith("https://datenregister.berlin.de/api/3/action/package_search?"), requestsOf(answer)[0]);
});

test("findDatasets on NRW: the dataset's licence and its file's are one when they agree (cc-zero and its DCAT-AP.de URI)", async () => {
  const answer = await findDatasets(clientOf(ckanApi()), { portal: "nrw", query: "Radverkehr", limit: 3 });
  const erzbahn = answer.datasets.find((d) => d.name === "bochum-radverkehr-erzbahntrasse-rvr");
  assert.deepEqual(erzbahn?.licences.map((l) => l.label), ["CC0 1.0"]);
  assert.ok(answer.datasets.filter((d) => d.licences.some((l) => l.open === false)).length >= 2);
});

test("an organization by name is resolved against the portal's list (one facet request); a name that fits several is ambiguous, an unknown one empty", async () => {
  const mock = ckanApi();
  const found = await findDatasets(clientOf(mock), { query: "Radverkehr", organization: "Workflows" });
  assert.equal(found.searched["organization"], "workflows");
  assert.ok(fqOf(mock.last()).includes('organization:"workflows"'));
  assert.equal(found.total, 3);
  assert.equal(requestsOf(found).length, 2);
  const unknown = await findDatasets(clientOf(ckanApi()), { query: "Radverkehr", organization: "Bezirksamt Wandsbek" });
  assert.equal(unknown.status, "empty");
  assert.match(unknown.reason ?? "", /author or maintainer/);
  const several = await findDatasets(clientOf(ckanApi()), { query: "Radverkehr", organization: "s" });
  assert.equal(several.status, "ambiguous");
  assert.ok((several.ambiguous?.candidates.length ?? 0) > 1);
});

test("a group by its title, the record type and a date range go out as filters", async () => {
  const mock = ckanApi();
  await findDatasets(clientOf(mock), { query: "Radverkehr", group: "Transport & Verkehr", type: "dataset", from: "2026-09-01", to: "2026-09-30" });
  const fq = fqOf(mock.last());
  assert.ok(fq.includes('groups:"transport-und-verkehr"'), fq.join(" | "));
  assert.ok(fq.includes("type:dataset"));
  assert.ok(fq.includes("metadata_created:[2026-09-01T00:00:00Z TO 2026-10-01T00:00:00Z}"), "to includes its whole day");
});

test("findDatasets checks its arguments before any request: a URL as portal, a bad day, a format that is no format", async () => {
  const mock = ckanApi();
  const client = clientOf(mock);
  await assert.rejects(findDatasets(client, { portal: "https://evil.example", query: "x" }), CkanValidationError);
  await assert.rejects(findDatasets(client, { query: "x", from: "2026-02-30" }), /YYYY-MM-DD/);
  await assert.rejects(findDatasets(client, { query: "x", from: "2026-03-01", to: "2026-02-01" }), /after/);
  await assert.rejects(findDatasets(client, { query: "x", format: "Shape, CSV" }), /format name/);
  await assert.rejects(findDatasets(client, { query: "x", limit: 51 }), /from 1 to 50/);
  assert.equal(mock.calls.length, 0);
});

test("an empty search says so and what to try; a page past the end says how many match", async () => {
  const none = await findDatasets(clientOf(ckanApi()), { query: "Zeppelinlandeplatz" });
  assert.equal(none.status, "empty");
  assert.match(none.reason ?? "", /comparePortals/);
  const past = await findDatasets(clientOf(ckanApi()), { query: "Radverkehr", offset: 100 });
  assert.equal(past.status, "empty");
  assert.match(past.reason ?? "", /past the end: 3753/);
});

// ---- comparePortals ------------------------------------------------------------------------------

test("comparePortals counts every portal of the list, most first; GovData is marked national and never summed; a failing portal is listed with its problem", async () => {
  const mock = makeMockTransport((request) => (new URL(request.url).host === "opendata.hessen.de" ? jsonResponse(SEARCH_SERVER_DOWN, 500) : ckanAnswer(request)));
  const answer = await comparePortals(new CkanClient({ transport: mock.transport, maxRetries: 0 }), { query: "Radverkehr" });
  assert.equal(mock.calls.length, PORTALS.length);
  assert.ok(mock.calls.every((c) => params(c).get("rows") === "0"), "counts only");
  assert.deepEqual(answer.portals.slice(0, 4).map((p) => [p.id, p.count]), [["hamburg", 3753], ["govdata", 266], ["nrw", 105], ["berlin", 14]]);
  assert.equal(answer.portals.find((p) => p.id === "govdata")?.national, true);
  assert.equal(answer.withMatches, 4);
  const hessen = answer.portals.find((p) => p.id === "hessen");
  assert.equal(hessen?.count, undefined);
  assert.equal(hessen?.problem, "HTTP 500");
  assert.ok(answer.notes.some((n) => n.includes("never add it to a sum")));
  assert.ok(answer.notes.some((n) => n.includes("never read a failure as no data")));
  const requests = requestsOf(answer);
  assert.equal(requests.length, PORTALS.length);
  assert.ok(requests.includes("package_search?q=Radverkehr&rows=0"), "the client's own portal relative");
  assert.ok(requests.includes("https://open.nrw/api/3/action/package_search?q=Radverkehr&rows=0"));
});

test("comparePortals over the named portals only, with a format in all its spellings", async () => {
  const mock = ckanApi();
  const answer = await comparePortals(clientOf(mock), { query: "Radverkehr", format: "CSV", portals: ["berlin", "nrw", "berlin"] });
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(answer.searched["portals"], ["berlin", "nrw"]);
  assert.equal(answer.portals.find((p) => p.id === "berlin")?.count, 2);
  await assert.rejects(comparePortals(clientOf(mock), { portals: ["atlantis"] }), CkanValidationError);
});

// ---- countDatasets -------------------------------------------------------------------------------

test("countDatasets on Hamburg: document types labelled, licences folded (dl-zero-de-2.0 and dl-de-zero-2.0 are one, an upper bound), formats folded and sorted", async () => {
  const mock = ckanApi();
  const answer = await countDatasets(clientOf(mock), { facets: ["documentType", "licence", "format", "type"], limit: 5 });
  assert.equal(answer.total, 254249);
  const types = answer.facets.find((f) => f.facet === "documentType");
  assert.deepEqual(types?.values[0], { value: "beschluss", label: "Beschlüsse", count: 101951 });
  assert.equal(types?.complete, false);
  const licences = answer.facets.find((f) => f.facet === "licence");
  const zero = licences?.values.find((v) => v.value === "DL-DE Zero 2.0");
  assert.deepEqual(zero, { value: "DL-DE Zero 2.0", count: 268, variants: ["dl-zero-de-2.0", "dl-de-zero-2.0"], upperBound: true });
  const formats = answer.facets.find((f) => f.facet === "format");
  assert.deepEqual(formats?.values.slice(0, 2).map((v) => v.value), ["HTML", "PDF"]);
  assert.ok(formats?.other?.variants.includes("web"), "a value that names no format");
  assert.equal(params(mock.calls[0]).get("facet.limit"), "-1", "folded facets are read whole");
  assert.equal(params(mock.calls[1]).get("facet.limit"), "6", "the others at limit + 1, to tell a cut list");
  assert.ok(answer.notes.some((n) => n.includes("overlap")));
});

test("countDatasets on Berlin: the licence spellings of one portal folded, organizations with their titles", async () => {
  const answer = await countDatasets(clientOf(ckanApi()), { portal: "berlin", query: "Radverkehr", facets: ["licence", "organization"] });
  assert.equal(answer.total, 14);
  assert.deepEqual(answer.facets[0]?.values.map((v) => [v.value, v.count]), [["DL-DE Zero 2.0", 11], ["CC BY", 1], ["CC BY 4.0", 1], ["other, closed (not an open licence)", 1]]);
  assert.equal(answer.facets[1]?.values[0]?.label, "Harvester FIS Broker");
});

test("countDatasets per year: one count per year on metadata_created, the range end exclusive; years checked first", async () => {
  const mock = ckanApi();
  const answer = await countDatasets(clientOf(mock), { portal: "berlin", query: "Radverkehr", yearFrom: 2024, yearTo: 2026 });
  assert.deepEqual(answer.byYear?.map((y) => y.year), [2024, 2025, 2026]);
  assert.ok(answer.notes.some((n) => n.includes("when the record entered the portal")));
  assert.ok(fqOf(mock.calls[0]).includes("metadata_created:[2024-01-01T00:00:00Z TO 2025-01-01T00:00:00Z}"));
  await assert.rejects(countDatasets(clientOf(mock), { yearFrom: 2000, yearTo: 2030 }), /at most 20 years/);
  await assert.rejects(countDatasets(clientOf(mock), { yearFrom: 2020 }), /both/);
});

test("countDatasets without facets: the total alone", async () => {
  const answer = await countDatasets(clientOf(ckanApi()), { portal: "govdata", query: "Radverkehr" });
  assert.equal(answer.total, 266);
  assert.deepEqual(answer.facets, []);
});

// ---- findHamburgDocuments ------------------------------------------------------------------------

test("findHamburgDocuments sends the stemmed type value, newest first, and reads each document's date, types, licence, attribution and PDFs", async () => {
  const mock = ckanApi();
  const answer = await findHamburgDocuments(clientOf(mock), { documentType: "Verträge von öffentlichem Interesse", limit: 4 });
  assert.deepEqual(fqOf(mock.last()), ["extras_registerobject_type:vertrageoffinteress"]);
  assert.equal(params(mock.last()).get("sort"), "metadata_created desc");
  assert.equal(answer.total, 3069);
  const first = answer.documents[0];
  assert.equal(first?.name, "vergabe-hafun-06-mittelspannungsanlagen");
  assert.deepEqual(first?.documentTypes, ["Verträge von öffentlichem Interesse"]);
  assert.equal(first?.published, "2026-11-17T00:00:00");
  assert.equal(first?.licence?.label, "CC0 1.0");
  assert.equal(first?.attribution, "Namensnennung: Freie und Hansestadt Hamburg");
  assert.equal(first?.counts.pdfs, 4);
  assert.equal(answer.documents.find((d) => d.fileReference !== undefined)?.fileReference, "000.00-04");
});

test("findHamburgDocuments goes to Hamburg whatever portal the client talks to, and warns that the organization filter drops records", async () => {
  const mock = ckanApi();
  const answer = await findHamburgDocuments(clientOf(mock, "https://open.nrw"), { documentType: "gutachten", query: "Radverkehr", organization: "workflows", from: "2026-01-01" });
  assert.equal(new URL(mock.last().url).host, "suche.transparenz.hamburg.de");
  assert.ok(fqOf(mock.last()).includes("metadata_created:[2026-01-01T00:00:00Z TO *]"));
  assert.ok(requestsOf(answer)[0]?.startsWith("https://suche.transparenz.hamburg.de/api/3/action/"));
  assert.ok(answer.notes.some((n) => n.includes("drops the rest")));
  await assert.rejects(findHamburgDocuments(clientOf(mock), { documentType: "Rechnungen" }), /none of Hamburg's document types/);
});

// ---- getDataset ----------------------------------------------------------------------------------

test("getDataset reads one record: licence and attribution, its document type and publication date, its files", async () => {
  const answer = await getDataset(clientOf(ckanApi()), { id: "https://suche.transparenz.hamburg.de/dataset/kbq-verkehrstechnische-untersuchung-radverkehr" });
  assert.equal(answer.status, "ok");
  assert.equal(answer.dataset?.name, "kbq-verkehrstechnische-untersuchung-radverkehr");
  assert.deepEqual(answer.dataset?.licences.map((l) => l.label), ["CC0 1.0"]);
  assert.equal(answer.dataset?.attribution, "Namensnennung: Freie und Hansestadt Hamburg");
  assert.deepEqual(answer.dataset?.details["documentTypes"], ["Gutachten"]);
  assert.equal(answer.dataset?.details["published"], "2026-08-03T00:00:00");
  assert.equal(answer.dataset?.files[0]?.kind, "file");
  assert.deepEqual(requestsOf(answer), ["package_show?id=kbq-verkehrstechnische-untersuchung-radverkehr"]);
});

test("getDataset of an unknown name is empty and says where to take a name from; another error is thrown", async () => {
  const answer = await getDataset(clientOf(ckanApi()), { id: "gibt-es-nicht" });
  assert.equal(answer.status, "empty");
  assert.match(answer.reason ?? "", /findDatasets/);
  const failing = new CkanClient({ transport: makeMockTransport(() => jsonResponse(SEARCH_SERVER_DOWN, 500)).transport, maxRetries: 0 });
  await assert.rejects(getDataset(failing, { id: "x" }), CkanApiError);
});

// ---- listOrganizations ---------------------------------------------------------------------------

test("listOrganizations: the portal's organizations, most datasets first; groups with kind group; a name filters", async () => {
  const all = await listOrganizations(clientOf(ckanApi()));
  assert.equal(all.total, 6);
  assert.deepEqual(all.organizations[0], { name: "allris", title: "ALLRIS", datasets: 34668 });
  assert.ok(all.notes.some((n) => n.includes("no organization")));
  const groups = await listOrganizations(clientOf(ckanApi()), { kind: "group", name: "verkehr" });
  assert.deepEqual(groups.organizations.map((g) => g.name), ["transport-und-verkehr"]);
  const none = await listOrganizations(clientOf(ckanApi()), { name: "Bezirksamt" });
  assert.equal(none.status, "empty");
});
