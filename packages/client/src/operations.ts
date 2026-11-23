// The use cases of the skills as library functions, built on the client: each composes its calls
// and carries the traps the skills document, so no caller (the CLI, the MCP server's tools, a
// library user) has to know them:
// - findDatasets (ckan-dataset-finder): datasets for a topic and friendly filters (organization
//   and group by name, tag, file format in every spelling, record type, a date range, only
//   datasets with files) on one portal, a page at a time, each with its formats folded and its
//   licences;
// - comparePortals (ckan-dataset-finder, ckan-catalogue-stats): how many datasets match on every
//   portal of the built-in list at once, GovData (which harvests the others) apart;
// - countDatasets (ckan-catalogue-stats): how many datasets match on one portal, how they spread
//   over organizations, groups, formats, licences, tags, record and document types (sorted, the
//   spellings of one format or licence folded), and per year;
// - findHamburgDocuments (ckan-hamburg-transparency): the Transparenzportal Hamburg's documents by
//   document type (the stemmed value that works), topic and date, with their publication date,
//   licence, attribution text and files;
// - getDataset and listOrganizations, for what those don't reach: one record in full, and a
//   portal's organizations or groups with their dataset counts.
//
// A portal is the client's own, or one of the built-in list by its id (never a URL: the list is
// what a caller may reach). The rules they keep: no bare "not found" (an empty answer says what was
// searched and what to try); several organizations or groups for one name are reported as
// ambiguous, never guessed; each answer is a named type (public API of the CLI package: a changed
// shape is a `feat(client)!:` commit); every request an answer made is kept (`requestsOf(answer)`),
// as the client sends it, for its source.

import { actionRequest, packageSearchQuery, type CkanClient } from "./client.js";
import { CkanActionError, CkanApiError, CkanError, CkanValidationError, cutText } from "./errors.js";
import { mapLimit, portalKey, problemOf } from "./portals.js";
import { PORTALS } from "./portals-list.js";
import type { JsonObject, JsonValue, PackageSearchParams, PackageSearchResult, Portal } from "./types.js";

// ---- portals ---------------------------------------------------------------------------------

/** The Action API's path under a portal's site root. */
const ACTION_PATH = "/api/3/action/";

/** A portal of the built-in list by its id (any case); a URL or an unknown id is refused. */
export function portalById(id: string): Portal {
  const wanted = typeof id === "string" ? id.trim().toLowerCase() : "";
  const portal = PORTALS.find((p) => p.id === wanted);
  if (portal === undefined) {
    throw new CkanValidationError(`Invalid portal: ${JSON.stringify(String(id).slice(0, 80))} is not an id of the built-in list (${PORTALS.map((p) => p.id).join(", ")}).`);
  }
  return portal;
}

/** The portal of the list a client talks to, when it is one. */
function portalOfClient(client: CkanClient): Portal | undefined {
  return PORTALS.find((p) => portalKey(p.url) === client.siteKey);
}

/** Where an operation sends its requests: the client for it, and how its requests are named. */
interface Site {
  client: CkanClient;
  /** The portal of the list, when it is one. */
  portal?: Portal;
  /** "" for the client's own portal (requests relative to its Action API), else the absolute base. */
  prefix: string;
}

/** The site for `portalId` (an id of the list), or the client's own when none is given. */
function siteOf(client: CkanClient, portalId: string | undefined): Site {
  if (portalId === undefined) {
    const own = portalOfClient(client);
    return own === undefined ? { client, prefix: "" } : { client, portal: own, prefix: "" };
  }
  const portal = portalById(portalId);
  if (portalKey(portal.url) === client.siteKey) return { client, portal, prefix: "" };
  return { client: client.withBaseUrl(portal.url), portal, prefix: `${portal.url.replace(/\/+$/, "")}${ACTION_PATH}` };
}

/** The portal as an answer names it. */
export interface PortalRef {
  id?: string;
  title?: string;
  url?: string;
}

const portalRef = (site: Site): PortalRef => (site.portal === undefined ? {} : { id: site.portal.id, title: site.portal.title, url: site.portal.url });

// ---- the requests an answer made -------------------------------------------------------------

const REQUESTS = new WeakMap<object, readonly string[]>();

/**
 * The requests the operation that returned `answer` made, in order, each as the client sends it:
 * under the client's own Action API (`package_search?q=…`), or as an absolute URL on another
 * portal of the list. What its `source` names. Empty for an object no operation returned.
 */
export function requestsOf(answer: object): readonly string[] {
  return REQUESTS.get(answer) ?? [];
}

/** The requests of one operation call. */
class Trace {
  readonly requests: string[] = [];

  async search(site: Site, params: PackageSearchParams): Promise<PackageSearchResult> {
    this.requests.push(`${site.prefix}${actionRequest("package_search", packageSearchQuery(params))}`);
    return site.client.packageSearch(params);
  }

  done<T extends object>(answer: T): T {
    REQUESTS.set(answer, [...this.requests]);
    return answer;
  }
}

// ---- reading CKAN's JSON ---------------------------------------------------------------------

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
const objectsOf = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** A dataset's `extras` as a map. */
function extrasOf(dataset: JsonObject): Map<string, string> {
  const extras = new Map<string, string>();
  for (const extra of objectsOf(dataset["extras"])) {
    const key = textOf(extra["key"]);
    const value = textOf(extra["value"]);
    if (key !== undefined && value !== undefined) extras.set(key, value);
  }
  return extras;
}

/** Whitespace collapsed, cut at `max` characters with an ellipsis. */
function excerpt(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * `html` with each tag replaced by a space: a tag runs from "<" to the next ">"; a "<" with no ">"
 * after it is text. One pass with indexOf, so linear: a regular expression tried at every "<"
 * rescans the rest of a text without a ">" (quadratic).
 */
function withoutTags(html: string): string {
  const out: string[] = [];
  let at = 0;
  for (let open = html.indexOf("<"); open !== -1; open = html.indexOf("<", at)) {
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    out.push(html.slice(at, open), " ");
    at = close + 1;
  }
  out.push(html.slice(at));
  return out.join("");
}

/** HTML or Markdown-ish text (a description can arrive as `<p>…</p>`) as plain text, cut at `max`. */
function plainText(html: string | undefined, max = 1000): string | undefined {
  if (html === undefined) return undefined;
  const text = withoutTags(html)
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return excerpt(text, max);
}

/** Folded for comparing names: lower case, no accents (ü as u, like CKAN's slugs), ß as ss. */
export function foldName(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A Solr phrase: the value in double quotes, its quotes and backslashes escaped. */
const phrase = (value: string): string => `"${value.replace(/[\\"]/g, "\\$&")}"`;

// ---- formats ---------------------------------------------------------------------------------

/** The EU file-type vocabulary, the spelling of most format values on GovData and daten.bw. */
export const EU_FILE_TYPE = "http://publications.europa.eu/resource/authority/file-type/";

/** Free-text and MIME spellings of a format, by what they mean. */
const FORMAT_ALIASES: Readonly<Record<string, string>> = {
  SHAPE: "SHP",
  SHAPEFILE: "SHP",
  SHAPEFILES: "SHP",
  "GEZIPPTE SHAPE": "SHP",
  "ESRI SHAPEFILE": "SHP",
  "GEZIPPTE SHAPEDATEI": "SHP",
  "GEZIPPTE SHAPEDATEIEN": "SHP",
  "GML+XML": "GML",
  GEOPACKAGE: "GPKG",
  "APPLICATION/GEOPACKAGE+SQLITE3": "GPKG",
  JPG: "JPEG",
  "JSON-LD": "JSON_LD",
  "TEXT/CSV": "CSV",
  "APPLICATION/JSON": "JSON",
  "APPLICATION/GEO+JSON": "GEOJSON",
  "APPLICATION/VND.GEO+JSON": "GEOJSON",
  "APPLICATION/ZIP": "ZIP",
  "APPLICATION/PDF": "PDF",
  "APPLICATION/XML": "XML",
  "TEXT/XML": "XML",
  "TEXT/HTML": "HTML",
  "APPLICATION/VND.MS-EXCEL": "XLS",
  "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET": "XLSX",
};

/** Values in the format field that name no format. */
const NOT_FORMATS = new Set(["DOWNLOAD", "LINK", "WEBSITE", "WEBSEITE", "WEB", "DATEI", "FILE", "DATA", "DATEN"]);

/** Formats that are services, not files. */
export const SERVICE_FORMATS: ReadonlySet<string> = new Set(["WMS", "WFS", "WCS", "WMTS", "OAF", "ATOM", "CSW", "SOS", "WPS", "MQTT", "STA"]);

/**
 * A format value as one short name: the EU URI's tail (`…/file-type/CSV` is CSV), upper case (csv
 * and CSV are one), the EU `_SRVC` suffix dropped (WMS_SRVC is WMS), free-text and MIME spellings
 * mapped (Shapefiles is SHP, text/csv is CSV). Undefined for a value that names no clear format:
 * another vocabulary's URI, an unknown MIME type, a combined value ("Shape, CSV"), a word like
 * "Download".
 */
export function formatOf(raw: unknown): string | undefined {
  const text = textOf(raw);
  if (text === undefined) return undefined;
  let upper = text.toUpperCase();
  const alias = FORMAT_ALIASES[upper];
  if (alias !== undefined) return alias;
  if (/^HTTPS?:\/\//.test(upper)) {
    const media = /\/ASSIGNMENTS\/MEDIA-TYPES\/(.+)$/.exec(upper);
    if (media !== null) return FORMAT_ALIASES[media[1] as string];
    // ArcGIS Hub's DCAT feeds name the format at the end of their own URI (…/ftype/CSV).
    const arcgis = /\/FTYPE\/([A-Z0-9_]+)$/.exec(upper);
    if (arcgis !== null) return formatOf(arcgis[1]);
    if (!upper.startsWith(EU_FILE_TYPE.toUpperCase())) return undefined;
    upper = upper.slice(EU_FILE_TYPE.length);
  }
  upper = upper.replace(/_SRVC$/, "");
  const mapped = FORMAT_ALIASES[upper] ?? upper;
  if (!/^[A-Z0-9_]{1,12}$/.test(mapped) || NOT_FORMATS.has(mapped)) return undefined;
  return mapped;
}

/** A requested format as `formatOf` names it: letters, digits, `_`, `-`, `+`, `/` or `.`, at most 40 characters. */
function wantedFormat(value: string): string {
  const text = value.trim();
  const format = /^[A-Za-z0-9_+\-/.]{1,40}$/.test(text) ? formatOf(text) : undefined;
  if (format === undefined) {
    throw new CkanValidationError(`Invalid format: expected a format name such as CSV, GEOJSON or SHP, got ${JSON.stringify(text.slice(0, 40))}.`);
  }
  return format;
}

/**
 * The spellings portals store a format under: upper case (NRW, München), lower case (Hamburg; Berlin
 * has both as separate values, and its filter is case-sensitive), the EU URI (GovData, daten.bw),
 * free-text and MIME aliases.
 */
export function formatSpellings(format: string): string[] {
  const spellings = new Set([format, format.toLowerCase(), `${EU_FILE_TYPE}${format}`]);
  if (SERVICE_FORMATS.has(format)) spellings.add(`${EU_FILE_TYPE}${format}_SRVC`);
  for (const [alias, meaning] of Object.entries(FORMAT_ALIASES)) {
    if (meaning !== format) continue;
    spellings.add(alias.includes("/") ? alias.toLowerCase() : alias.charAt(0) + alias.slice(1).toLowerCase());
    if (!alias.includes("/")) {
      // Open.NRW writes them in capitals (GEZIPPTE SHAPEDATEI), Hamburg in lower case (shapefiles).
      spellings.add(alias);
      spellings.add(alias.toLowerCase());
    }
  }
  if (format === "GEOJSON") spellings.add("GeoJSON");
  if (format === "GPKG") spellings.add("GeoPackage");
  return [...spellings];
}

/** The Solr filter for datasets with a file in `format`, in any of its spellings. */
export function formatFilter(format: string): string {
  return `res_format:(${formatSpellings(format).map(phrase).join(" OR ")})`;
}

// ---- licences --------------------------------------------------------------------------------

export interface Licence {
  /** As delivered (an id such as dl-de-by-2.0, or a URI). */
  id: string;
  /** A short name: "DL-DE BY 2.0", "CC BY 4.0"; the portal's title or the id when it is not known. */
  label: string;
  /** Whether it is an open licence; absent when the licence is not known. */
  open?: boolean;
}

/** Licences by their DCAT-AP.de id (http://dcat-ap.de/def/licenses/…), `2_0` read as `2.0`. */
const LICENCES: Readonly<Record<string, [string, boolean]>> = {
  "dl-by-de/2.0": ["DL-DE BY 2.0", true],
  "dl-zero-de/2.0": ["DL-DE Zero 2.0", true],
  "dl-by-de/1.0": ["DL-DE BY 1.0", true],
  "dl-by-nc-de/1.0": ["DL-DE BY-NC 1.0", false],
  "cc-by/4.0": ["CC BY 4.0", true],
  "cc-by": ["CC BY", true],
  "cc-by-de/3.0": ["CC BY 3.0 DE", true],
  "cc-by-sa/4.0": ["CC BY-SA 4.0", true],
  "cc-by-sa": ["CC BY-SA", true],
  "cc-by-sa-de/3.0": ["CC BY-SA 3.0 DE", true],
  "cc-by-nd/4.0": ["CC BY-ND 4.0", false],
  "cc-by-nc/4.0": ["CC BY-NC 4.0", false],
  "cc-by-nc": ["CC BY-NC", false],
  "cc-zero": ["CC0 1.0", true],
  odbl: ["ODbL", true],
  "geonutz/20130319": ["GeoNutzV (Geodaten des Bundes)", true],
  "geonutz/20131001": ["GeoNutzV (Geodaten des Bundes)", true],
  "official-work": ["Amtliches Werk (§ 5 UrhG)", true],
  "other-closed": ["other, closed (not an open licence)", false],
  "other-open": ["other open licence", true],
  "other-opensource": ["other open-source licence", true],
  "other-freeware": ["freeware", false],
  "other-commercial": ["commercial", false],
};

/** A licence id in the DCAT-AP.de form, whatever spelling a portal uses (dl-de-by-2.0, cc-by-4.0, geoNutz-20130319). */
function licenceKey(raw: string): string {
  let key = raw.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/dcat-ap\.de\/def\/licenses\//, "").replace(/_/g, ".");
  key = key.replace(/^dl-de-(by|zero|by-nc)-(\d\.\d)$/, "dl-$1-de/$2");
  key = key.replace(/^dl-(by|zero|by-nc)-de-(\d\.\d)$/, "dl-$1-de/$2");
  key = key.replace(/^(cc-by(?:-nc)?(?:-sa|-nd)?(?:-de)?)-(\d\.\d)$/, "$1/$2");
  key = key.replace(/^geonutz-(\d{8})$/, "geonutz/$1");
  key = key.replace(/^cc-zero\/1\.0$/, "cc-zero");
  return key;
}

/**
 * A licence with a short name; undefined for an empty value. The spellings of one licence across
 * portals (dl-de-by-2.0, dl-by-de/2.0, the DCAT-AP.de URI, 2_0) get one label; `title` (the
 * portal's license_title) names an unknown one.
 */
export function licenceOf(raw: unknown, title?: unknown): Licence | undefined {
  const id = textOf(raw);
  if (id === undefined) return undefined;
  const key = licenceKey(id);
  const known = LICENCES[key];
  if (known !== undefined) return { id, label: known[0], open: known[1] };
  // The other Creative Commons licences of DCAT-AP.de (cc-by-nc-de/3.0, cc-by-nc-sa/4.0): named
  // from their parts; non-commercial (NC) and no-derivatives (ND) are not open.
  const ccKey = /^cc-by((?:-nc)?(?:-sa|-nd)?)(-de)?(?:\/(\d\.\d))?$/.exec(key);
  if (ccKey !== null) {
    const [, terms = "", de, version] = ccKey;
    return { id, label: `CC BY${terms.toUpperCase()}${version === undefined ? "" : ` ${version}`}${de === undefined ? "" : " DE"}`, open: !/nc|nd/.test(terms) };
  }
  const lower = id.toLowerCase().replace(/\/+$/, "");
  const govdata = /govdata\.de\/dl-de\/(by|zero|by-nc)-(\d)-(\d)$/.exec(lower);
  if (govdata !== null) {
    const label = `DL-DE ${govdata[1] === "zero" ? "Zero" : (govdata[1] as string).toUpperCase()} ${govdata[2]}.${govdata[3]}`;
    return { id, label, open: govdata[1] !== "by-nc" };
  }
  const cc = /creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)/.exec(lower);
  if (cc !== null) {
    const kind = cc[1] as string;
    return { id, label: `CC ${kind.toUpperCase()} ${cc[2]}`, open: !/nc|nd/.test(kind) };
  }
  if (/creativecommons\.org\/publicdomain\/zero\//.test(lower)) return { id, label: "CC0 1.0", open: true };
  const named = textOf(title);
  if (named !== undefined && named !== id) return { id, label: excerpt(named, 120) as string };
  // The last part of the id, with the one before it when the last is only a version (x/3.0):
  // licences that differ only before their version never share a label.
  const parts = id.replace(/\/+$/, "").split(/[/#]/);
  const tail = (/^\d+(\.\d+)*$/.test(parts.at(-1) ?? "") && parts.length > 1 ? parts.slice(-2).join("/") : parts.at(-1)) ?? id;
  return { id, label: tail === "" ? id : tail };
}

/** The distinct licences (by label) of `pairs` of id and title, in the order first seen. */
function distinctLicences(pairs: [unknown, unknown][]): Licence[] {
  const seen = new Map<string, Licence>();
  for (const [raw, title] of pairs) {
    const licence = licenceOf(raw, title);
    if (licence !== undefined && !seen.has(licence.label)) seen.set(licence.label, licence);
  }
  return [...seen.values()];
}

/** A dataset's licences: its own (license_id), then any other its files name. */
function licencesOf(dataset: JsonObject): Licence[] {
  return distinctLicences([[dataset["license_id"], dataset["license_title"]], ...objectsOf(dataset["resources"]).map((r): [unknown, unknown] => [r["license"], undefined])]);
}

/** The attribution text a record asks for: Hamburg's terms_of_use (a JSON string), else a DCAT extra. */
function attributionOf(dataset: JsonObject, extras: Map<string, string>): string | undefined {
  const terms = extras.get("terms_of_use");
  if (terms !== undefined) {
    try {
      const parsed = JSON.parse(terms) as unknown;
      if (isObject(parsed)) {
        const text = plainText(textOf(parsed["attribution_text"]), 500);
        if (text !== undefined) return text;
      }
    } catch {
      // Not JSON: no attribution from it.
    }
  }
  return plainText(extras.get("licenseAttributionByText") ?? textOf(dataset["licenseAttributionByText"]), 500);
}

// ---- links -----------------------------------------------------------------------------------

/**
 * What a resource's link is: `file` (a file name at the end), `generated` (a file built on request:
 * an export or download endpoint, a WFS GetFeature), `service` (a map or feature service, an OGC
 * API, a feed: not a file), `page` (a landing page), `api` (another API call), `template` (a
 * placeholder such as {yyyymm} or _yyyy. to fill in), `broken` (cut off by a harvester).
 */
export type LinkKind = "file" | "generated" | "service" | "page" | "api" | "template" | "broken";

/** The link with a percent-encoded query (`%3f`, as harvested) read as a query. */
function decodedLink(url: string): string {
  try {
    return decodeURI(url.replace(/%3f/gi, "?").replace(/%3d/gi, "=").replace(/%26/gi, "&"));
  } catch {
    return url;
  }
}

/** The extension at the end of a link's path (`.csv.gz` is CSV), upper case, or undefined. */
export function extensionOf(url: string): string | undefined {
  const path = decodedLink(url).split(/[?#]/)[0] ?? "";
  const match = /\.([a-z0-9]{2,8})(?:\.(?:gz|zip|bz2))?$/i.exec(path.split("/").pop() ?? "");
  if (match === null) return undefined;
  const ext = (match[1] as string).toUpperCase();
  return FORMAT_ALIASES[ext] ?? ext;
}

/** Whether the link carries a key or token in its query (as published). */
export function hasKeyInLink(url: string): boolean {
  return /[?&](api[-_]?key|apikey|token|access_token|key)=/i.test(decodedLink(url));
}

/** The kind of a resource's link (see LinkKind), from the link and its format. */
export function linkKind(url: string, format: string | undefined): LinkKind {
  const link = decodedLink(url);
  const [path = "", query = ""] = link.split(/\?/, 2);
  if (/\{[^}]*\}|%7b/i.test(url) || /(^|[_\-/.])(yyyy|yyyymm|yyyymmdd|jjjj|jjjjmm)([_\-/.]|$)/i.test(path)) return "template";
  // Cut off by a harvester: a resource link without its id, or with part of it.
  if (/\/resource\/[0-9a-f-]{1,35}$/i.test(path) || /\/dataset\/[^/]+\/(?:res|reso|resou|resour|resourc|resource)(?:-\d+)?$/i.test(path)) return "broken";
  if (/[?&]request=getfeature/i.test(`?${query}`)) return "generated";
  if (/(^|&)service=(wms|wfs|wcs|wmts|csw|sos|wps)(&|$)/i.test(query) || /(^|&)request=/i.test(query)) return "service";
  if (format !== undefined && SERVICE_FORMATS.has(format)) return "service";
  if (/\/dataset\/[^/]+\/resource\/[0-9a-f-]{36}$/i.test(path)) return "page";
  const ext = extensionOf(path);
  if (ext !== undefined) return /^(HTML?|PHP|ASPX?|JSP)$/.test(ext) ? "page" : "file";
  if (hasKeyInLink(url)) return "api";
  if (/\/(download|export|exports|dump)(\/|$)/i.test(path)) return "generated";
  if (path.endsWith("/") || format === "HTML") return "page";
  return query === "" ? "page" : "api";
}

/** The kinds of link a download can fetch. */
const FETCHABLE: ReadonlySet<LinkKind> = new Set(["file", "generated"]);

/** One file (resource) of a dataset. */
export interface FileEntry {
  id?: string;
  name?: string;
  /** Folded (CSV), or as delivered when it names no clear format. */
  format?: string;
  url: string;
  kind: LinkKind;
  /** The file name's extension, when it differs from the format (an .xlsx labelled XLS). */
  extension?: string;
  /** Bytes, when the metadata say. */
  size?: number;
  /** The file's own licence, when it names one. */
  licence?: Licence;
  modified?: string;
  /** The link carries someone's key or token in its query, as published. */
  keyInLink?: true;
}

/** A resource as a file entry; undefined without a URL. */
function fileOf(resource: JsonObject): FileEntry | undefined {
  const url = textOf(resource["url"]) ?? textOf(resource["download_url"]) ?? textOf(resource["access_url"]);
  if (url === undefined) return undefined;
  const rawFormat = textOf(resource["format"]);
  const format = formatOf(rawFormat);
  const entry: FileEntry = { url, kind: linkKind(url, format) };
  const id = textOf(resource["id"]);
  if (id !== undefined) entry.id = id;
  const name = textOf(resource["name"]) ?? textOf(resource["description"]);
  if (name !== undefined) entry.name = excerpt(name, 200) as string;
  const shown = format ?? rawFormat;
  if (shown !== undefined) entry.format = excerpt(shown, 100) as string;
  const extension = entry.kind === "file" ? extensionOf(url) : undefined;
  if (extension !== undefined && format !== undefined && extension !== format) entry.extension = extension;
  const size = resource["size"];
  if (typeof size === "number" && Number.isSafeInteger(size) && size > 0) entry.size = size;
  const licence = licenceOf(resource["license"]);
  if (licence !== undefined) entry.licence = licence;
  const modified = textOf(resource["last_modified"]) ?? textOf(resource["modified"]);
  if (modified !== undefined) entry.modified = modified;
  if (hasKeyInLink(url)) entry.keyInLink = true;
  return entry;
}

// ---- Hamburg's document types ----------------------------------------------------------------

/**
 * The Transparenzportal Hamburg's document types (Informationsgegenstände), by the value its search
 * index holds: Solr stems the stored words, so `extras_registerobject_type:gutacht` finds the
 * Gutachten, while the published values (vertraege_oeff_interesse) and the stored ones
 * (vertraegeoeffinteresse) find nothing, and some full words over-match (verwaltungsvorschriften
 * finds the Dienstanweisungen too).
 */
export const DOCUMENT_TYPES = Object.freeze({
  beschluss: "Beschlüsse",
  bauleitplan: "Bauleitpläne",
  baugenehm: "Baugenehmigungen",
  statist: "Statistiken",
  geodat: "Geodaten",
  senatpetitum: "Senatspetita",
  messung: "Messungen",
  senatmitteil: "Senatsmitteilungen",
  andereveroffentlichungspflicht: "andere Veröffentlichungspflicht",
  ohneveroffentlichungspflicht: "ohne Veröffentlichungspflicht",
  vertrageoffinteress: "Verträge von öffentlichem Interesse",
  gutacht: "Gutachten",
  vergleichbar: "vergleichbare Informationen",
  verwaltungsvorschrift: "Verwaltungsvorschriften",
  dienstanweis: "Dienstanweisungen",
  daseinsvorsorg: "Daseinsvorsorge",
  verwaltungsbelang: "Verwaltungsbelange",
  stadtischebeteil: "städtische Beteiligungen",
  baumkatast: "Baumkataster",
  subvention: "Subventionen",
});
export type DocumentType = keyof typeof DOCUMENT_TYPES;

/** A word with the umlauts as Hamburg's values write them out (ae, oe, ue) taken back to a, o, u. */
const unUmlaut = (text: string): string => foldName(text).replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/[^a-z]/g, "");

/** The words of a value as a person writes them (spaces and commas between). */
const wordsOf = (text: string): string[] => text.trim().split(/[\s,;]+/).filter((word) => word !== "");

/** The most letters a value may have after a whole stem: a word's ending (Beteilig-ungen), not more words. */
const MAX_ENDING = 7;

/**
 * A document type's index value from that value, its German name, Hamburg's stored value
 * (vertraegeoeffinteresse) or its published one (vertraege_oeff_interesse); undefined if none fits.
 * A value with more words than the type's name ("Gutachten zum Radverkehr") is no type: the other
 * words would be dropped without a word (documentTypeAndWords finds the type in it).
 */
export function documentType(value: string): DocumentType | undefined {
  const folded = unUmlaut(value);
  if (folded === "") return undefined;
  const words = wordsOf(value).length;
  let best: DocumentType | undefined;
  let bestLength = 0;
  let tie = false;
  for (const [stem, label] of Object.entries(DOCUMENT_TYPES)) {
    if (folded === stem || folded === unUmlaut(label)) return stem as DocumentType;
    if (words > wordsOf(label).length) continue;
    // A stored or published value starts with the stem, give or take the last letters (senatpetita).
    let common = 0;
    while (common < stem.length && common < folded.length && stem[common] === folded[common]) common++;
    if (common < Math.min(stem.length, 6) || folded.length - common > (common === stem.length ? MAX_ENDING : 3)) continue;
    if (common > bestLength) {
      best = stem as DocumentType;
      bestLength = common;
      tie = false;
    } else if (common === bestLength) {
      tie = true;
    }
  }
  // Two types fit as well ("verwaltung"): none is guessed.
  return tie ? undefined : best;
}

/**
 * A value that starts with a document type and goes on with other words ("Gutachten zum
 * Radverkehr"): the type and those words; undefined when no leading words are a type.
 */
export function documentTypeAndWords(value: string): { type: DocumentType; words: string } | undefined {
  const words = wordsOf(value);
  for (let n = words.length - 1; n >= 1; n--) {
    const type = documentType(words.slice(0, n).join(" "));
    if (type !== undefined) return { type, words: words.slice(n).join(" ") };
  }
  return undefined;
}

/** The German names of a record's stored type value ("dienstanweisungen, vergleichbar"). */
function documentTypesOf(stored: string | undefined): string[] {
  if (stored === undefined) return [];
  return stored
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const stem = documentType(part);
      return stem === undefined ? part : DOCUMENT_TYPES[stem];
    });
}

// ---- the shared filters ----------------------------------------------------------------------

export type DatasetSort = "relevance" | "modified" | "created" | "title";

const SORTS: Readonly<Record<DatasetSort, string | undefined>> = {
  relevance: undefined,
  modified: "metadata_modified desc",
  created: "metadata_created desc",
  title: "title_string asc",
};

/** CKAN's record types: datasets; Hamburg also documents and apps. */
export const RECORD_TYPES = ["dataset", "document", "app"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** The date field a range filters on. */
export type DateField = "created" | "modified";

/** What the dataset tools filter by. */
export interface DatasetFilters {
  /** A portal of the built-in list by its id; else the client's own. */
  portal?: string | undefined;
  /** Solr query: words, "phrases", AND/OR/NOT, field:value (title:Radverkehr). */
  query?: string | undefined;
  /** An organization (publisher), by slug or name. */
  organization?: string | undefined;
  /** A group (theme, category), by slug or name. */
  group?: string | undefined;
  /** A tag, exactly as the portal spells it. */
  tag?: string | undefined;
  /** Datasets with a file in this format, in any of its spellings (CSV, GEOJSON, SHP, …). */
  format?: string | undefined;
  /** dataset, document or app (Hamburg has all three). */
  type?: RecordType | undefined;
  /** Only datasets with at least one file (num_resources ≥ 1): metadata-only records left out. */
  withFiles?: boolean | undefined;
  /** The date field of from and to: created (when the record entered the portal, default) or modified. */
  dateField?: DateField | undefined;
  /** From this day on (YYYY-MM-DD). */
  from?: string | undefined;
  /** Up to and including this day (YYYY-MM-DD). */
  to?: string | undefined;
  /** Raw Solr filter queries, ANDed (each its own filter). */
  filters?: readonly string[] | undefined;
}

/** What a filtered search was given, as the answer repeats it. */
export type Searched = Record<string, JsonValue>;

/** An organization or group of a portal: its slug, its title, how many datasets it has. */
export interface OrganizationEntry {
  name: string;
  title: string;
  datasets: number;
}

/** Several organizations or groups fit a name: the candidates, never a guess. */
export interface Ambiguity {
  field: string;
  value: string;
  candidates: OrganizationEntry[];
  total: number;
}

/** What every answer has. */
interface AnswerBase {
  status: "ok" | "empty" | "ambiguous";
  /** Why the answer is empty or ambiguous, and what to try. */
  reason?: string;
  /** The portal asked (from the built-in list; empty for another the server was pointed at). */
  portal: PortalRef;
  searched: Searched;
  notes: string[];
  ambiguous?: Ambiguity;
}

interface FacetItem {
  name: string;
  label?: string;
  count: number;
}

/** A facet's items from a search result (`search_facets.<field>.items`), zero counts dropped. */
function facetItems(result: PackageSearchResult, field: string): FacetItem[] {
  const facets = isObject(result.search_facets) ? result.search_facets : {};
  const facet = facets[field];
  const items = isObject(facet) ? objectsOf(facet["items"]) : [];
  const out: FacetItem[] = [];
  for (const item of items) {
    const name = typeof item["name"] === "string" ? item["name"] : undefined;
    const count = item["count"];
    if (name === undefined || typeof count !== "number" || count <= 0) continue;
    const label = textOf(item["display_name"]);
    out.push(label === undefined || label === name ? { name, count } : { name, label, count });
  }
  return out;
}

/** A portal's organizations or groups with their dataset counts (one facet request). */
async function entriesOf(site: Site, field: "organization" | "groups", trace: Trace): Promise<OrganizationEntry[]> {
  const result = await trace.search(site, { rows: 0, facet_field: [field], facet_limit: -1 });
  return facetItems(result, field)
    .map((item) => ({ name: item.name, title: item.label ?? item.name, datasets: item.count }))
    .sort((a, b) => b.datasets - a.datasets || a.name.localeCompare(b.name));
}

/** The entries that fit `value`: its slug or title exactly, else those containing it. */
function matchEntries(entries: OrganizationEntry[], value: string): { exact: boolean; matches: OrganizationEntry[] } {
  const folded = foldName(value);
  const exact = entries.filter((o) => o.name.toLowerCase() === folded || foldName(o.title) === folded);
  if (exact.length > 0) return { exact: true, matches: exact };
  return { exact: false, matches: entries.filter((o) => o.name.toLowerCase().includes(folded.replace(/ /g, "-")) || foldName(o.title).includes(folded)) };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day (YYYY-MM-DD) checked, as a Date at its start (UTC). */
function dayOf(name: string, value: string): Date {
  const text = value.trim();
  const date = new Date(`${text}T00:00:00Z`);
  if (!DAY.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new CkanValidationError(`Invalid ${name}: expected a day as YYYY-MM-DD, got ${JSON.stringify(text.slice(0, 40))}.`);
  }
  return date;
}

/** The Solr range of `field` from the start of `from` to the end of `to` (either open). */
function dateRange(field: string, from: Date | undefined, to: Date | undefined): string {
  const start = from === undefined ? "*" : `${from.toISOString().slice(0, 19)}Z`;
  const end = to === undefined ? "*" : `${new Date(to.getTime() + 86_400_000).toISOString().slice(0, 19)}Z`;
  return `${field}:[${start} TO ${end}${to === undefined ? "]" : "}"}`;
}

/** The checks of the shared filters (before any request). */
function checkFilters(filters: DatasetFilters): { format?: string; from?: Date; to?: Date } {
  const checked: { format?: string; from?: Date; to?: Date } = {};
  if (filters.format !== undefined) checked.format = wantedFormat(filters.format);
  for (const [name, value] of [["query", filters.query], ["organization", filters.organization], ["group", filters.group], ["tag", filters.tag]] as const) {
    if (value !== undefined && value.trim() === "") throw new CkanValidationError(`Invalid ${name}: expected a non-empty value.`);
  }
  if (filters.type !== undefined && !RECORD_TYPES.includes(filters.type)) {
    throw new CkanValidationError(`Invalid type: expected one of ${RECORD_TYPES.join(", ")}, got ${JSON.stringify(String(filters.type))}.`);
  }
  if (filters.dateField !== undefined && filters.dateField !== "created" && filters.dateField !== "modified") {
    throw new CkanValidationError(`Invalid dateField: expected created or modified, got ${JSON.stringify(String(filters.dateField))}.`);
  }
  if (filters.from !== undefined) checked.from = dayOf("from", filters.from);
  if (filters.to !== undefined) checked.to = dayOf("to", filters.to);
  if (checked.from !== undefined && checked.to !== undefined && checked.from > checked.to) {
    throw new CkanValidationError("Invalid from/to: from is after to.");
  }
  if (filters.portal !== undefined) portalById(filters.portal);
  return checked;
}

/** The answer to give instead of a search: empty (no such organization or group) or ambiguous. */
type Instead = { answer: Pick<AnswerBase, "status" | "reason" | "ambiguous" | "searched"> };

/** Resolve an organization or group by name against the portal's list; or the answer to give instead. */
async function resolveEntry(site: Site, field: "organization" | "group", value: string, searched: Searched, trace: Trace): Promise<OrganizationEntry | Instead> {
  const { exact, matches } = matchEntries(await entriesOf(site, field === "group" ? "groups" : "organization", trace), value);
  if (matches.length === 0) {
    const reason =
      field === "organization"
        ? `No organization of this portal is named ${JSON.stringify(value)}. listOrganizations lists them; the office behind a record is often only in its author or maintainer (search for it as words).`
        : `No group of this portal is named ${JSON.stringify(value)}. listOrganizations with kind group lists them; or search for the theme as words.`;
    return { answer: { status: "empty", searched, reason } };
  }
  if (matches.length > 1) {
    return {
      answer: {
        status: "ambiguous",
        searched,
        reason: `${matches.length} ${field === "organization" ? "organizations" : "groups"} ${exact ? "are named" : "contain"} ${JSON.stringify(value)}: give one of the candidates' names.`,
        ambiguous: { field, value, candidates: matches.slice(0, 10), total: matches.length },
      },
    };
  }
  return matches[0] as OrganizationEntry;
}

/**
 * The Solr filters for `filters`, an organization or group resolved by name (one request each);
 * or the answer to give instead: empty (no such organization or group) or ambiguous (several).
 */
async function filterQueriesOf(site: Site, filters: DatasetFilters, trace: Trace): Promise<{ fq: string[]; searched: Searched; format?: string } | Instead> {
  const checked = checkFilters(filters);
  const searched: Searched = {};
  const fq: string[] = [];
  if (filters.query !== undefined) searched["query"] = filters.query.trim();
  for (const field of ["organization", "group"] as const) {
    const value = filters[field]?.trim();
    if (value === undefined) continue;
    searched[field] = value;
    const entry = await resolveEntry(site, field, value, searched, trace);
    if ("answer" in entry) return entry;
    searched[field] = entry.name;
    fq.push(`${field === "group" ? "groups" : "organization"}:${phrase(entry.name)}`);
  }
  if (filters.tag !== undefined) {
    searched["tag"] = filters.tag.trim();
    fq.push(`tags:${phrase(filters.tag.trim())}`);
  }
  if (checked.format !== undefined) {
    searched["format"] = checked.format;
    fq.push(formatFilter(checked.format));
  }
  if (filters.type !== undefined) {
    searched["type"] = filters.type;
    fq.push(`type:${filters.type}`);
  }
  if (filters.withFiles === true) {
    searched["withFiles"] = true;
    fq.push("num_resources:[1 TO *]");
  }
  if (checked.from !== undefined || checked.to !== undefined) {
    const field = filters.dateField ?? "created";
    searched["dateField"] = field;
    if (filters.from !== undefined) searched["from"] = filters.from.trim();
    if (filters.to !== undefined) searched["to"] = filters.to.trim();
    fq.push(dateRange(`metadata_${field}`, checked.from, checked.to));
  }
  if (filters.filters !== undefined && filters.filters.length > 0) {
    searched["filters"] = [...filters.filters];
    fq.push(...filters.filters);
  }
  return { fq, searched, ...(checked.format === undefined ? {} : { format: checked.format }) };
}

/** Throw unless `value` is undefined or an integer in [min, max]. */
function checkInteger(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CkanValidationError(`Invalid ${name}: expected an integer from ${min} to ${max}, got ${String(value)}.`);
  }
}

function checkSort(sort: string): void {
  if (!(sort in SORTS)) throw new CkanValidationError(`Invalid sort: expected one of ${Object.keys(SORTS).join(", ")}, got ${JSON.stringify(String(sort))}.`);
}

/** The most results a page may start after: CKAN reads further, but nobody pages that far. */
export const MAX_OFFSET = 100_000;

/** The notes every answer on GovData or daten.bw carries: their dataset-level licence is mostly empty. */
function licenceNotes(site: Site, notes: string[]): void {
  if (site.portal?.id === "govdata" || site.portal?.id === "bw") {
    notes.push("On this portal the dataset-level licence is mostly empty; the licences listed come from the files where they name one.");
  }
}

// ---- findDatasets ----------------------------------------------------------------------------

export const DEFAULT_DATASETS = 10;
export const MAX_DATASETS = 50;

export interface FindDatasetsParams extends DatasetFilters {
  sort?: DatasetSort | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

/** One dataset of a search, with what decides its reuse. */
export interface DatasetHit {
  /** The slug, for getDataset. */
  name: string;
  title?: string;
  /** dataset, document or app. */
  type?: string;
  organization?: { name: string; title?: string };
  /** The office or person behind it (author, else maintainer). */
  author?: string;
  description?: string;
  /** When the record last changed (metadata_modified). */
  modified?: string;
  /** When the record entered the portal (metadata_created). */
  created?: string;
  /** How many files (resources) it has; 0 is a metadata-only record. */
  files: number;
  /** The formats of its files, folded (CSV, not csv or the EU URI). */
  formats: string[];
  /** Its licence, and any other its files name. */
  licences: Licence[];
  /** The attribution text the publisher asks for, where the record carries one. */
  attribution?: string;
  /** Group slugs. */
  groups: string[];
  /** With a format filter: whether a file of it is there. */
  hasFormat?: boolean;
}

export interface FindDatasetsAnswer extends AnswerBase {
  total: number;
  offset: number;
  datasets: DatasetHit[];
  nextOffset?: number;
}

/** A search result as a hit: formats folded, licences named. */
function hitOf(dataset: JsonObject, format: string | undefined): DatasetHit {
  const resources = objectsOf(dataset["resources"]);
  const extras = extrasOf(dataset);
  const organization = isObject(dataset["organization"]) ? dataset["organization"] : undefined;
  const formats = [...new Set(resources.map((r) => formatOf(r["format"])).filter((f): f is string => f !== undefined))];
  const count = typeof dataset["num_resources"] === "number" ? dataset["num_resources"] : resources.length;
  const hit: DatasetHit = {
    name: textOf(dataset["name"]) ?? textOf(dataset["id"]) ?? "",
    files: count,
    formats,
    licences: licencesOf(dataset),
    groups: objectsOf(dataset["groups"]).map((g) => textOf(g["name"])).filter((g): g is string => g !== undefined),
  };
  const set = <K extends keyof DatasetHit>(key: K, value: DatasetHit[K] | undefined): void => {
    if (value !== undefined) hit[key] = value;
  };
  set("title", textOf(dataset["title"]));
  set("type", textOf(dataset["type"]));
  const orgName = organization === undefined ? undefined : textOf(organization["name"]);
  if (orgName !== undefined) {
    const orgTitle = textOf(organization?.["title"]);
    hit.organization = orgTitle === undefined ? { name: orgName } : { name: orgName, title: orgTitle };
  }
  set("author", textOf(dataset["author"]) ?? textOf(dataset["maintainer"]) ?? extras.get("publisher_name"));
  set("description", plainText(textOf(dataset["notes"]), 300));
  set("modified", textOf(dataset["metadata_modified"]));
  set("created", textOf(dataset["metadata_created"]));
  set("attribution", attributionOf(dataset, extras));
  if (format !== undefined) hit.hasFormat = formats.includes(format) || resources.some((r) => typeof r["url"] === "string" && extensionOf(r["url"]) === format);
  return hit;
}

/** The notes about a page of hits: metadata-only records, repeated titles, missing licences. */
function hitNotes(datasets: DatasetHit[], notes: string[]): void {
  const stubs = datasets.filter((d) => d.files === 0).length;
  if (stubs > 0) notes.push(`${stubs} of these records have no files (metadata only); withFiles leaves them out.`);
  const titles = new Map<string, number>();
  for (const d of datasets) if (d.title !== undefined) titles.set(foldName(d.title), (titles.get(foldName(d.title)) ?? 0) + 1);
  const repeated = [...new Set(datasets.filter((d) => d.title !== undefined && (titles.get(foldName(d.title)) ?? 0) > 1).map((d) => d.title as string))];
  if (repeated.length > 0) notes.push(`Titles on this page more than once (editions or series): ${repeated.map((t) => JSON.stringify(t)).join(", ")}. Group them when presenting.`);
  if (datasets.some((d) => d.licences.length === 0)) notes.push("A record with licences [] states no licence: say so, never assume one.");
  if (datasets.some((d) => d.licences.some((l) => l.open === false))) notes.push("Some licences are not open (open false, such as other-closed): say so for those records.");
}

/**
 * Datasets for a topic and filters on one portal, a page at a time (`total` counts all matches:
 * read it, never page to count). Each hit names its formats folded, its licences and the
 * attribution text where the record carries one. The notes say which hits are metadata-only, which
 * titles repeat, which licences are not open.
 */
export async function findDatasets(client: CkanClient, params: FindDatasetsParams = {}): Promise<FindDatasetsAnswer> {
  checkInteger("offset", params.offset, 0, MAX_OFFSET);
  checkInteger("limit", params.limit, 1, MAX_DATASETS);
  const sort = params.sort ?? "relevance";
  checkSort(sort);
  const offset = params.offset ?? 0;
  const limit = params.limit ?? DEFAULT_DATASETS;
  checkFilters(params);
  const site = siteOf(client, params.portal);
  const trace = new Trace();
  const filters = await filterQueriesOf(site, params, trace);
  if ("answer" in filters) return trace.done({ ...filters.answer, portal: portalRef(site), notes: [], total: 0, offset, datasets: [] });
  const searched = { ...filters.searched, ...(sort === "relevance" ? {} : { sort }) };
  const result = await trace.search(site, { q: params.query?.trim(), fq: filters.fq, rows: limit, start: offset, sort: SORTS[sort] });
  const datasets = result.results.filter(isObject).map((d) => hitOf(d, filters.format));
  const answer: FindDatasetsAnswer = { status: "ok", portal: portalRef(site), total: result.count, offset, datasets, searched, notes: [] };
  if (result.count === 0) {
    answer.status = "empty";
    answer.reason = "No dataset matches on this portal. Try fewer or broader words (Solr matches whole words: Radverkehr, not Rad), fewer filters, or another portal (comparePortals counts them all).";
  } else if (datasets.length === 0) {
    answer.status = "empty";
    answer.reason = `The page at offset ${offset} is past the end: ${result.count} datasets match.`;
  }
  if (offset + datasets.length < result.count && datasets.length > 0) answer.nextOffset = offset + datasets.length;
  hitNotes(datasets, answer.notes);
  licenceNotes(site, answer.notes);
  return trace.done(answer);
}

// ---- comparePortals --------------------------------------------------------------------------

/** One portal's count. */
export interface PortalCount {
  id: string;
  title: string;
  url: string;
  /** Datasets matching now; absent when the portal failed. */
  count?: number;
  /** Why the portal could not be counted (HTTP 500, timeout, …). */
  problem?: string;
  /** The national catalogue, which harvests most of the others: never add it to a sum. */
  national?: true;
}

export interface ComparePortalsAnswer extends Omit<AnswerBase, "ambiguous" | "portal"> {
  /** Portals with at least one match. */
  withMatches: number;
  portals: PortalCount[];
}

/** How many portals are asked at once (the server's limiter may allow fewer). */
const COMPARE_CONCURRENCY = 3;

/**
 * How many datasets match a query (and a format) on every portal of the built-in list, or on the
 * ones named, most first: one count request per portal, nothing else. A portal that fails is
 * listed with its problem, not left out. GovData, the national catalogue, harvests most Länder
 * portals: it is marked national and must never be added to the others.
 */
export async function comparePortals(
  client: CkanClient,
  params: { query?: string | undefined; format?: string | undefined; portals?: readonly string[] | undefined } = {},
): Promise<ComparePortalsAnswer> {
  if (params.query !== undefined && params.query.trim() === "") throw new CkanValidationError("Invalid query: expected a non-empty value.");
  const format = params.format === undefined ? undefined : wantedFormat(params.format);
  const portals = params.portals === undefined || params.portals.length === 0 ? [...PORTALS] : [...new Set(params.portals.map((id) => portalById(id)))];
  const searched: Searched = {};
  if (params.query !== undefined) searched["query"] = params.query.trim();
  if (format !== undefined) searched["format"] = format;
  if (params.portals !== undefined && params.portals.length > 0) searched["portals"] = portals.map((p) => p.id);
  const trace = new Trace();
  const search: PackageSearchParams = { q: params.query?.trim(), fq: format === undefined ? undefined : [formatFilter(format)], rows: 0 };
  const sites = portals.map((portal) => siteOf(client, portal.id));
  for (const site of sites) trace.requests.push(`${site.prefix}${actionRequest("package_search", packageSearchQuery(search))}`);
  const counts = await mapLimit(sites, COMPARE_CONCURRENCY, async (site): Promise<PortalCount> => {
    const portal = site.portal as Portal;
    const entry: PortalCount = { id: portal.id, title: portal.title, url: portal.url };
    if (portal.id === "govdata") entry.national = true;
    try {
      entry.count = (await site.client.packageSearch(search)).count;
    } catch (err) {
      if (!(err instanceof CkanError)) throw err;
      entry.problem = problemOf(err);
    }
    return entry;
  });
  counts.sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.id.localeCompare(b.id));
  const withMatches = counts.filter((c) => (c.count ?? 0) > 0).length;
  const answer: ComparePortalsAnswer = { status: withMatches === 0 ? "empty" : "ok", withMatches, portals: counts, searched, notes: [] };
  if (withMatches === 0) answer.reason = "No portal has a matching dataset. Try fewer or broader words (whole words: Radverkehr, not Rad).";
  if (counts.some((c) => c.national === true)) answer.notes.push("govdata is the national catalogue: it harvests most Länder portals and many cities, so its count overlaps the others. Report it apart and never add it to a sum.");
  if (counts.some((c) => c.id === "hamburg" && (c.count ?? 0) > 0)) answer.notes.push("hamburg is the Transparenzportal: most of its records are documents (contracts, decisions, reports), not datasets; type dataset narrows it.");
  const failed = counts.filter((c) => c.problem !== undefined);
  if (failed.length > 0) answer.notes.push(`${failed.length} portal(s) could not be counted now (${failed.map((c) => `${c.id}: ${c.problem}`).join("; ")}): say so; never read a failure as no data.`);
  return trace.done(answer);
}

// ---- countDatasets ---------------------------------------------------------------------------

/** The distributions countDatasets counts, by name, with CKAN's facet field. */
export const FACETS = Object.freeze({
  organization: "organization",
  group: "groups",
  format: "res_format",
  licence: "license_id",
  tag: "tags",
  type: "type",
  documentType: "extras_registerobject_type",
});
export type FacetName = keyof typeof FACETS;

/** Facets whose values are folded (several spellings of one value): all values are read. */
const FOLDED: ReadonlySet<FacetName> = new Set(["format", "licence"]);

export const DEFAULT_FACET_VALUES = 10;
export const MAX_FACET_VALUES = 100;
/** The most years one count spreads over (one request each). */
export const MAX_YEARS = 20;

export interface CountDatasetsParams extends DatasetFilters {
  facets?: readonly FacetName[] | undefined;
  /** Values per facet. */
  limit?: number | undefined;
  /** Count per year from this year … */
  yearFrom?: number | undefined;
  /** … to this one (on dateField: created, or modified). */
  yearTo?: number | undefined;
}

export interface FacetValue {
  /** The value to filter by (a slug, a format, a licence's short name, a tag, a type). */
  value: string;
  /** The readable name, where it differs (an organization's or a group's title, a document type's name). */
  label?: string;
  /** Datasets, not files: a dataset with ten CSV files counts once for CSV. */
  count: number;
  /** The raw values folded into this one. */
  variants?: string[];
  /** The count is a sum over several spellings: a dataset with two of them counts twice. */
  upperBound?: boolean;
}

export interface FacetCounts {
  facet: FacetName;
  values: FacetValue[];
  /** False when there are more values than listed. */
  complete: boolean;
  /** Format values that name no clear format (MIME types, other vocabularies, combined values). */
  other?: { count: number; variants: string[] };
}

export interface CountDatasetsAnswer extends AnswerBase {
  total: number;
  facets: FacetCounts[];
  /** Per year, on the date field, when asked. */
  byYear?: { year: number; count: number }[];
}

const byCount = (a: FacetValue, b: FacetValue): number => b.count - a.count || a.value.localeCompare(b.value);

/** The values of one facet: sorted by count (CKAN doesn't), folded where spellings differ, cut at `limit`. */
function countsOf(facet: FacetName, items: FacetItem[], limit: number): FacetCounts {
  if (!FOLDED.has(facet)) {
    const values = items
      .map((item) => {
        const value: FacetValue = { value: item.name, count: item.count };
        const label = facet === "documentType" ? (DOCUMENT_TYPES[item.name as DocumentType] ?? item.label) : item.label;
        if (label !== undefined && label !== item.name) value.label = label;
        return value;
      })
      .sort(byCount);
    return { facet, values: values.slice(0, limit), complete: values.length <= limit };
  }
  const groups = new Map<string, FacetValue>();
  const other: { count: number; variants: string[] } = { count: 0, variants: [] };
  for (const item of [...items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
    const key = facet === "format" ? formatOf(item.name) : licenceOf(item.name, item.label)?.label;
    if (key === undefined) {
      other.count += item.count;
      if (other.variants.length < 10) other.variants.push(item.name);
      continue;
    }
    const group = groups.get(key) ?? { value: key, count: 0, variants: [] };
    group.count += item.count;
    group.variants?.push(item.name);
    groups.set(key, group);
  }
  const values = [...groups.values()]
    .map((group) => {
      const variants = group.variants ?? [];
      const value: FacetValue = { value: group.value, count: group.count };
      if (variants.length > 1) {
        value.variants = variants;
        value.upperBound = true;
      } else if (variants[0] !== group.value) {
        value.variants = variants;
      }
      return value;
    })
    .sort(byCount);
  const counts: FacetCounts = { facet, values: values.slice(0, limit), complete: values.length <= limit };
  if (facet === "format" && other.count > 0) counts.other = other;
  return counts;
}

/**
 * How many datasets match on one portal, and how they spread over the facets asked for (no
 * datasets fetched), and per year when asked (one count per year on the date field). The values
 * are sorted by count (CKAN sends them unsorted); a format's spellings (CSV, csv, the EU URI) and a
 * licence's (dl-de-by-2.0, dl-by-de/2.0, the URI) are folded into one value, their sum an upper
 * bound; every value of those two is read, so nothing is cut before folding. For the others,
 * complete false says there are more values than listed.
 */
export async function countDatasets(client: CkanClient, params: CountDatasetsParams = {}): Promise<CountDatasetsAnswer> {
  checkInteger("limit", params.limit, 1, MAX_FACET_VALUES);
  checkInteger("yearFrom", params.yearFrom, 1990, 2100);
  checkInteger("yearTo", params.yearTo, 1990, 2100);
  if ((params.yearFrom === undefined) !== (params.yearTo === undefined)) throw new CkanValidationError("Invalid yearFrom/yearTo: give both, or neither.");
  if (params.yearFrom !== undefined && params.yearTo !== undefined && (params.yearTo < params.yearFrom || params.yearTo - params.yearFrom >= MAX_YEARS)) {
    throw new CkanValidationError(`Invalid yearFrom/yearTo: expected yearFrom ≤ yearTo, at most ${MAX_YEARS} years.`);
  }
  const limit = params.limit ?? DEFAULT_FACET_VALUES;
  const facets = [...new Set(params.facets ?? [])];
  for (const facet of facets) {
    if (!(facet in FACETS)) throw new CkanValidationError(`Invalid facet: expected one of ${Object.keys(FACETS).join(", ")}, got ${JSON.stringify(String(facet))}.`);
  }
  checkFilters(params);
  const site = siteOf(client, params.portal);
  const trace = new Trace();
  const filters = await filterQueriesOf(site, params, trace);
  if ("answer" in filters) return trace.done({ ...filters.answer, portal: portalRef(site), notes: [], total: 0, facets: [] });
  const searched: Searched = { ...filters.searched, ...(facets.length > 0 ? { facets } : {}) };
  const base = { q: params.query?.trim(), fq: filters.fq, rows: 0 };
  const folded = facets.filter((f) => FOLDED.has(f));
  const plain = facets.filter((f) => !FOLDED.has(f));
  const results = new Map<FacetName, PackageSearchResult>();
  let total: number | undefined;
  // Folded facets need every value (a cut list can lose one spelling); the others limit + 1, to
  // tell a complete list from a cut one. CKAN takes one facet.limit per request.
  for (const group of [folded, plain]) {
    if (group.length === 0) continue;
    const result = await trace.search(site, { ...base, facet_field: group.map((f) => FACETS[f]), facet_limit: group === folded ? -1 : limit + 1 });
    total ??= result.count;
    for (const facet of group) results.set(facet, result);
  }
  let byYear: { year: number; count: number }[] | undefined;
  if (params.yearFrom !== undefined && params.yearTo !== undefined) {
    const field = `metadata_${params.dateField ?? "created"}`;
    searched["yearFrom"] = params.yearFrom;
    searched["yearTo"] = params.yearTo;
    searched["dateField"] = params.dateField ?? "created";
    byYear = [];
    for (let year = params.yearFrom; year <= params.yearTo; year++) {
      const range = `${field}:[${year}-01-01T00:00:00Z TO ${year + 1}-01-01T00:00:00Z}`;
      const result = await trace.search(site, { ...base, fq: [...filters.fq, range] });
      byYear.push({ year, count: result.count });
    }
  }
  if (total === undefined) total = (await trace.search(site, base)).count;
  const answer: CountDatasetsAnswer = {
    status: total === 0 ? "empty" : "ok",
    portal: portalRef(site),
    total,
    facets: facets.map((facet) => countsOf(facet, facetItems(results.get(facet) as PackageSearchResult, FACETS[facet]), limit)),
    searched,
    notes: [],
  };
  if (byYear !== undefined) answer.byYear = byYear;
  if (total === 0) answer.reason = "No dataset matches on this portal. Try fewer or broader words, or fewer filters.";
  if (facets.length > 0 && total > 0) answer.notes.push("Counts are datasets, not files. One dataset can carry several values, so the counts don't add up to total.");
  if (answer.facets.some((f) => f.values.some((v) => v.upperBound === true))) {
    answer.notes.push("A value with upperBound sums several spellings (CSV and csv, dl-de-by-2.0 and its URI); a dataset with two of them counts twice. For an exact number, count again with format set: total is exact.");
  }
  if (facets.includes("tag") && site.portal?.id === "hamburg") answer.notes.push("Hamburg's tags are often whole keyword lists in one string: a tag ranking there says little.");
  if (facets.includes("documentType")) {
    answer.notes.push(site.portal?.id === "hamburg" ? "A record can carry several document types, so their counts overlap." : "documentType is the Transparenzportal Hamburg's field; other portals have none.");
  }
  if (facets.includes("licence")) licenceNotes(site, answer.notes);
  if (byYear !== undefined) {
    const when = params.dateField === "modified" ? "when the record last changed on the portal" : "when the record entered the portal";
    answer.notes.push(`byYear counts by ${params.dateField ?? "created"} (${when}), not by the date of the data.`);
  }
  return trace.done(answer);
}

// ---- findHamburgDocuments --------------------------------------------------------------------

export const DEFAULT_DOCUMENTS = 10;
export const MAX_DOCUMENTS = 50;
/** The most files listed per document. */
const MAX_FILES_PER_DOCUMENT = 10;

export interface FindHamburgDocumentsParams {
  /** A document type: its index value (gutacht), its German name (Gutachten) or Hamburg's own value. */
  documentType?: string | undefined;
  query?: string | undefined;
  /** An organization slug (allris, workflows, …): many records have none, so it drops them. */
  organization?: string | undefined;
  /** Entered the portal from this day on (YYYY-MM-DD; metadata_created). */
  from?: string | undefined;
  to?: string | undefined;
  /** created (newest first, default), modified, relevance, title. */
  sort?: DatasetSort | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

/** One document of the Transparenzportal. */
export interface HamburgDocument {
  name: string;
  title?: string;
  /** Its document types, by their German names. */
  documentTypes: string[];
  /** The publication date the record names (publishing_date). */
  published?: string;
  /** When it entered the portal (metadata_created). */
  created?: string;
  /** When it leaves the portal (offline_date). */
  offline?: string;
  organization?: string;
  /** The office behind it (author). */
  author?: string;
  description?: string;
  /** The authority's file number. */
  fileReference?: string;
  licence?: Licence;
  attribution?: string;
  /** Files: how many, how many PDFs, their known size. */
  counts: { files: number; pdfs: number; knownBytes: number };
  /** The first files, with their links. */
  files: FileEntry[];
}

export interface FindHamburgDocumentsAnswer extends AnswerBase {
  total: number;
  offset: number;
  documents: HamburgDocument[];
  nextOffset?: number;
}

/** A search hit as a Transparenzportal document. */
function documentOf(dataset: JsonObject): HamburgDocument {
  const extras = extrasOf(dataset);
  const files = objectsOf(dataset["resources"]).map(fileOf).filter((f): f is FileEntry => f !== undefined);
  const doc: HamburgDocument = {
    name: textOf(dataset["name"]) ?? textOf(dataset["id"]) ?? "",
    documentTypes: documentTypesOf(extras.get("registerobject_type")),
    counts: {
      files: files.length,
      pdfs: files.filter((f) => f.format === "PDF" || f.extension === "PDF").length,
      knownBytes: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
    },
    files: files.slice(0, MAX_FILES_PER_DOCUMENT).map(({ id: _id, ...file }) => file),
  };
  const set = <K extends keyof HamburgDocument>(key: K, value: HamburgDocument[K] | undefined): void => {
    if (value !== undefined) doc[key] = value;
  };
  set("title", textOf(dataset["title"]));
  set("published", extras.get("publishing_date"));
  set("created", textOf(dataset["metadata_created"]));
  set("offline", extras.get("offline_date"));
  set("organization", isObject(dataset["organization"]) ? textOf(dataset["organization"]["name"]) : undefined);
  set("author", textOf(dataset["author"]));
  set("description", plainText(textOf(dataset["notes"]), 300));
  set("fileReference", extras.get("file_reference_digital"));
  set("licence", licenceOf(dataset["license_id"], dataset["license_title"]));
  set("attribution", attributionOf(dataset, extras));
  return doc;
}

/**
 * Documents of the Transparenzportal Hamburg (the register the Hamburg Transparency Act requires):
 * by document type (sent as the stemmed value its search index holds, the only one that works),
 * topic and the day they entered the portal, newest first, a page at a time. Each with its
 * publication date, types, office, licence and attribution text, and its files. Always on Hamburg's
 * portal, whatever portal the client talks to.
 */
export async function findHamburgDocuments(client: CkanClient, params: FindHamburgDocumentsParams = {}): Promise<FindHamburgDocumentsAnswer> {
  checkInteger("offset", params.offset, 0, MAX_OFFSET);
  checkInteger("limit", params.limit, 1, MAX_DOCUMENTS);
  const sort = params.sort ?? "created";
  checkSort(sort);
  let type: DocumentType | undefined;
  if (params.documentType !== undefined) {
    type = documentType(params.documentType);
    const more = type === undefined ? documentTypeAndWords(params.documentType) : undefined;
    if (more !== undefined) {
      const query = params.query === undefined ? "" : `, beside ${JSON.stringify(cutText(params.query.trim(), 80))}`;
      throw new CkanValidationError(
        `Invalid documentType: ${JSON.stringify(cutText(params.documentType.trim(), 80))} is more than a type: documentType takes a type alone: give ${JSON.stringify(DOCUMENT_TYPES[more.type])} there and ${JSON.stringify(cutText(more.words, 80))} as query${query}.`,
      );
    }
    if (type === undefined) {
      throw new CkanValidationError(`Invalid documentType: ${JSON.stringify(params.documentType.slice(0, 80))} is none of Hamburg's document types (${Object.values(DOCUMENT_TYPES).join(", ")}).`);
    }
  }
  if (params.organization !== undefined && !/^[a-z0-9_-]{2,100}$/.test(params.organization.trim())) {
    throw new CkanValidationError("Invalid organization: expected a slug such as allris, workflows, hmdklgv, dokrates, statistikamt or stadthamburg.");
  }
  const offset = params.offset ?? 0;
  const limit = params.limit ?? DEFAULT_DOCUMENTS;
  const filters: DatasetFilters = { query: params.query, from: params.from, to: params.to, dateField: "created" };
  const checked = checkFilters(filters);
  const site = siteOf(client, "hamburg");
  const trace = new Trace();
  const searched: Searched = {};
  const fq: string[] = [];
  if (type !== undefined) {
    searched["documentType"] = DOCUMENT_TYPES[type];
    fq.push(`extras_registerobject_type:${type}`);
  }
  if (params.query !== undefined) searched["query"] = params.query.trim();
  if (params.organization !== undefined) {
    searched["organization"] = params.organization.trim();
    fq.push(`organization:${params.organization.trim()}`);
  }
  if (checked.from !== undefined || checked.to !== undefined) {
    if (params.from !== undefined) searched["from"] = params.from.trim();
    if (params.to !== undefined) searched["to"] = params.to.trim();
    fq.push(dateRange("metadata_created", checked.from, checked.to));
  }
  if (sort !== "relevance") searched["sort"] = sort;
  const result = await trace.search(site, { q: params.query?.trim(), fq, rows: limit, start: offset, sort: SORTS[sort] });
  const documents = result.results.filter(isObject).map(documentOf);
  const answer: FindHamburgDocumentsAnswer = { status: "ok", portal: portalRef(site), total: result.count, offset, documents, searched, notes: [] };
  if (result.count === 0) {
    answer.status = "empty";
    answer.reason = "No document matches. Try fewer or broader words, another document type, or a wider date range.";
  } else if (documents.length === 0) {
    answer.status = "empty";
    answer.reason = `The page at offset ${offset} is past the end: ${result.count} documents match.`;
  }
  if (offset + documents.length < result.count && documents.length > 0) answer.nextOffset = offset + documents.length;
  if (params.organization !== undefined) answer.notes.push("Many records have no organization (only about half the contracts and a third of the decisions have one): the organization filter drops the rest. Filter by type and words instead.");
  if (documents.some((d) => d.documentTypes.length > 1)) answer.notes.push("A record can carry several document types, so type counts overlap.");
  answer.notes.push("Licences are set per record (most DL-DE BY 2.0, which asks for the attribution text; some CC0): give each document's own, and quote its attribution when it is reused.");
  return trace.done(answer);
}

// ---- getDataset ------------------------------------------------------------------------------

/** A dataset's slug or id from itself or a link to its page (…/dataset/NAME). */
export function datasetIdFrom(value: string): string {
  const text = value.trim();
  const link = /^https?:\/\/[^/]+\/(?:[^?#]*\/)?(?:dataset|daten)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text);
  if (link === null) return text;
  try {
    return decodeURIComponent(link[1] as string);
  } catch {
    return link[1] as string;
  }
}

export interface DatasetRecord {
  name: string;
  id?: string;
  title?: string;
  type?: string;
  description?: string;
  organization?: { name: string; title?: string };
  author?: string;
  maintainer?: string;
  groups: { name: string; title?: string }[];
  tags: string[];
  modified?: string;
  created?: string;
  /** The publisher's page for it. */
  landingPage?: string;
  /** Its licence, and any other its files name. */
  licences: Licence[];
  attribution?: string;
  /** Selected extras: publication date, document types, temporal coverage, file number, harvest source, publisher. */
  details: Record<string, JsonValue>;
  files: FileEntry[];
}

export interface GetDatasetAnswer extends Omit<AnswerBase, "ambiguous"> {
  dataset?: DatasetRecord;
}

/** Whether CKAN answered "no such dataset" (HTTP 404, or `Not Found Error` with HTTP 200). */
function isNotFound(err: unknown): boolean {
  return (err instanceof CkanApiError && err.status === 404) || (err instanceof CkanActionError && err.errorType === "Not Found Error");
}

/** The extras getDataset names, by their key, under the name it gives them. */
const DETAIL_KEYS: readonly [string, string][] = [
  ["publishing_date", "published"],
  ["offline_date", "offline"],
  ["temporal_coverage_from", "temporalFrom"],
  ["temporal_coverage_to", "temporalTo"],
  ["temporal_start", "temporalFrom"],
  ["temporal_end", "temporalTo"],
  ["file_reference_digital", "fileReference"],
  ["publisher_name", "publisher"],
  ["opennrw_datapublisher", "publisher"],
  ["issued", "issued"],
  ["modified", "sourceModified"],
  ["metadata_harvested_portal", "harvestedFrom"],
  ["metadata_original_portal", "originalPortal"],
  ["contact_email", "contactEmail"],
];

/**
 * One record by its name (slug), id or the link to its page, on one portal: organization, author,
 * groups, tags, dates, licences and attribution, selected details, and every file with its kind,
 * format, size and licence. An unknown name is an empty answer that says where to take one from.
 */
export async function getDataset(client: CkanClient, params: { id: string; portal?: string | undefined }): Promise<GetDatasetAnswer> {
  if (typeof params.id !== "string" || params.id.trim() === "") throw new CkanValidationError("Invalid id: expected a dataset's name, id or the link to its page.");
  const id = datasetIdFrom(params.id);
  const site = siteOf(client, params.portal);
  const trace = new Trace();
  const searched: Searched = { id };
  trace.requests.push(`${site.prefix}${actionRequest("package_show", { id })}`);
  let dataset: JsonObject;
  try {
    dataset = await site.client.packageShow(id);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return trace.done({ status: "empty", portal: portalRef(site), searched, notes: [], reason: `No record is named ${JSON.stringify(id)} on this portal. Take the name (the slug) from a fresh findDatasets answer on the same portal; titles are not names.` });
  }
  const extras = extrasOf(dataset);
  const organization = isObject(dataset["organization"]) ? dataset["organization"] : undefined;
  const files = objectsOf(dataset["resources"]).map(fileOf).filter((f): f is FileEntry => f !== undefined);
  const details: Record<string, JsonValue> = {};
  for (const [key, name] of DETAIL_KEYS) {
    const value = extras.get(key);
    if (value !== undefined && details[name] === undefined) details[name] = excerpt(value, 300) as string;
  }
  const types = documentTypesOf(extras.get("registerobject_type"));
  if (types.length > 0) details["documentTypes"] = types;
  const record: DatasetRecord = {
    name: textOf(dataset["name"]) ?? id,
    groups: objectsOf(dataset["groups"]).flatMap((g) => {
      const name = textOf(g["name"]);
      if (name === undefined) return [];
      const title = textOf(g["title"]) ?? textOf(g["display_name"]);
      return [title === undefined ? { name } : { name, title }];
    }),
    tags: objectsOf(dataset["tags"]).map((t) => textOf(t["name"])).filter((t): t is string => t !== undefined),
    licences: licencesOf(dataset),
    details,
    files,
  };
  const set = <K extends keyof DatasetRecord>(key: K, value: DatasetRecord[K] | undefined): void => {
    if (value !== undefined) record[key] = value;
  };
  set("id", textOf(dataset["id"]));
  set("title", textOf(dataset["title"]));
  set("type", textOf(dataset["type"]));
  set("description", plainText(textOf(dataset["notes"]), 5000));
  const orgName = organization === undefined ? undefined : textOf(organization["name"]);
  if (orgName !== undefined) {
    const orgTitle = textOf(organization?.["title"]);
    record.organization = orgTitle === undefined ? { name: orgName } : { name: orgName, title: orgTitle };
  }
  set("author", textOf(dataset["author"]));
  set("maintainer", textOf(dataset["maintainer"]));
  set("modified", textOf(dataset["metadata_modified"]));
  set("created", textOf(dataset["metadata_created"]));
  set("landingPage", textOf(dataset["url"]) ?? extras.get("metadata_original_html"));
  set("attribution", attributionOf(dataset, extras));
  const answer: GetDatasetAnswer = { status: "ok", portal: portalRef(site), dataset: record, searched, notes: [] };
  if (files.length === 0) answer.notes.push("This record has no files with a link (metadata only): see landingPage.");
  const odd = [...new Set(files.filter((f) => !FETCHABLE.has(f.kind)).map((f) => f.kind))];
  if (odd.length > 0) answer.notes.push(`Not every link is a file (${odd.join(", ")}): only kind file and generated can be fetched; name the others as what they are.`);
  if (record.licences.length === 0) answer.notes.push("No licence is stated: say so, never assume one; the publisher's page may.");
  else if (record.licences.length > 1) answer.notes.push("The record and its files name different licences: give each file's own.");
  if (record.licences.some((l) => l.open === false)) answer.notes.push("A licence here is not open (open false): say so.");
  licenceNotes(site, answer.notes);
  return trace.done(answer);
}

// ---- listOrganizations -----------------------------------------------------------------------

export interface ListOrganizationsAnswer extends Omit<AnswerBase, "ambiguous"> {
  kind: "organization" | "group";
  /** Organizations (or groups) with datasets on the portal (all, not only those listed). */
  total: number;
  organizations: OrganizationEntry[];
}

/**
 * A portal's organizations (publishers), or its groups (themes), most datasets first, with their
 * slugs for the filters; with a name, those whose slug or title contains it. Counted from the
 * search's facet, so only those with datasets.
 */
export async function listOrganizations(
  client: CkanClient,
  params: { portal?: string | undefined; kind?: "organization" | "group" | undefined; name?: string | undefined } = {},
): Promise<ListOrganizationsAnswer> {
  if (params.name !== undefined && params.name.trim() === "") throw new CkanValidationError("Invalid name: expected a non-empty value.");
  const kind = params.kind ?? "organization";
  if (kind !== "organization" && kind !== "group") throw new CkanValidationError(`Invalid kind: expected organization or group, got ${JSON.stringify(String(kind))}.`);
  const site = siteOf(client, params.portal);
  const trace = new Trace();
  const all = await entriesOf(site, kind === "group" ? "groups" : "organization", trace);
  const searched: Searched = { kind, ...(params.name === undefined ? {} : { name: params.name.trim() }) };
  const organizations = params.name === undefined ? all : matchEntries(all, params.name).matches;
  const answer: ListOrganizationsAnswer = { status: "ok", portal: portalRef(site), kind, total: all.length, organizations, searched, notes: [] };
  if (organizations.length === 0) {
    answer.status = "empty";
    answer.reason =
      all.length === 0
        ? `This portal lists no ${kind === "group" ? "groups" : "organizations"} with datasets.`
        : `No ${kind} is named or contains ${JSON.stringify(params.name?.trim())}. The office behind a record is often only its author: search for it as words.`;
  }
  if (kind === "organization" && site.portal?.id === "hamburg") answer.notes.push("On Hamburg many records have no organization at all (the office is the author): the counts cover only those that have one.");
  return trace.done(answer);
}
