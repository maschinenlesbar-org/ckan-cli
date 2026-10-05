// Known CKAN portals: lookup and a short live check. The list itself is in
// portals-list.ts, maintained with scripts/update-portals.ts.

import { CkanClient, siteRoot } from "./client.js";
import type { EngineOptions } from "./engine.js";
import { CkanApiError, CkanNetworkError, CkanParseError, CkanValidationError } from "./errors.js";
import { PORTALS } from "./portals-list.js";
import type { Portal } from "./types.js";
import { assertValid, intRangeProblem } from "./validate.js";

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
  if (typeof idOrUrl !== "string") throw new CkanValidationError("Invalid portal: Expected a string.");
  if (!Array.isArray(list)) throw new CkanValidationError("Invalid portal list: Expected an array.");
  const wanted = idOrUrl.trim().toLowerCase();
  const byId = list.find((p) => p.id.toLowerCase() === wanted);
  if (byId) return byId;
  let key: string;
  try {
    key = portalKey(idOrUrl.trim());
  } catch {
    return undefined; // not a URL either
  }
  return list.find((p) => {
    try {
      return portalKey(p.url) === key;
    } catch {
      return false; // an entry without a usable url matches nothing
    }
  });
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

/**
 * The first error `code` (`ENOTFOUND`, `ECONNREFUSED`, …) along a cause chain: the
 * engine wraps a transport failure in a CkanNetworkError that names the request, so
 * Node's code sits one or more levels down.
 */
function errorCode(cause: unknown, depth = 0): unknown {
  if (typeof cause !== "object" || cause === null || depth > 5) return undefined;
  const code = (cause as { code?: unknown }).code;
  return code !== undefined ? code : errorCode((cause as { cause?: unknown }).cause, depth + 1);
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
    if (/^Unexpected response shape/.test(message)) return "unexpected response shape";
    return "invalid JSON";
  }
  if (err instanceof CkanNetworkError) {
    const code = errorCode(err.cause);
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "host not found";
    if (code === "ECONNREFUSED") return "connection refused";
    if (code === "ECONNRESET") return "connection reset";
    if (/certificate|CERT|SELF_SIGNED/i.test(`${String(code)} ${message}`)) return "TLS certificate not verifiable";
    if (/timed out|deadline/.test(message)) return "timeout";
    // The engine's "GET <url> failed: <reason>": the reason is what tells portals apart.
    const reason = /^[A-Z]+ \S+ failed: (.+)$/.exec(message)?.[1];
    if (reason !== undefined) return reason.slice(0, 80);
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

/** How many portals `checkPortals` / `checkPortalUrls` check at once by default. */
export const DEFAULT_CHECK_CONCURRENCY = 6;

/** Options for `checkPortalUrls` and `checkPortals`. */
export interface CheckPortalsOptions {
  /** Client options for every check; `baseUrl` is replaced by each portal's URL. */
  engineOptions?: EngineOptions;
  /** Builds the client for one portal. Defaults to `new CkanClient(options)`. */
  createClient?: (options: EngineOptions) => CkanClient;
  /** Checks in flight at once, 1 or more. Defaults to `DEFAULT_CHECK_CONCURRENCY` (6). */
  concurrency?: number;
  /**
   * When set, a failed check is repeated once after this pause (ms), so one
   * timeout does not count as down. Unset (the default): a single try.
   */
  retryDelayMs?: number;
  /** Injectable sleep for the retry pause, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check the CKAN portals at `urls` live (`checkPortal`), with at most
 * `concurrency` checks in flight; results keep the input order. Never throws for
 * one portal: a URL the client refuses becomes a failed check too. Rejects with
 * CkanValidationError for a bad `concurrency` or `retryDelayMs`, before any request.
 */
export async function checkPortalUrls(urls: readonly string[], options: CheckPortalsOptions = {}): Promise<PortalCheck[]> {
  if (!Array.isArray(urls)) throw new CkanValidationError("Invalid urls: Expected an array.");
  const concurrency = assertValid(
    "concurrency",
    options.concurrency ?? DEFAULT_CHECK_CONCURRENCY,
    intRangeProblem(1, Number.MAX_SAFE_INTEGER),
  );
  const { retryDelayMs } = options;
  if (retryDelayMs !== undefined) assertValid("retryDelayMs", retryDelayMs, intRangeProblem(0, Number.MAX_SAFE_INTEGER));
  const createClient = options.createClient ?? ((engine: EngineOptions) => new CkanClient(engine));
  const sleep = options.sleep ?? realSleep;
  return mapLimit(urls, concurrency, async (url) => {
    let client: CkanClient;
    try {
      client = createClient({ ...options.engineOptions, baseUrl: url });
    } catch (err) {
      return { ...failedCheck(), problem: problemOf(err) };
    }
    const first = await checkPortal(client);
    if (first.working || retryDelayMs === undefined) return first;
    await sleep(retryDelayMs);
    return checkPortal(client);
  });
}

/**
 * Check every portal in `portals` (the built-in list by default) live and fold
 * each result into the entry (`withCheck`), dated `date` (default: today, UTC).
 * What `ckan portals --check` prints.
 */
export async function checkPortals(
  portals: readonly Portal[] = PORTALS,
  options: CheckPortalsOptions & { date?: string } = {},
): Promise<Portal[]> {
  if (!Array.isArray(portals)) throw new CkanValidationError("Invalid portals: Expected an array.");
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const checks = await checkPortalUrls(portals.map((p) => p.url), options);
  return portals.map((portal, i) => withCheck(portal, checks[i]!, date));
}

function failedCheck(): PortalCheck {
  return { working: false, problem: null, datasets: null, ckanVersion: null, siteTitle: null, siteUrl: null };
}
