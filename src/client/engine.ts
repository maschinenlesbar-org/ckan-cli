// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import { CkanApiError, CkanNetworkError, CkanParseError, describeCkanError, redactUrl } from "./errors.js";

export const DEFAULT_BASE_URL = "https://suche.transparenz.hamburg.de";
const DEFAULT_USER_AGENT = "ckan-cli";

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
  /** The URL that answered, after any redirects. */
  url: string;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://suche.transparenz.hamburg.de (the Hamburg Transparenzportal) */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /** Per-request timeout in milliseconds (0 disables; capped at `MAX_TIMEOUT_MS`, 2^31 - 1 ms). */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses. Each waits the
   * response's `Retry-After` (up to `MAX_RETRY_AFTER_MS`; a longer one is not
   * retried), or else `retryDelayMs * attempt`.
   */
  maxRetries?: number;
  /** Base backoff between retries in milliseconds (grows linearly); used without a Retry-After. */
  retryDelayMs?: number;
  /** Number of HTTP redirects (301/302/303/307/308) to follow. Defaults to 5. */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/** Most automatic retries the CLI's --max-retries accepts. */
export const MAX_RETRIES = 10;

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once: retrying early would only land inside the window the server asked us to wait
 * out, and a hostile value must not stall the CLI.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** An IMF-fixdate (RFC 9110 §5.6.7), the one HTTP-date form senders must generate. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse a `Retry-After` header into a delay in milliseconds (RFC 9110 §10.2.3):
 * either delay-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`,
 * turned into the time left from `now`; a date in the past gives 0).
 *
 * Returns `undefined` when the header is absent or malformed — negative (`"-1"`),
 * fractional (`"1.5"`), padded inside, any other date format — so the caller falls
 * back to its own backoff. The strict patterns matter: `Date.parse` alone would
 * read `"1.5"` as a date in 2001 and retry at once.
 */
export function parseRetryAfter(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!IMF_FIXDATE.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

/**
 * True for the Unicode bidirectional formatting characters: ALM (U+061C), LRM/RLM
 * (U+200E/U+200F), the embeddings and overrides U+202A–U+202E and the isolates
 * U+2066–U+2069. A terminal applies them to the text that follows, so an override
 * in server text can reorder what the user sees ("Trojan Source" spoofing).
 */
export function isBidiControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Make a string that originates in an attacker-controlled response — the error
 * `detail`, a CKAN `success:false` error, the echoed Content-Type — safe to print
 * into an error message on stderr:
 *
 * - C0 and C1 controls and DEL are dropped. A JSON error body can encode an escape
 *   (U+001B) that JSON.parse turns into a real control byte; printed raw, a hostile
 *   or MITM'd endpoint could drive ANSI/OSC sequences into the terminal (display
 *   spoofing, title changes, OSC 52 clipboard writes).
 * - Bidi formatting characters (isBidiControl) are dropped, so server text cannot
 *   reorder the visible message.
 * - Every run of whitespace — newlines, tabs, U+2028/U+2029 included — becomes one
 *   space and the ends are trimmed, so the text stays on one line and a server
 *   cannot forge an `Error:` line of its own.
 *
 * The CLI's JSON output is escaped separately (`escapeControlChars` in
 * cli/shared.ts): `JSON.stringify` alone leaves DEL, C1 and bidi characters raw.
 * Written as a char-code filter so no raw control byte appears in this source.
 */
export function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    const whitespaceControl = n >= 0x09 && n <= 0x0d;
    if (!whitespaceControl && (n <= 0x1f || (n >= 0x7f && n <= 0x9f) || isBidiControl(n))) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Reject a base URL whose scheme is not http(s). The default transport already
 * gates this per hop, but the engine is exported as a library and may be handed a
 * custom transport that does no such check, so gate the configured base URL here
 * too (a `file:`/`ftp:` base URL fails fast with a typed error).
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CkanNetworkError(`Invalid base URL: ${redactUrl(baseUrl)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CkanNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${redactUrl(baseUrl)}`,
    );
  }
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestEngine {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // Re-check the base-URL scheme here, not only in the default transport: a
    // library consumer that injects a custom transport would otherwise get no
    // gating at all, and could be steered to a non-http(s) scheme.
    assertHttpScheme(this.baseUrl);
    this.transport = options.transport ?? nodeHttpTransport;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Build a fully-qualified URL from a path and optional query parameters. */
  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${this.baseUrl}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    let url = this.buildUrl(path, options.query);
    let headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };

    let attempt = 0;
    let redirects = 0;
    // attempts = initial try + maxRetries (redirects are counted separately)
    for (;;) {
      const response = await this.transport({
        method,
        url,
        headers,
        timeoutMs: this.timeoutMs,
        ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
      });

      const status = response.status;
      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        // Honour Retry-After; without a usable one, back off linearly. A Retry-After
        // beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at once.
        const retryAfter = parseRetryAfter(response.headers["retry-after"]);
        if (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS) {
          attempt += 1;
          await this.sleep(retryAfter ?? this.retryDelayMs * attempt);
          continue;
        }
      }

      // Follow redirects, resolving the Location relative to the current URL.
      const location = response.headers["location"];
      const isRedirect = status >= 300 && status < 400;
      const nextUrl = isRedirect && redirects < this.maxRedirects ? resolveLocation(location, url) : undefined;
      if (nextUrl !== undefined) {
        // Credential-strip guard: if the redirect crosses origin, drop the
        // request headers so any future auth/cookie header is never re-sent to
        // a different host. (Today only Accept/User-Agent are sent, but this
        // future-proofs against header leakage across origins.)
        if (nextUrl.origin !== new URL(url).origin) {
          headers = { Accept: options.accept };
        }
        url = nextUrl.toString();
        redirects += 1;
        continue;
      }

      const contentType = String(response.headers["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        // A 3xx that was not followed: say why, or a bare "HTTP 301" reads like a
        // redirect this client cannot follow. Past the limit it is a loop; a
        // missing or malformed Location (which `new URL` would have thrown on as
        // an "Unexpected error") is named as it came, sanitised.
        if (isRedirect) {
          const target = resolveLocation(location, url);
          const detail =
            target !== undefined
              ? `stopped after ${this.maxRedirects} redirects (a redirect loop?)`
              : location
                ? `redirect to ${sanitizeServerText(location)} not followed`
                : "redirect not followed (no Location header)";
          throw new CkanApiError({ status, url, method, body: response.body.toString("utf8"), detail });
        }
        throw this.toApiError(method, url, status, response.body);
      }

      return { data: response.body, contentType, status, url };
    }
  }

  /** Perform a GET expecting JSON and parse it into `T`. */
  async getJson<T>(path: string, query?: QueryParams): Promise<T> {
    const res = await this.request("GET", path, { query, accept: "application/json" });
    const text = res.data.toString("utf8");
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      // Name the URL and what came back: a site that is not a CKAN (or not at this
      // path) typically answers with an HTML page and HTTP 200.
      // The Content-Type is server text (latin-1 decoded, so a 0x9B byte is the
      // 8-bit CSI U+009B): sanitise it before it reaches stderr.
      const mediaType = sanitizeServerText(res.contentType.split(";")[0]!);
      const message = /json/i.test(mediaType)
        ? `Invalid JSON from ${redactUrl(res.url)}`
        : `Expected JSON from ${redactUrl(res.url)} but got ${mediaType || "a body that is not JSON"}`;
      throw new CkanParseError(message, { cause });
    }
  }

  private toApiError(method: string, url: string, status: number, body: Buffer): CkanApiError {
    const text = body.toString("utf8");
    let detail: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        // CKAN's own routing errors (an unknown action name) are a bare JSON string.
        detail = parsed;
      } else if (typeof parsed === "object" && parsed !== null) {
        const body = parsed as { detail?: unknown; message?: unknown; error?: unknown };
        // CKAN nests its error under `error` (a message, or a validation field
        // map; see describeCkanError); plainer APIs use a top-level
        // `detail`/`message`. Prefer the nested CKAN shape, then fall back.
        if (typeof body.error === "object" && body.error !== null) {
          detail = describeCkanError(body.error);
        } else if (typeof body.detail === "string") {
          detail = body.detail;
        } else if (typeof body.message === "string") {
          detail = body.message;
        }
      }
    } catch {
      // Non-JSON error body; leave detail undefined.
    }
    // `detail` came from the response body; strip control characters so a hostile
    // endpoint cannot inject terminal escape sequences via the stderr error message.
    if (detail !== undefined) detail = sanitizeServerText(detail);
    return new CkanApiError({ status, url, method, body: text, detail });
  }
}

/** Resolve a Location header against the current URL; undefined if missing or malformed. */
function resolveLocation(location: string | undefined, base: string): URL | undefined {
  if (location === undefined || location === "") return undefined;
  try {
    return new URL(location, base);
  } catch {
    return undefined;
  }
}
