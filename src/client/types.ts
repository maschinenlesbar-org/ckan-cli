// Domain types for the CKAN Action API (v3).
//
// CKAN wraps every response in `{ help, success, result }` (or an `error` object
// when `success` is false). The client unwraps `result`; datasets are deeply
// nested and differ per portal (every instance adds its own extras), so they are
// exposed as raw `JsonObject`s.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The envelope CKAN wraps every Action API response in. */
export interface CkanEnvelope<T> {
  help: string;
  success: boolean;
  result?: T;
  error?: JsonObject;
}

/** Result of `status_show`: which CKAN this is and what it has installed. */
export interface Status {
  site_title?: string;
  site_description?: string;
  site_url?: string;
  ckan_version: string;
  locale_default?: string;
  /** Enabled plugins, e.g. `["dcat", "harvest", "spatial_query"]`. */
  extensions?: string[];
  [key: string]: JsonValue | undefined;
}

/** A dataset ("package"). Its fields and extras vary from portal to portal. */
export type Package = JsonObject;

/** Result of `package_search`. */
export interface PackageSearchResult {
  count: number;
  results: Package[];
  facets?: JsonObject;
  search_facets?: JsonObject;
  sort?: string;
}

/** Parameters for `package_search`. */
export interface PackageSearchParams {
  /** Solr query string, e.g. `elbe` or `title:Haushalt`. */
  q?: string;
  /** Filter queries, e.g. `["organization:allris"]`. All must match. */
  fq?: string[];
  /** Page size. CKAN caps it server-side (`ckan.search.rows_max`, 1000 by default). */
  rows?: number;
  /** Offset of the first result, for paging. */
  start?: number;
  /** e.g. `"metadata_modified desc"`. */
  sort?: string;
  /**
   * Facet fields to count, e.g. `["organization", "res_format"]`. Counts come
   * back in `search_facets`.
   */
  facet_field?: string[];
  /** Maximum number of values returned per facet (CKAN's default is 50; -1 = all). */
  facet_limit?: number;
}

/** An organization (a data publisher) or a group (a theme/category). */
export type Organization = JsonObject;
export type Group = JsonObject;
/** A resource (a single distributable file within a dataset). */
export type Resource = JsonObject;

/** Paging for the `*_list` endpoints. */
export interface ListParams {
  limit?: number;
  offset?: number;
}

/** Parameters for `organization_list` / `group_list`. */
export interface GroupListParams extends ListParams {
  /** Return full objects instead of just names. */
  all_fields?: boolean;
}

/** Parameters for `tag_list`. */
export interface TagListParams {
  /** Only tags containing this substring. */
  query?: string;
}

/** A licence a portal offers (`license_list`). */
export type License = JsonObject;

/** Where a known portal was found (see scripts/update-portals.ts). */
export type PortalSource = "curated" | "wikidata" | "ckan-instances" | "govdata-harvest";

/** A known CKAN portal, from the built-in list (`ckan portals`). */
export interface Portal {
  /** Short name for `--portal`, e.g. `hamburg`. */
  id: string;
  title: string;
  /** Site root; the Action API is at `<url>/api/3/action`. */
  url: string;
  sources: PortalSource[];
  /** Whether the last check could search the portal. */
  working: boolean;
  /** Date of the last check (`YYYY-MM-DD`), or null if never checked. */
  checked: string | null;
  /** Why the last check failed, or null. */
  problem: string | null;
  /** From `status_show`; null when a portal does not expose it (Berlin). */
  ckanVersion: string | null;
  /** Number of datasets `package_search` reported at the last check. */
  datasets: number | null;
  note: string | null;
}
