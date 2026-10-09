// CkanClient — a typed client over the open (no-auth) read endpoints of any CKAN
// Action API (`<site>/api/3/action`).

import { DEFAULT_BASE_URL, RequestEngine, sanitizeServerText, validateBaseUrl, type EngineOptions } from "./engine.js";
import { CkanError, CkanParseError, CkanValidationError, cutForMessage, describeCkanError, redactUrl } from "./errors.js";
import type { QueryParams } from "./query.js";
import {
  assertValid,
  blankProblem,
  countProblem,
  facetLimitProblem,
  queryValueProblem,
  textListProblem,
  textProblem,
} from "./validate.js";
import type {
  CkanEnvelope,
  Group,
  GroupListParams,
  JsonValue,
  License,
  ListParams,
  Organization,
  Package,
  PackageSearchParams,
  PackageSearchResult,
  Resource,
  Status,
  TagListParams,
} from "./types.js";

const ACTION = "/api/3/action";

/**
 * CKAN action names are always `[a-z0-9_]+`. Restricting to that allowlist closes
 * the path-traversal hole (`../../..` escaping `/api/3/action/`) and the
 * query/fragment-injection hole (a `?`/`#` in the name corrupting the query) for
 * both the library and the CLI's generic `action` command.
 */
const ACTION_NAME = /^[a-z0-9_]+$/;

/** CKAN's default cap on an `all_fields` organization/group list. */
const ALL_FIELDS_PAGE = 25;

/**
 * Most pages one `all_fields` list call requests (10,000 entries at CKAN's page size
 * of 25). Real CKAN portals list a few hundred organizations or groups at most; a
 * server whose pages keep returning new entries (a broken or hostile one) would
 * otherwise be paged forever. Past it the call fails with a CkanParseError naming it.
 */
export const MAX_ALL_FIELDS_PAGES = 400;

/**
 * Pause between two `all_fields` pages, in milliseconds. A long list costs a few
 * tenths of a second more; a server that never ends the list gets 10 requests a
 * second at most instead of thousands.
 */
export const ALL_FIELDS_PAGE_DELAY_MS = 100;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A key for a list entry — its `id`, else its JSON — to drop duplicates across pages. */
function entryKey(entry: JsonValue): string {
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const id = entry["id"];
    if (typeof id === "string") return `id:${id}`;
  }
  return JSON.stringify(entry);
}

/**
 * Drop undefined values so only the parameters the caller actually set are sent,
 * and refuse a blank parameter name, a blank value or a list with a blank entry
 * (CkanValidationError). CKAN reads an empty parameter as "not given", so a blank
 * filter such as `tagList({ query: "" })` would silently return everything.
 */
function prune(params: QueryParams): QueryParams {
  assertParams(params);
  // A null-prototype object, so a `__proto__` key is kept as a parameter instead
  // of setting the prototype (and being lost).
  const out = Object.create(null) as QueryParams;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    assertValid("parameter name", k, blankProblem);
    // A value the query string can't carry (an object, NaN, a function) is refused,
    // not sent as "[object Object]" or "NaN".
    out[k] = assertValid(k, v, queryValueProblem);
  }
  return out;
}

/**
 * A method's parameter object: a plain object (or undefined, for the defaults).
 * `null`, a string or an array would otherwise fail as a raw TypeError.
 */
function assertParams(params: unknown): void {
  if (params === undefined) return;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new CkanValidationError("Invalid params: Expected an object.");
  }
}

/**
 * Throw CkanValidationError unless every own key of `params` is in `known`. CKAN
 * ignores a parameter it doesn't know, so a misspelled `fqs` or a JSON `__proto__`
 * key would run the search unfiltered over the whole catalogue. Any other CKAN
 * parameter goes through `action(name, params)`, which sends every key.
 */
function assertKeys(method: string, action: string, params: object, known: readonly string[]): void {
  for (const key of Object.keys(params)) {
    if (!known.includes(key)) {
      throw new CkanValidationError(
        `Invalid ${method} parameter ${JSON.stringify(cutForMessage(key))}: not a parameter of ${method}. ` +
          `Known: ${known.join(", ")}. Use action("${action}", params) to send another CKAN parameter.`,
      );
    }
  }
}

const SEARCH_KEYS = ["q", "fq", "rows", "start", "sort", "facet_field", "facet_limit"] as const;
const PACKAGE_LIST_KEYS = ["limit", "offset"] as const;
const GROUP_LIST_KEYS = ["limit", "offset", "all_fields"] as const;
const TAG_LIST_KEYS = ["query"] as const;

/** Check an optional text parameter (`q`, `sort`, a tag query): a non-blank string. */
function assertText(name: string, value: unknown): void {
  if (value !== undefined) assertValid(name, value, textProblem);
}

/** A JSON object (not null, not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `package_search` result: an object with a numeric count and a results array. */
function isSearchResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  const count = value["count"];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && Array.isArray(value["results"]);
}

/** The error for a `result` that does not have the shape the caller relies on. */
function shapeError(name: string, expected: string): CkanParseError {
  return new CkanParseError(`Unexpected response shape from ${ACTION}/${name}: expected ${expected}.`);
}

/**
 * Check a `*_list` limit. CKAN reads `limit=0` as "no limit" (a whole catalogue,
 * 245,893 names on Hamburg), while the `all_fields` pager would read it as "no
 * entries"; so 0, like any non-positive or fractional value, is refused. To get
 * the whole list, leave the limit out.
 */
function assertLimit(limit: number | undefined): void {
  if (limit === undefined) return;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new CkanValidationError(
      `Invalid limit: expected a positive integer, got ${String(limit)}. Leave it out for the whole list.`,
    );
  }
}

/** Check an optional count or offset (`rows`, `start`, `offset`): see countProblem. */
function assertCount(name: string, value: number | undefined): void {
  if (value !== undefined) assertValid(name, value, countProblem);
}

/**
 * The site root of a CKAN instance, from what a user is likely to paste: portals
 * document their API as `<site>/api/3/action`, so that suffix (or `/api/3`) is
 * dropped. A CKAN mounted under a sub-path (`https://host/ckan`) keeps it.
 * A base URL that breaks the rules of `validateBaseUrl` (blank, whitespace, not
 * an http(s) URL, a query string or fragment) throws CkanValidationError.
 */
export function siteRoot(baseUrl: string): string {
  // Checked before the suffix strip: a trailing space would hide the suffix from it.
  return validateBaseUrl(baseUrl).replace(/\/api\/3(\/action)?$/, "");
}

export class CkanClient {
  // Real private fields (not TypeScript's `private`): console.log, util.inspect and
  // JSON.stringify of a client never show them, so a password in the base URL can't
  // be logged by accident.
  readonly #engine: RequestEngine;
  /** The site this client talks to, for error messages (always through redactUrl). */
  readonly #site: string;
  /** The pause between `all_fields` pages (EngineOptions.sleep, for tests). */
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.#site = siteRoot(options.baseUrl ?? DEFAULT_BASE_URL);
    // The engine checks every option, `sleep` included, before the client uses it.
    this.#engine = new RequestEngine({ ...options, baseUrl: this.#site });
    this.#sleep = options.sleep ?? realSleep;
  }

  /** Call any CKAN action by name and return its unwrapped `result`. */
  async action<T = JsonValue>(name: string, params: QueryParams = {}): Promise<T> {
    if (typeof name !== "string" || !ACTION_NAME.test(name)) {
      throw new CkanValidationError(`Invalid CKAN action name: "${cutForMessage(typeof name === "string" ? name : String(name))}"`);
    }
    const env = await this.#engine.getJson<CkanEnvelope<T> | null>(`${ACTION}/${name}`, prune(params));
    // Another JSON API at the same path (or a proxy's JSON error page) is not an
    // envelope; say so rather than "failed: undefined".
    if (typeof env !== "object" || env === null || Array.isArray(env) || typeof env.success !== "boolean") {
      throw new CkanParseError(
        `The answer to "${cutForMessage(name)}" is not a CKAN Action API response; is ${redactUrl(this.#site)} a CKAN site?`,
      );
    }
    if (!env.success) {
      // A success:false envelope can come with HTTP 200, so it never passes the
      // engine's error-detail sanitising: strip terminal controls here too.
      throw new CkanError(
        `CKAN action "${cutForMessage(name)}" failed: ${cutForMessage(sanitizeServerText(this.#engine.scrub(describeCkanError(env.error))))}`,
      );
    }
    // `{"success": true}` without a result would print nothing useful (and the CLI
    // would crash rendering `undefined`); CKAN always sends one, `null` included.
    if (env.result === undefined) throw shapeError(name, "a result in the envelope");
    return env.result as T;
  }

  /**
   * An action whose `result` must have a known top-level shape (never a deep
   * schema): a broken or foreign answer becomes a CkanParseError naming the
   * action, not a TypeError further down (`page is not iterable`).
   */
  private async typed<T>(
    name: string,
    params: QueryParams,
    ok: (value: unknown) => boolean,
    expected: string,
  ): Promise<T> {
    const result = await this.action<unknown>(name, params);
    if (!ok(result)) throw shapeError(name, expected);
    return result as T;
  }

  /** Site title, CKAN version and enabled extensions of the portal. */
  status(): Promise<Status> {
    return this.typed<Status>("status_show", {}, isObject, "a JSON object");
  }

  /**
   * Full-text / faceted dataset search.
   *
   * CKAN reads a repeated `fq=` key as a Python list and pastes it into the Solr
   * filter, which fails with HTTP 409. So a single filter is sent as `fq`, and
   * several as CKAN's `fq_list` (each its own Solr filter query; all must
   * match). `fq_list` is only used for two or more, because CKAN splits a lone
   * `fq_list` value into characters. Facet fields go out as the JSON list CKAN
   * expects in `facet.field`. A blank `q`, `sort`, filter or facet field is
   * refused (CkanValidationError), never sent or dropped.
   */
  async packageSearch(params: PackageSearchParams = {}): Promise<PackageSearchResult> {
    assertParams(params);
    assertKeys("packageSearch", "package_search", params, SEARCH_KEYS);
    assertText("q", params.q);
    if (params.fq !== undefined) assertValid("fq", params.fq, textListProblem);
    assertText("sort", params.sort);
    if (params.facet_field !== undefined) assertValid("facet_field", params.facet_field, textListProblem);
    assertCount("rows", params.rows);
    assertCount("start", params.start);
    if (params.facet_limit !== undefined) assertValid("facet_limit", params.facet_limit, facetLimitProblem);
    const fq = params.fq ?? [];
    const facetFields = params.facet_field ?? [];
    return this.typed<PackageSearchResult>("package_search", {
      q: params.q,
      fq: fq.length === 1 ? fq[0] : undefined,
      fq_list: fq.length > 1 ? fq : undefined,
      rows: params.rows,
      start: params.start,
      sort: params.sort,
      "facet.field": facetFields.length > 0 ? JSON.stringify(facetFields) : undefined,
      "facet.limit": params.facet_limit,
    }, isSearchResult, "an object with a numeric count and a results array");
  }

  /** A single dataset by id or name. */
  packageShow(id: string): Promise<Package> {
    return this.show<Package>("package_show", id);
  }

  /** A single organization (publisher) by id or name. */
  organizationShow(id: string): Promise<Organization> {
    return this.show<Organization>("organization_show", id);
  }

  /** A single group (theme/category) by id or name. */
  groupShow(id: string): Promise<Group> {
    return this.show<Group>("group_show", id);
  }

  /** A single resource (distribution) by id. */
  resourceShow(id: string): Promise<Resource> {
    return this.show<Resource>("resource_show", id);
  }

  /** Dataset names, paged with limit/offset (a positive limit, omit it for all; a non-negative offset). */
  async packageList(params: ListParams = {}): Promise<string[]> {
    assertParams(params);
    assertKeys("packageList", "package_list", params, PACKAGE_LIST_KEYS);
    assertLimit(params.limit);
    assertCount("offset", params.offset);
    return this.typed<string[]>(
      "package_list",
      { limit: params.limit, offset: params.offset },
      Array.isArray,
      "an array",
    );
  }

  /**
   * Organization names, or full objects with `all_fields`. See `groupOrOrgList`
   * for how an `all_fields` list is completed.
   */
  organizationList(params: GroupListParams = {}): Promise<JsonValue[]> {
    return this.groupOrOrgList("organization_list", params);
  }

  /** Group names, or full objects with `all_fields` (paged like organizationList). */
  groupList(params: GroupListParams = {}): Promise<JsonValue[]> {
    return this.groupOrOrgList("group_list", params);
  }

  /** Tags, optionally only those containing a substring (a blank one is refused). */
  async tagList(params: TagListParams = {}): Promise<string[]> {
    assertParams(params);
    assertKeys("tagList", "tag_list", params, TAG_LIST_KEYS);
    assertText("query", params.query);
    return this.typed<string[]>("tag_list", { query: params.query }, Array.isArray, "an array");
  }

  /** The licences this portal offers. */
  licenseList(): Promise<License[]> {
    return this.typed<License[]>("license_list", {}, Array.isArray, "an array");
  }

  /**
   * `organization_list` / `group_list`. CKAN caps an `all_fields` list at
   * `ckan.group_and_organization_list_all_fields_max` (25 by default) and
   * silently drops the rest, even when a larger `limit` is asked for. So an
   * `all_fields` list is fetched page by page until the server returns an empty
   * page (or `limit` entries are collected). The next offset advances by the
   * number of entries returned, which stays correct on a portal with a lower
   * cap; a page can also come back short without being the last (Berlin hides
   * some entries), so only an empty page ends the list. Entries are deduplicated
   * (by `id`), and a page that adds nothing new ends the loop too, so a server
   * that ignores `offset` cannot keep it going.
   *
   * Berlin counts hidden entries in its `limit`/`offset` window but leaves them
   * out of the answer, so a window smaller than a full page (the last one before
   * `limit` is reached) can come back empty although more entries follow. Such a
   * miss is asked again at the same offset with a full page before it ends the list.
   *
   * Bounds: pages are `ALL_FIELDS_PAGE_DELAY_MS` apart, and after
   * `MAX_ALL_FIELDS_PAGES` pages without reaching the end (a server whose pages
   * keep returning new entries) the call fails with a CkanParseError.
   */
  private async groupOrOrgList(action: string, params: GroupListParams): Promise<JsonValue[]> {
    assertParams(params);
    assertKeys(action === "group_list" ? "groupList" : "organizationList", action, params, GROUP_LIST_KEYS);
    if (params.all_fields !== undefined && typeof params.all_fields !== "boolean") {
      throw new CkanValidationError("Invalid all_fields: Expected a boolean.");
    }
    assertLimit(params.limit);
    // Before the first request, and before the all_fields pager steps on from it.
    assertCount("offset", params.offset);
    if (!params.all_fields) {
      return this.typed<JsonValue[]>(
        action,
        { limit: params.limit, offset: params.offset },
        Array.isArray,
        "an array",
      );
    }
    const wanted = params.limit ?? Infinity;
    let offset = params.offset ?? 0;
    const seen = new Set<string>();
    const out: JsonValue[] = [];
    let pages = 0;
    // Set after a short window came back empty (or with nothing new): from then on
    // every page is a full one.
    let fullPages = false;
    while (out.length < wanted) {
      if (pages >= MAX_ALL_FIELDS_PAGES) {
        throw new CkanParseError(
          `${action} with all_fields: stopped after ${MAX_ALL_FIELDS_PAGES} pages (MAX_ALL_FIELDS_PAGES) without ` +
            `reaching the end of the list; the server keeps returning new entries, which no CKAN list has. ` +
            `Pass a limit (--limit) to fetch part of it.`,
        );
      }
      if (pages > 0) await this.#sleep(ALL_FIELDS_PAGE_DELAY_MS);
      const limit = fullPages ? ALL_FIELDS_PAGE : Math.min(ALL_FIELDS_PAGE, wanted - out.length);
      const page = await this.typed<JsonValue[]>(
        action,
        {
          all_fields: true,
          limit,
          offset: offset === 0 ? undefined : offset,
        },
        Array.isArray,
        "an array",
      );
      pages += 1;
      let added = 0;
      for (const entry of page) {
        const key = entryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        added += 1;
      }
      if (page.length === 0 || added === 0) {
        // A short window may have held only hidden entries: ask once more, same
        // offset, for a full page before taking it as the end.
        if (limit < ALL_FIELDS_PAGE) {
          fullPages = true;
          continue;
        }
        break;
      }
      offset += page.length;
    }
    return out.slice(0, wanted);
  }

  /**
   * A `*_show` call. A blank id is rejected up front: `prune` would drop it and
   * CKAN would answer with a 409 validation error instead.
   */
  private async show<T>(action: string, id: string): Promise<T> {
    if (typeof id !== "string" || id.trim() === "") throw new CkanValidationError(`${action} needs an id or name.`);
    return this.typed<T>(action, { id }, isObject, "a JSON object");
  }
}
