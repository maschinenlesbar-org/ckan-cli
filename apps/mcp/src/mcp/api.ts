// How the MCP server reaches this repository's client. The server's generic files (server.ts,
// limiter.ts, config.ts, run.ts, result.ts: the kit, the same in every repository) import the
// client only through this file, under the names below; the names on the right are this
// client's. Per repository, like tools.ts: a client whose names or functions differ adapts here.

import { DEFAULT_BASE_URL, siteRoot } from "@maschinenlesbar.org/ckan-client";

export {
  CkanClient as Client,
  CkanError as ClientError,
  CkanNetworkError as NetworkError,
  DEFAULT_BASE_URL,
  MAX_TIMEOUT_MS,
  nodeHttpTransport,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "@maschinenlesbar.org/ckan-client";
export { baseUrlProblem } from "@maschinenlesbar.org/ckan-client/internal/validate";
export { sizeLimitMessage } from "@maschinenlesbar.org/ckan-client/internal/http";
export { cutText, toWellFormed } from "@maschinenlesbar.org/ckan-client/internal/errors";

/**
 * The API's base as a result's `source` starts with it: the portal `--base-url` names (else the
 * Transparenzportal Hamburg), as the client reads it (a pasted `/api/3/action` dropped), and the
 * CKAN Action API's path. A tool that asks another portal of the built-in list names that
 * portal's absolute URL instead.
 */
export function apiBase(baseUrl: string | undefined): string {
  return `${siteRoot(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/api/3/action`;
}
