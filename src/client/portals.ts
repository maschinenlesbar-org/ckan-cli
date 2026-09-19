// Known CKAN portals: lookup and a short live check. The list itself is in
// portals-list.ts, maintained with scripts/update-portals.ts.

import { siteRoot, type CkanClient } from "./client.js";
import { CkanApiError, CkanNetworkError, CkanParseError } from "./errors.js";
import type { Portal } from "./types.js";

/**
 * One identity per portal, whatever form its URL was written in: host (without
 * `www.`) plus path, lower-cased, without scheme, trailing slash or a pasted
 * `/api/3/action` suffix. `https://www.daten-bw.de/ckan` → `daten-bw.de/ckan`.
 */
export function portalKey(url: string): string {
  const parsed = new URL(siteRoot(url));
  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  return `${host}${path}`;
}

/** A portal from `list` by its id (any case) or by any form of its URL. */
export function findPortal(idOrUrl: string, list: readonly Portal[]): Portal | undefined {
  const wanted = idOrUrl.trim().toLowerCase();
  const byId = list.find((p) => p.id.toLowerCase() === wanted);
  if (byId) return byId;
  let key: string;
  try {
    key = portalKey(idOrUrl);
  } catch {
    return undefined; // not a URL either
  }
  return list.find((p) => portalKey(p.url) === key);
}

/** The outcome of `checkPortal`. */
export interface PortalCheck {
  working: boolean;
  /** A short reason when not working, e.g. `HTTP 404`, `host not found`. */
  problem: string | null;
  datasets: number | null;
  /** From `status_show`, which some portals lock (Berlin): then null. */
  ckanVersion: string | null;
  siteTitle: string | null;
  siteUrl: string | null;
}

/**
 * A short live check of the CKAN portal a client points at. It works when `package_search?rows=0`
 * answers with a CKAN envelope; `status_show` is then asked for the version and
 * site URL, and a failure there (Berlin answers 403) does not count against it.
 * Never throws: a failure is described in `problem`.
 */
export async function checkPortal(client: CkanClient): Promise<PortalCheck> {
  const result: PortalCheck = {
    working: false,
    problem: null,
    datasets: null,
    ckanVersion: null,
    siteTitle: null,
    siteUrl: null,
  };
  try {
    const search = await client.packageSearch({ rows: 0 });
    result.working = true;
    result.datasets = typeof search.count === "number" ? search.count : null;
    try {
      const status = await client.status();
      result.ckanVersion = typeof status.ckan_version === "string" ? status.ckan_version : null;
      result.siteTitle = typeof status.site_title === "string" && status.site_title !== "" ? status.site_title : null;
      result.siteUrl = typeof status.site_url === "string" && status.site_url !== "" ? status.site_url : null;
    } catch {
      // status_show is optional.
    }
  } catch (err) {
    result.problem = problemOf(err);
  }
  return result;
}

/** A short, stable reason for a failed check. */
function problemOf(err: unknown): string {
  if (err instanceof CkanApiError) {
    return err.detail?.startsWith("stopped after") ? "redirect loop" : `HTTP ${err.status}`;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof CkanParseError) {
    const got = /but got (.+)$/.exec(message);
    if (got) return `not JSON (${got[1]})`;
    if (/not a CKAN Action API response/.test(message)) return "not a CKAN Action API";
    return "invalid JSON";
  }
  if (err instanceof CkanNetworkError) {
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
    if (code === "ECONNREFUSED") return "connection refused";
    if (code === "ECONNRESET") return "connection reset";
    if (/certificate|CERT|SELF_SIGNED/i.test(`${String(code)} ${message}`)) return "TLS certificate not verifiable";
    if (/timed out|deadline/.test(message)) return "timeout";
  }
  return message.slice(0, 80);
}

/**
 * A portal entry updated with a check made on `date` (`YYYY-MM-DD`). A failed
 * check keeps the last known version and dataset count, so an entry that is down
 * still shows what it last served.
 */
export function withCheck(portal: Portal, check: PortalCheck, date: string): Portal {
  return {
    ...portal,
    working: check.working,
    checked: date,
    problem: check.problem,
    ckanVersion: check.ckanVersion ?? portal.ckanVersion,
    datasets: check.datasets ?? portal.datasets,
  };
}

/** Run `fn` over `items` with at most `limit` calls in flight; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
