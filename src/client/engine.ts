// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { TextDecoder } from "node:util";
import { MAX_TIMEOUT_MS, nodeHttpTransport, sizeLimitMessage, type HttpRequest, type HttpResponse, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import {
  CkanApiError,
  CkanError,
  CkanNetworkError,
  CkanParseError,
  CkanValidationError,
  credentialsIn,
  cutForMessage,
  describeCkanError,
  redactCredentials,
  redactUrl,
} from "./errors.js";
import { assertValid, baseUrlProblem, headerValueProblem, intRangeProblem } from "./validate.js";

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
  /**
   * Value of the User-Agent header. Must be sendable (see `assertHeaderValue`):
   * not blank, no control characters but tab, nothing above U+00FF.
   */
  userAgent?: string;
  /**
   * Per-request timeout in milliseconds, 0 to `MAX_TIMEOUT_MS` (2^31 - 1 ms); 0 disables.
   * It covers the whole response, body included, and the engine enforces it for every
   * transport (the request also gets an AbortSignal that fires at the deadline).
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses; a reset or other
   * network error is not retried. Each waits `retryDelayMs * attempt`, or the
   * response's `Retry-After` when that is longer (up to `MAX_RETRY_AFTER_MS`; a longer
   * one is not retried, and the CkanApiError says so). 0 to `MAX_RETRIES`; defaults to 2.
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly), 0 to
   * `MAX_RETRY_AFTER_MS` (30 000); defaults to 200. It is also the floor under a
   * `Retry-After`: the header can lengthen a wait, never shorten it.
   */
  retryDelayMs?: number;
  /** Number of HTTP redirects (301/302/303/307/308) to follow, 0 to `MAX_REDIRECTS`. Defaults to 5. */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   * Enforced by the engine for every transport: the built-in one aborts early, a
   * custom one's body is checked when it arrives.
   *
   * Every numeric option must be a non-negative safe integer within its range;
   * the constructor throws CkanValidationError otherwise (a negative or NaN
   * timeout or cap would silently switch that guard off).
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/** Most automatic retries the engine performs (`maxRetries`, the CLI's --max-retries). */
export const MAX_RETRIES = 10;

/** Most redirects the engine follows (`maxRedirects`). */
export const MAX_REDIRECTS = 10;

/**
 * Check a value for an HTTP header (headerValueProblem) and return it, or throw
 * CkanValidationError `Invalid <name>: …`.
 */
export function assertHeaderValue(name: string, value: string): string {
  return assertValid(name, value, headerValueProblem);
}

/** Check an optional function option (`transport`, `sleep`): a function or undefined. */
function functionOption<F>(name: string, value: F | undefined, fallback: F): F {
  if (value === undefined) return fallback;
  if (typeof value !== "function") throw new CkanValidationError(`Invalid ${name}: Expected a function.`);
  return value;
}

/** Check an optional numeric engine option against `[min, max]` (CkanValidationError). */
function intOption(name: string, value: number | undefined, min: number, max: number): number | undefined {
  return value === undefined ? undefined : assertValid(name, value, intRangeProblem(min, max));
}

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once, naming the requested wait: retrying early would only land inside the window
 * the server asked us to wait out, and a hostile value must not stall the CLI.
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
 * Check a base URL (baseUrlProblem: not blank, no whitespace or control
 * characters, an absolute http(s) URL, no query string or fragment) and return it
 * without trailing slashes. Throws CkanValidationError `Invalid base URL: …` — a
 * configuration mistake, not a CkanNetworkError. The RequestEngine and CkanClient
 * constructors call it, so a custom transport never sees a bad base URL; the
 * default transport still re-checks the scheme on every hop.
 */
export function validateBaseUrl(raw: string): string {
  return assertValid("base URL", raw, baseUrlProblem).replace(/\/+$/, "");
}

/** True for a loopback host: `localhost`, 127.0.0.0/8 or `::1` (as URL#hostname spells it). */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * Whether requests to `baseUrl` would travel unencrypted, as one sentence for a warning
 * (without a `warning: ` prefix), or `undefined` when they would not: for `https:`, for a
 * URL that does not parse, and for a loopback host (`localhost`, 127.0.0.0/8, `::1`),
 * where nothing leaves the machine.
 *
 * The sentence names the host (`url.host`: host and port, never the userinfo) and what
 * secret travels with the requests: the base URL's credentials when it carries userinfo,
 * and every phrase in `secrets` (noun phrases such as "the API key"). It never contains
 * a password or key. The CLI prints it once per run as `warning: <sentence>` on stderr.
 */
export function cleartextProblem(baseUrl: string, secrets: readonly string[] = []): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || isLoopbackHost(url.hostname)) return undefined;
  const userinfo = url.username !== "" || url.password !== "";
  const phrases = [...secrets, ...(userinfo ? ["the base URL's credentials"] : [])];
  if (phrases.length === 0) return `requests to ${url.host} are sent unencrypted (http:, not https:)`;
  const verb = phrases.length === 1 && !userinfo ? "is" : "are";
  return `${phrases.join(" and ")} ${verb} sent unencrypted to ${url.host} (http:, not https:)`;
}

// The headers the engine sets itself, under the exact keys it uses. They are the
// only ones that follow a cross-origin redirect.
const ENGINE_HEADERS = new Set(["Accept", "User-Agent"]);

/**
 * A copy of `headers` with only the engine's own non-credential headers (used on
 * cross-origin redirects). A list of known credential headers is never complete
 * (Proxy-Authorization, X-Auth-Token, ...), so an allowlist is kept instead. A new
 * object, so the one already handed to the transport is not changed.
 */
function engineHeadersOnly(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => ENGINE_HEADERS.has(key)));
}

/** Why `value` is not a usable HttpResponse, or undefined when it is. */
function responseProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "not an object";
  const r = value as Partial<Record<"status" | "headers" | "body", unknown>>;
  if (typeof r.status !== "number" || !Number.isInteger(r.status) || r.status < 100 || r.status > 599) {
    return "status is not an HTTP status code";
  }
  if (typeof r.headers !== "object" || r.headers === null || Array.isArray(r.headers)) return "headers is not an object";
  if (bodyBytes(r.body) === undefined) return "body is not a Buffer, Uint8Array, other ArrayBuffer view or ArrayBuffer";
  return undefined;
}

/**
 * The response body as a Buffer (a view, no copy): a Buffer, any ArrayBuffer view (a
 * Uint8Array from fetch, a DataView) or an ArrayBuffer/SharedArrayBuffer — checked by
 * internal slot, not `instanceof`, so a value from another realm (a vm context, a
 * Jest test) counts. Undefined for anything else.
 */
function bodyBytes(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const tag = Object.prototype.toString.call(value);
  if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") return Buffer.from(value as ArrayBuffer);
  return undefined;
}

/**
 * The response headers as a plain record with lower-case names. Node's transport
 * lower-cases them; a custom one may not (`Retry-After`, `Location`, `Content-Type`),
 * and a fetch transport naturally returns its `Headers` object, which has no plain
 * properties. Such an object (anything with `get` and `forEach`: `Headers`, a `Map`)
 * is copied.
 */
function plainHeaders(headers: object): Record<string, string | string[] | undefined> {
  const h = headers as { get?: unknown; forEach?: unknown };
  if (typeof h.get === "function" && typeof h.forEach === "function") {
    const record: Record<string, string> = {};
    (h.forEach as (cb: (value: string, name: string) => void) => void).call(headers, (value, name) => {
      record[String(name).toLowerCase()] = value;
    });
    return record;
  }
  const record: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    record[name.toLowerCase()] = value;
  }
  return record;
}

/** The first value of a header (a repeated one arrives as an array). */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RequestEngine {
  // A real private field (not TypeScript's `private`): util.inspect, console.log and
  // JSON.stringify of a client never show it, so a password in the base URL can't be
  // logged by accident. Messages use redactUrl.
  readonly #baseUrl: string;
  /** The base URL's userinfo, raw and percent-decoded, for scrubbing server and transport text. */
  readonly #credentials: string[];
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    // The raw value, checked before the slash strip (the engine glues it into
    // every URL), and here rather than only in the default transport: a library
    // consumer that injects a custom transport would otherwise get no gating at
    // all, and could be steered to a non-http(s) scheme. Only undefined selects
    // the default.
    this.#baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#credentials = credentialsIn(this.#baseUrl).flatMap((raw) => {
      try {
        return [raw, decodeURIComponent(raw)];
      } catch {
        return [raw];
      }
    });
    this.transport = functionOption("transport", options.transport, nodeHttpTransport);
    // Only undefined selects the default; a blank or unsendable value is refused.
    this.userAgent =
      options.userAgent === undefined ? DEFAULT_USER_AGENT : assertHeaderValue("userAgent", options.userAgent);
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, 0, MAX_TIMEOUT_MS) ?? 30_000;
    this.maxRetries = intOption("maxRetries", options.maxRetries, 0, MAX_RETRIES) ?? 2;
    // Bounded like a Retry-After wait: a larger value overflowed Node's timer and fired
    // after 1 ms, a burst rather than a backoff.
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, 0, MAX_RETRY_AFTER_MS) ?? 200;
    this.maxRedirects = intOption("maxRedirects", options.maxRedirects, 0, MAX_REDIRECTS) ?? 5;
    this.maxResponseBytes =
      intOption("maxResponseBytes", options.maxResponseBytes, 0, Number.MAX_SAFE_INTEGER) ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = functionOption("sleep", options.sleep, realSleep);
  }

  /**
   * `text` without the base URL's credentials (raw and percent-decoded): server text
   * (an error body or a CKAN error that echoes the request URL) and transport text
   * (fetch's "Failed to fetch <url>") can carry them. The client uses it for its own
   * messages built from server text.
   */
  scrub(text: string): string {
    return this.#credentials.length === 0 ? text : redactCredentials(text, this.#credentials);
  }

  /**
   * A failure as the `cause` of the error the engine raises: the original when its
   * text carries no credentials, otherwise a copy with them scrubbed (message, `code`
   * and the cause chain kept), so logging the error with its causes can't reveal the
   * base URL's password.
   */
  private scrubCause(cause: unknown, depth = 0): unknown {
    if (this.#credentials.length === 0 || depth > 5) return cause;
    if (typeof cause === "string") return this.scrub(cause);
    if (!(cause instanceof Error)) return cause;
    const inner = this.scrubCause(cause.cause, depth + 1);
    const message = this.scrub(cause.message);
    if (message === cause.message && inner === cause.cause && this.scrub(cause.stack ?? "") === (cause.stack ?? "")) {
      return cause;
    }
    const copy = new Error(message, inner === undefined ? undefined : { cause: inner });
    copy.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (code !== undefined) Object.assign(copy, { code });
    return copy;
  }

  /**
   * Build a fully-qualified URL from a path and optional query parameters. It keeps
   * the base URL's userinfo; `request()` leaves it out and sends it as an
   * Authorization header instead (see basicAuthorization).
   */
  buildUrl(path: string, query?: QueryParams): string {
    return this.composeUrl(path, query, true);
  }

  /** buildUrl, with or without the base URL's userinfo. */
  private composeUrl(path: string, query: QueryParams | undefined, withUserinfo: boolean): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    const base = withUserinfo ? this.#baseUrl : withoutUserinfo(this.#baseUrl);
    return `${base}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /**
   * Call the transport under the overall deadline (`timeoutMs`): the request gets an
   * AbortSignal that fires at the deadline, and the call rejects then whether the
   * transport stops or not — a custom transport (fetch, a node:http wrapper) that
   * ignores `timeoutMs` can't hang the caller (or `checkPortals`). A synchronous throw
   * becomes a rejection.
   */
  private async callTransport(request: HttpRequest): Promise<HttpResponse> {
    const call = (signal?: AbortSignal): Promise<HttpResponse> =>
      Promise.resolve().then(() => this.transport(signal === undefined ? request : { ...request, signal }));
    if (this.timeoutMs === 0) return call();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new CkanNetworkError(`Request exceeded the ${this.timeoutMs}ms deadline`);
        controller.abort(err);
        reject(err);
      }, Math.min(this.timeoutMs, MAX_TIMEOUT_MS));
    });
    try {
      return await Promise.race([call(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    // The transport never sees the base URL's userinfo: the engine sends it as an
    // Authorization header, per hop, so a redirect to the same origin (relative or
    // absolute) keeps it and one to another origin or scheme drops it. A transport
    // such as fetch also refuses a URL with credentials outright.
    let url = this.composeUrl(path, options.query, false);
    let headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };
    const authorization = basicAuthorization(this.#baseUrl);
    if (authorization !== undefined) headers["Authorization"] = authorization;
    /** Why a redirect dropped the base URL's credentials, for a 401/403 message. */
    let dropped: string | undefined;

    let attempt = 0;
    let redirects = 0;
    // attempts = initial try + maxRetries (redirects are counted separately)
    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.callTransport({
          method,
          url,
          headers,
          timeoutMs: this.timeoutMs,
          redirect: "manual",
          ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
        });
      } catch (cause) {
        // The default transport rejects with CkanNetworkError only; an injected one may
        // throw anything, and its text may quote the URL with its userinfo. Every
        // failure becomes a CkanNetworkError naming the request (redacted), with the
        // credentials scrubbed from its text and its cause chain; any other CkanError
        // passes through.
        if (cause instanceof CkanError && !(cause instanceof CkanNetworkError)) throw cause;
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new CkanNetworkError(`${method} ${cutForMessage(redactUrl(url))} failed: ${sanitizeServerText(this.scrub(reason))}`, {
          cause: this.scrubCause(cause),
        });
      }

      // An injected transport may resolve with anything; a malformed HttpResponse
      // would otherwise surface below as a raw TypeError, outside the CkanError contract.
      const invalid = responseProblem(response);
      if (invalid !== undefined) {
        throw new CkanNetworkError(
          `${method} ${cutForMessage(redactUrl(url))} failed: the transport returned an invalid response (${invalid}).`,
        );
      }
      // A transport must not follow redirects itself (`redirect: "manual"`): one that
      // did (fetch's default) may have carried the Authorization header to another
      // host, and the answer is not the one asked for. Reject it when it says so (`url`).
      const finalUrl = (response as { url?: unknown }).url;
      if (typeof finalUrl === "string" && finalUrl !== "" && originOf(finalUrl) !== originOf(url)) {
        throw new CkanNetworkError(
          `${method} ${cutForMessage(redactUrl(url))} failed: the transport followed a redirect to another origin ` +
            `(${sanitizeServerText(redactUrl(this.scrub(finalUrl)))}); a transport must not follow redirects ` +
            `(HttpRequest.redirect is "manual").`,
        );
      }

      const status = response.status;
      const responseHeaders = plainHeaders(response.headers);
      // fetch gives a Uint8Array; view it as a Buffer (no copy), which the decoders expect.
      const body = bodyBytes(response.body) as Buffer;
      // The size cap holds whatever the transport did: the default one aborts early, a
      // custom one may have read everything.
      if (this.maxResponseBytes > 0 && body.byteLength > this.maxResponseBytes) {
        throw new CkanNetworkError(`${method} ${cutForMessage(redactUrl(url))} failed: ${sizeLimitMessage(this.maxResponseBytes)}`);
      }
      const retryable = status === 429 || status === 503;
      // A Retry-After beyond MAX_RETRY_AFTER_MS is not retried: the error below
      // surfaces at once and names the wait the server asked for.
      const retryAfter = retryable ? parseRetryAfter(headerValue(responseHeaders["retry-after"])) : undefined;
      const tooLong = retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_MS;
      if (retryable && !tooLong && attempt < this.maxRetries) {
        attempt += 1;
        // Back off linearly from retryDelayMs. A Retry-After can ask for longer, never
        // for less: `Retry-After: 0` or a date in the past turned the retries into a
        // zero-delay burst against a server that had just asked for less load.
        const backoff = this.retryDelayMs * attempt;
        await this.sleep(retryAfter === undefined ? backoff : Math.max(retryAfter, backoff));
        continue;
      }

      // Follow redirects, resolving the Location relative to the current URL.
      const location = headerValue(responseHeaders["location"]);
      const isRedirect = status >= 300 && status < 400;
      const nextUrl = isRedirect && redirects < this.maxRedirects ? resolveLocation(location, url) : undefined;
      if (nextUrl !== undefined) {
        // Userinfo in a Location is not used: credentials come from the base URL
        // only, as the Authorization header, never from a server.
        nextUrl.username = "";
        nextUrl.password = "";
        // Only http(s) is followed: a `file:`, `ftp:`, `data:` or `javascript:` target
        // never reaches a transport (a custom one may not check the scheme).
        if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
          throw new CkanNetworkError(
            `Refusing to follow redirect to unsupported protocol "${sanitizeServerText(nextUrl.protocol)}" ` +
              `for ${method} ${cutForMessage(redactUrl(url))}`,
          );
        }
        // Credential-strip guard: if the redirect crosses origin (scheme + host +
        // port, so an https->http downgrade counts), keep only the engine's own
        // non-credential headers, so the base URL's Authorization (and any future
        // auth/cookie header) is never re-sent to a different host. The same origin
        // keeps it, whether the Location is relative or absolute. The User-Agent
        // stays: Hamburg's own http: -> https: hop is cross-origin, and dropping it
        // sent every request through an http:// base URL without one (and ignored
        // --user-agent).
        const from = new URL(url);
        if (nextUrl.origin !== from.origin) {
          if (headers["Authorization"] !== undefined && dropped === undefined) {
            dropped =
              from.protocol === "http:" && nextUrl.protocol === "https:" && from.hostname === nextUrl.hostname
                ? "the server redirected http→https, which dropped the base URL's credentials; use an https base URL"
                : `the redirect to ${nextUrl.origin} dropped the base URL's credentials (they are sent to their own origin only)`;
          }
          headers = engineHeadersOnly(headers);
        }
        url = nextUrl.toString();
        redirects += 1;
        continue;
      }

      const contentType = String(headerValue(responseHeaders["content-type"]) ?? "");
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
          throw new CkanApiError({ status, url, method, body: this.scrub(body.toString("utf8")), detail });
        }
        throw this.toApiError(method, url, status, body, status === 401 || status === 403 ? dropped : undefined, {
          retries: attempt,
          ...(tooLong ? { retryAfterMs: retryAfter } : {}),
        });
      }

      return { data: body, contentType, status, url };
    }
  }

  /** Perform a GET expecting JSON and parse it into `T`. */
  async getJson<T>(path: string, query?: QueryParams): Promise<T> {
    const res = await this.request("GET", path, { query, accept: "application/json" });
    const text = decodeBody(res.data, res.contentType, res.url);
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      // Name the URL and what came back: a site that is not a CKAN (or not at this
      // path) typically answers with an HTML page and HTTP 200.
      // The Content-Type is server text (latin-1 decoded, so a 0x9B byte is the
      // 8-bit CSI U+009B): sanitise it before it reaches stderr.
      const mediaType = sanitizeServerText(res.contentType.split(";")[0]!);
      const message = /json/i.test(mediaType)
        ? `Invalid JSON from ${cutForMessage(redactUrl(res.url))}`
        : `Expected JSON from ${cutForMessage(redactUrl(res.url))} but got ${mediaType || "a body that is not JSON"}`;
      throw new CkanParseError(message, { cause: this.scrubCause(cause) });
    }
  }

  private toApiError(
    method: string,
    url: string,
    status: number,
    body: Buffer,
    hint: string | undefined,
    retry: { retries: number; retryAfterMs?: number },
  ): CkanApiError {
    const text = this.scrub(body.toString("utf8"));
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
    if (hint !== undefined) detail = detail === undefined ? hint : `${detail}; ${hint}`;
    return new CkanApiError({
      status,
      url,
      method,
      body: text,
      detail,
      retries: retry.retries,
      ...(retry.retryAfterMs === undefined ? {} : { retryAfterMs: retry.retryAfterMs, maxRetryAfterMs: MAX_RETRY_AFTER_MS }),
    });
  }
}

/** `url` without its userinfo (`https://user:pw@host/x` → `https://host/x`), as written otherwise. */
function withoutUserinfo(url: string): string {
  const [userinfo] = credentialsIn(url);
  return userinfo === undefined ? url : url.replace(`://${userinfo}@`, "://");
}

/**
 * The `Authorization` header for a URL's userinfo (`Basic base64(user:password)`,
 * both percent-decoded, as Node's own http client builds it), or undefined without
 * userinfo.
 */
function basicAuthorization(url: string): string | undefined {
  const parsed = new URL(url);
  if (parsed.username === "" && parsed.password === "") return undefined;
  const pair = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
  return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
}

/** The origin (scheme, host, port) of a URL, or the value itself if it doesn't parse. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Decode a response body by the charset of its Content-Type (UTF-8 when none is
 * given, as JSON requires). A leading byte-order mark is dropped: TextDecoder does
 * that by default, where Buffer#toString kept it and JSON.parse then failed. CKAN
 * sends UTF-8; this matters for proxies and mirrors that re-encode.
 */
function decodeBody(body: Buffer, contentType: string, url: string): string {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    throw new CkanParseError(
      `Unsupported response charset "${sanitizeServerText(charset)}" from ${cutForMessage(redactUrl(url))}.`,
    );
  }
  return decoder.decode(body);
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
