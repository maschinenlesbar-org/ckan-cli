// CkanClient — a typed client over the open (no-auth) read endpoints of any CKAN
// Action API (`<site>/api/3/action`).

import { DEFAULT_BASE_URL, RequestEngine, sanitizeServerText, type EngineOptions } from "./engine.js";
import { CkanError, CkanParseError, describeCkanError, redactUrl } from "./errors.js";
import type { QueryParams } from "./query.js";
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

/** A key for a list entry — its `id`, else its JSON — to drop duplicates across pages. */
function entryKey(entry: JsonValue): string {
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    const id = entry["id"];
    if (typeof id === "string") return `id:${id}`;
  }
  return JSON.stringify(entry);
}

/**
 * Drop undefined (and empty-string) values so only the parameters the caller
 * actually set are sent. An empty string filter (e.g. `tags --query ""`) is
 * treated as "no filter" rather than forwarded as `query=`.
 */
function prune(params: QueryParams): QueryParams {
  const out: QueryParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
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
    throw new CkanError(
      `Invalid limit: expected a positive integer, got ${String(limit)}. Leave it out for the whole list.`,
    );
  }
}

/**
 * The site root of a CKAN instance, from what a user is likely to paste: portals
 * document their API as `<site>/api/3/action`, so that suffix (or `/api/3`) is
 * dropped. A CKAN mounted under a sub-path (`https://host/ckan`) keeps it. A
 * query string or fragment is refused.
 */
export function siteRoot(baseUrl: string): string {
  // The API path is appended to the base URL, so a query string or fragment in it
  // would end up in front of `/api/3/action` and break every request.
  if (/[?#]/.test(baseUrl)) {
    throw new CkanError(`The base URL must not contain a query string or fragment: ${redactUrl(baseUrl)}`);
  }
  return baseUrl.replace(/\/+$/, "").replace(/\/api\/3(\/action)?$/, "");
}

export class CkanClient {
  private readonly engine: RequestEngine;
  /** The site this client talks to, for error messages. */
  private readonly site: string;

  constructor(options: EngineOptions = {}) {
    this.site = siteRoot(options.baseUrl ?? DEFAULT_BASE_URL);
    this.engine = new RequestEngine({ ...options, baseUrl: this.site });
  }

  /** Call any CKAN action by name and return its unwrapped `result`. */
  async action<T = JsonValue>(name: string, params: QueryParams = {}): Promise<T> {
    if (!ACTION_NAME.test(name)) {
      throw new CkanError(`Invalid CKAN action name: "${name}"`);
    }
    const env = await this.engine.getJson<CkanEnvelope<T> | null>(`${ACTION}/${name}`, prune(params));
    // Another JSON API at the same path (or a proxy's JSON error page) is not an
    // envelope; say so rather than "failed: undefined".
    if (typeof env !== "object" || env === null || Array.isArray(env) || typeof env.success !== "boolean") {
      throw new CkanParseError(
        `The answer to "${name}" is not a CKAN Action API response; is ${redactUrl(this.site)} a CKAN site?`,
      );
    }
    if (!env.success) {
      // A success:false envelope can come with HTTP 200, so it never passes the
      // engine's error-detail sanitising: strip terminal controls here too.
      throw new CkanError(
        `CKAN action "${name}" failed: ${sanitizeServerText(describeCkanError(env.error))}`,
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
   * expects in `facet.field`.
   */
  packageSearch(params: PackageSearchParams = {}): Promise<PackageSearchResult> {
    const fq = (params.fq ?? []).filter((f) => f !== "");
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

  /** Dataset names, paged with limit/offset (a positive limit; omit it for all). */
  async packageList(params: ListParams = {}): Promise<string[]> {
    assertLimit(params.limit);
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

  /** Tags, optionally only those containing a substring. */
  tagList(params: TagListParams = {}): Promise<string[]> {
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
   */
  private async groupOrOrgList(action: string, params: GroupListParams): Promise<JsonValue[]> {
    assertLimit(params.limit);
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
    while (out.length < wanted) {
      const page = await this.typed<JsonValue[]>(
        action,
        {
          all_fields: true,
          limit: Math.min(ALL_FIELDS_PAGE, wanted - out.length),
          offset: offset === 0 ? undefined : offset,
        },
        Array.isArray,
        "an array",
      );
      let added = 0;
      for (const entry of page) {
        const key = entryKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
        added += 1;
      }
      if (page.length === 0 || added === 0) break;
      offset += page.length;
    }
    return out.slice(0, wanted);
  }

  /**
   * A `*_show` call. A blank id is rejected up front: `prune` would drop it and
   * CKAN would answer with a 409 validation error instead.
   */
  private async show<T>(action: string, id: string): Promise<T> {
    if (id.trim() === "") throw new CkanError(`${action} needs an id or name.`);
    return this.typed<T>(action, { id }, isObject, "a JSON object");
  }
}
