// The pure part of scripts/update-portals.ts: turning the three upstream lists into
// candidate portal URLs, and merging checked candidates into the built-in list.
// No I/O here, so all of it is unit-tested (test/portal-sources.test.ts).

import { portalKey, withCheck, type PortalCheck } from "../src/client/portals.js";
import type { Portal, PortalSource } from "../src/client/types.js";

/** A URL that may be the site root of a CKAN portal, and where it came from. */
export interface Candidate {
  url: string;
  title: string | null;
  source: PortalSource;
}

/** An http(s) URL on a public host name (never localhost, an IP address or a .local name). */
export function isPublicUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
}

/**
 * Parse a URL from upstream data, or null when it is not a public http(s) URL.
 * `http:` is upgraded to `https:`: every working portal found so far serves (or
 * redirects to) https, and the list should hold the URL that is actually used.
 */
function parsePublic(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!isPublicUrl(url)) return null;
    if (url.protocol === "http:") url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

/** A site root without trailing slash: in front of an `/api` segment if there is one. */
function siteOf(url: URL): string {
  return rootBeforeApi(url) ?? `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * The site root in front of an `/api/…` path (`https://host/ckan/api/3/action/x` →
 * `https://host/ckan`), or null when the URL has no `/api` segment.
 */
function rootBeforeApi(url: URL): string | null {
  const at = url.pathname.search(/\/api(\/|$)/);
  if (at === -1) return null;
  return `${url.origin}${url.pathname.slice(0, at)}`.replace(/\/+$/, "");
}

/** Candidates in order, without two of the same portal. */
function unique(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = portalKey(c.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The Wikidata query: open-data portals (Q27031827, or a subclass) in Germany, with
 * their API endpoint (P6269) and website (P856).
 */
export const WIKIDATA_QUERY = `SELECT ?portal ?portalLabel ?endpoint ?website WHERE {
  ?portal wdt:P31/wdt:P279* wd:Q27031827; wdt:P17 wd:Q183.
  OPTIONAL { ?portal wdt:P6269 ?endpoint }
  OPTIONAL { ?portal wdt:P856 ?website }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
}`;

/**
 * Candidates from a Wikidata SPARQL JSON answer to WIKIDATA_QUERY: per portal, the
 * site root of an API endpoint with an `/api` segment, and the website's origin.
 */
export function wikidataCandidates(json: unknown): Candidate[] {
  const bindings = (json as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(bindings)) return [];
  const out: Candidate[] = [];
  for (const row of bindings as Record<string, { value?: unknown } | undefined>[]) {
    const label = row["portalLabel"]?.value;
    const title = typeof label === "string" && label !== "" ? label : null;
    const perRow: Candidate[] = [];
    const endpoint = parsePublic(row["endpoint"]?.value);
    const root = endpoint ? rootBeforeApi(endpoint) : null;
    if (root) perRow.push({ url: root, title, source: "wikidata" });
    const website = parsePublic(row["website"]?.value);
    if (website) perRow.push({ url: website.origin, title, source: "wikidata" });
    out.push(...unique(perRow));
  }
  return out;
}

/**
 * Candidates from the CKAN project's instance registry (ckan/ckan-instances,
 * `config/instances.json`): the German entries, by `url-api` when given (it is a
 * site root, sometimes with an `/api` path), else by `url`.
 */
export function ckanInstancesCandidates(json: unknown): Candidate[] {
  if (!Array.isArray(json)) return [];
  const out: Candidate[] = [];
  for (const entry of json as Record<string, unknown>[]) {
    if (typeof entry?.["location"] !== "string" || !/\bGermany\b/.test(entry["location"])) continue;
    const url = parsePublic(entry["url-api"]) ?? parsePublic(entry["url"]);
    if (!url) continue;
    const title = typeof entry["title"] === "string" && entry["title"] !== "" ? entry["title"] : null;
    out.push({ url: siteOf(url), title, source: "ckan-instances" });
  }
  return unique(out);
}

/** The query that lists GovData's harvest sources (the `harvest_source_list` action is locked). */
export const HARVEST_QUERY = { fq: "dataset_type:harvest", rows: 1000 } as const;

/**
 * Candidates from GovData's harvest sources (a `package_search` result for
 * HARVEST_QUERY). Each source is a DCAT feed URL, which says where a portal is but
 * not where its CKAN is, so each feed gives two guesses: the feed's directory (in
 * front of an `/api` segment if it has one), then its origin.
 */
export function harvestCandidates(result: unknown): Candidate[] {
  const results = (result as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Candidate[] = [];
  for (const source of results as Record<string, unknown>[]) {
    const feed = parsePublic(source?.["url"]);
    if (!feed) continue;
    const org = (source["organization"] as { title?: unknown } | null | undefined)?.title;
    const own = source["title"];
    const title = typeof org === "string" && org !== "" ? org : typeof own === "string" && own !== "" ? own : null;
    const directory = rootBeforeApi(feed) ?? `${feed.origin}${feed.pathname.replace(/\/[^/]*$/, "")}`;
    out.push({ url: directory, title, source: "govdata-harvest" });
    out.push({ url: feed.origin, title, source: "govdata-harvest" });
  }
  return unique(out);
}

/** Host and path words that say "open data portal" and nothing about which one. */
const GENERIC = new Set([
  "www", "open", "opendata", "open-data", "offenedaten", "offene-daten", "daten", "data",
  "datenregister", "register", "suche", "transparenz", "portal", "ckan", "katalog",
  "catalog", "api", "dcat", "dcatap",
]);

/** A lower-case slug of one host or path word; a generic prefix (`daten-bw`) is dropped. */
function slug(word: string): string {
  const plain = word
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dash = plain.indexOf("-");
  if (dash > 0 && GENERIC.has(plain.slice(0, dash))) return plain.slice(dash + 1);
  return plain;
}

/**
 * A short id for `--portal`, from the host (without the TLD) and path, leaving
 * out generic words: `suche.transparenz.hamburg.de` → `hamburg`. When nothing is
 * left, the TLD is used (`open.nrw` → `nrw`). A taken id gets `-2`, `-3`, ….
 */
export function portalId(url: string, taken: ReadonlySet<string>): string {
  const parsed = new URL(url);
  const labels = parsed.hostname.split(".");
  const tld = labels.pop() ?? "";
  const words = [...labels, ...parsed.pathname.split("/")]
    .map(slug)
    .filter((w) => w !== "" && !GENERIC.has(w));
  const base = words.join("-") || slug(tld) || "portal";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** What `mergePortals` combines. */
export interface MergeInput {
  /** The list as it is (read from src/client/portals-list.ts). */
  existing: readonly Portal[];
  /** A fresh check of each existing entry, in the same order. */
  existingChecks: readonly PortalCheck[];
  /** Every candidate from every upstream list. */
  candidates: readonly Candidate[];
  /** Checks of the candidates that are not in the list yet, by `portalKey`. */
  candidateChecks: ReadonlyMap<string, PortalCheck>;
  /** The check date, `YYYY-MM-DD`. */
  today: string;
}

export interface MergeResult {
  /** The new list, sorted by id. */
  portals: Portal[];
  /** Entries that were not in the list before. */
  added: Portal[];
  /** Candidates that failed their check, one per portal. */
  rejected: { url: string; problem: string | null }[];
}

/** Sources in a fixed order, so a rerun does not reorder them. */
const SOURCE_ORDER: readonly PortalSource[] = ["curated", "wikidata", "ckan-instances", "govdata-harvest"];

function withSources(portal: Portal, more: readonly Candidate[]): Portal {
  const all = new Set<PortalSource>([...portal.sources, ...more.map((c) => c.source)]);
  return { ...portal, sources: SOURCE_ORDER.filter((s) => all.has(s)) };
}

function keyOrNull(url: string | null): string | null {
  if (url === null) return null;
  try {
    return portalKey(url);
  } catch {
    return null;
  }
}

/**
 * Merge checked candidates into the list. Existing entries are always kept: they
 * take the fresh check (a failing one keeps the last known version and count, see
 * `withCheck`) and the tags of every list that names them. A new candidate is
 * added only when its check passed. A portal is often listed under several URLs
 * (`www.govdata.de/ckan` and `ckan.govdata.de`); a candidate whose `status_show`
 * names the `site_url` of another entry or candidate is folded into that one.
 */
export function mergePortals(input: MergeInput): MergeResult {
  const portals = input.existing.map((p, i) => {
    const check = input.existingChecks[i];
    return check ? withCheck(p, check, input.today) : { ...p };
  });
  const existingAt = new Map(portals.map((p, i) => [portalKey(p.url), i]));

  const groups = new Map<string, Candidate[]>();
  for (const c of input.candidates) {
    const key = keyOrNull(c.url);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const rejected: MergeResult["rejected"] = [];
  const working: { key: string; candidates: Candidate[]; check: PortalCheck }[] = [];
  for (const [key, candidates] of groups) {
    const at = existingAt.get(key);
    if (at !== undefined) {
      portals[at] = withSources(portals[at]!, candidates);
      continue;
    }
    const check = input.candidateChecks.get(key);
    if (!check?.working) {
      rejected.push({ url: candidates[0]!.url, problem: check?.problem ?? "not checked" });
      continue;
    }
    working.push({ key, candidates, check });
  }

  // Fold aliases: into an existing entry, or into the new candidate its site_url names.
  const workingKeys = new Set(working.map((w) => w.key));
  const fresh = new Map<string, { url: string | null; candidates: Candidate[]; check: PortalCheck }>();
  for (const w of working) {
    const siteKey = keyOrNull(w.check.siteUrl);
    let target = w.key;
    if (siteKey !== null && siteKey !== w.key) {
      const at = existingAt.get(siteKey);
      if (at !== undefined) {
        portals[at] = withSources(portals[at]!, w.candidates);
        continue;
      }
      if (workingKeys.has(siteKey)) target = siteKey;
    }
    const group = fresh.get(target) ?? { url: null, candidates: [], check: w.check };
    group.candidates.push(...w.candidates);
    if (w.key === target) {
      group.url = w.candidates[0]!.url;
      group.check = w.check;
    }
    fresh.set(target, group);
  }

  const taken = new Set(portals.map((p) => p.id));
  const added: Portal[] = [];
  for (const group of fresh.values()) {
    const url = group.url ?? group.candidates[0]!.url;
    const title =
      group.candidates.find((c) => c.url === url && c.title)?.title ??
      group.candidates.find((c) => c.title)?.title ??
      group.check.siteTitle ??
      new URL(url).host;
    const id = portalId(url, taken);
    taken.add(id);
    const blank: Portal = {
      id, title, url, sources: [], working: false, checked: null,
      problem: null, ckanVersion: null, datasets: null, note: null,
    };
    const portal = withSources(withCheck(blank, group.check, input.today), group.candidates);
    added.push(portal);
    portals.push(portal);
  }

  portals.sort((a, b) => a.id.localeCompare(b.id));
  return { portals, added, rejected };
}

/** The fields of a list entry, and the type check each must pass. */
const FIELDS: Record<keyof Portal, (v: unknown) => boolean> = {
  id: (v) => typeof v === "string" && v !== "",
  title: (v) => typeof v === "string" && v !== "",
  url: (v) => typeof v === "string" && v !== "",
  sources: (v) => Array.isArray(v) && v.every((s) => SOURCE_ORDER.includes(s as PortalSource)),
  working: (v) => typeof v === "boolean",
  checked: (v) => v === null || typeof v === "string",
  problem: (v) => v === null || typeof v === "string",
  ckanVersion: (v) => v === null || typeof v === "string",
  datasets: (v) => v === null || typeof v === "number",
  note: (v) => v === null || typeof v === "string",
};

/** Where the JSON list sits in the list file: after `PORTALS … frozen(`, up to the final `);`. */
function listBounds(text: string): { start: number; end: number } {
  const at = text.indexOf("export const PORTALS");
  const call = at === -1 ? -1 : text.indexOf("frozen(", at);
  const end = text.lastIndexOf(");");
  if (call === -1 || end < call) throw new Error("PORTALS = frozen([...]) not found in the list file");
  return { start: call + "frozen(".length, end };
}

/**
 * The entries of src/client/portals-list.ts. The script rewrites that file, so its
 * list is plain JSON; a hand edit has to keep that form and every field, or this
 * throws and nothing is overwritten.
 */
export function readPortalsSource(text: string): Portal[] {
  const { start, end } = listBounds(text);
  const list: unknown = JSON.parse(text.slice(start, end));
  if (!Array.isArray(list)) throw new Error("PORTALS is not a list");
  list.forEach((item, i) => {
    const fields = Object.keys(FIELDS) as (keyof Portal)[];
    const keys = typeof item === "object" && item !== null ? Object.keys(item) : [];
    for (const field of fields) {
      if (!FIELDS[field]((item as Record<string, unknown>)[field])) {
        throw new Error(`PORTALS[${i}]: "${field}" is missing or has the wrong type`);
      }
    }
    const extra = keys.filter((k) => !(fields as string[]).includes(k));
    if (extra.length > 0) throw new Error(`PORTALS[${i}]: unknown field(s) ${extra.join(", ")}`);
  });
  return list as Portal[];
}

/** The list file with its JSON list replaced by `portals`; everything else stays. */
export function renderPortalsSource(text: string, portals: readonly Portal[]): string {
  const { start, end } = listBounds(text);
  return `${text.slice(0, start)}${JSON.stringify(portals, null, 2)}${text.slice(end)}`;
}
