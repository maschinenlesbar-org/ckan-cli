// Public entry point for the API client library.

export { CkanClient, siteRoot } from "./client.js";
export { RequestEngine, DEFAULT_BASE_URL } from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  CkanError,
  CkanApiError,
  CkanNetworkError,
  CkanParseError,
  describeCkanError,
} from "./errors.js";

export { PORTALS } from "./portals-list.js";
export { checkPortal, findPortal, mapLimit, portalKey, withCheck } from "./portals.js";
export type { PortalCheck } from "./portals.js";

export * from "./types.js";
