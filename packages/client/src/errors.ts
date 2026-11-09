// Error types raised by the client. Kept free of any I/O so they are trivial to
// construct in tests and to `instanceof`-check by consumers.

/**
 * Replace the userinfo of a URL (`https://user:secret@host/...`) with `***`, so a
 * credential in a base URL never reaches an error message, a log or CI output.
 * A value that does not parse as a URL (a port typo, an unencoded `#` in the
 * password, no scheme) has its userinfo cut out by text (`credentialsIn`); a
 * value without userinfo is returned unchanged.
 */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A value that doesn't parse can still carry credentials: cut them out by text.
    return redactCredentials(url, credentialsIn(url));
  }
  // A URL without userinfo, or `user:pw@host` without a scheme (it parses as a URL with
  // the scheme "user:"), which is no URL with credentials at all.
  if (parsed.username === "" && parsed.password === "") return redactCredentials(url, credentialsIn(url));
  parsed.username = "***";
  parsed.password = "";
  return parsed.href;
}

/**
 * The userinfo a URL carries, exactly as written — `["alice:pa#ss"]` for
 * `https://alice:pa#ss@host` — or `[]` when it carries none. Only a value that starts
 * with a scheme (`^[A-Za-z][A-Za-z0-9+.-]*://`, or a special one such as `http:` with any
 * slashes or backslashes after it, as WHATWG reads it) counts: a bare `a:b@c` is a dataset id, a
 * search text or a User-Agent as often as a credential, and the base URL always has a
 * scheme. It works on URLs that don't parse too: the userinfo is everything between
 * `://` and the last `@` before the host. Used to redact those exact strings from text
 * that echoes the value (usage errors, help), whatever characters the password contains.
 */
export function credentialsIn(value: string): string[] {
  // WHATWG skips any number of "/" and "\" after a special scheme (`http:///u:pw@h`,
  // `https:\\u:pw@h` and `http:u:pw@h` all send `u:pw`), so its userinfo starts after them.
  const scheme = SPECIAL_SCHEME_START.exec(value) ?? /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(value);
  if (scheme === null) return [];
  const rest = value.slice(scheme[0].length);
  let parses = false;
  try {
    new URL(value);
    parses = true;
  } catch {
    // Doesn't parse: the password may hold "/", "?", "#" or spaces.
  }
  // In a URL that parses, the userinfo ends at the last "@" of the authority (before the
  // first "/", "?" or "#", and for a special scheme such as http(s) a "\", where WHATWG ends
  // it too: `https://u:pw@a.example\@b.example` sends `u:pw` to a.example); in one that doesn't,
  // at the last "@" of the value.
  const stop = SPECIAL_SCHEME.test(scheme[0]) ? /[/?#\\]|$/ : /[/?#]|$/;
  const authority = parses ? rest.slice(0, rest.search(stop)) : rest;
  const end = authority.lastIndexOf("@");
  return end > 0 ? [rest.slice(0, end)] : [];
}

/** The schemes WHATWG parses as special (`ftp`, `file`, `http(s)`, `ws(s)`): their authority also ends at a backslash. */
const SPECIAL_SCHEME = /^(?:ftp|file|https?|wss?):[/\\]*$/i;
/** A special scheme at the start of a value, with the slashes and backslashes WHATWG skips after it. */
const SPECIAL_SCHEME_START = /^(?:ftp|file|https?|wss?):[/\\]*/i;

/** A scheme character (RFC 3986: letters, digits, `+`, `.`, `-`). */
function isSchemeChar(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2e || code === 0x2d;
}

/** An ASCII letter, with which a scheme starts. */
function isLetter(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a);
}

/**
 * Where the scheme of the `://` at `at` starts: the first letter of the run of scheme characters
 * before it, looking back no further than `from`; -1 when there is none (`1://`, ` ://`). A run
 * led by other scheme characters (`-https://`) starts at its first letter.
 */
function schemeStart(text: string, at: number, from: number): number {
  let start = at;
  while (start > from && isSchemeChar(text.charCodeAt(start - 1))) start--;
  while (start < at && !isLetter(text.charCodeAt(start))) start++;
  return start < at ? start : -1;
}

/**
 * `text` with the userinfo of every URL in it replaced by `***` (`https://user:secret@host`
 * becomes `https://***@host`): the pattern backstop for text no exact secret matches. Text-based,
 * so it also covers a URL that does not parse; the userinfo ends at the last `@` before the first
 * whitespace, `/`, `?`, `#` or `'` after `://`. Linear in `text`, however many URLs it holds: each
 * `://` is found with `indexOf`, its scheme by walking back no further than the previous `://`,
 * and the search goes on right after each `://`, not after the authority it read: a URL glued
 * onto the one before it (`https://host://u:p@h`, `https://u:p@x://v:q@w`) starts inside that
 * authority, which ends at its `/`. An authority holds no `/`, so no `://` lies wholly inside one,
 * and every character is read a bounded number of times: by the authority loop and `indexOf`
 * forwards, by `schemeStart` backwards. The regex it replaces (a scheme tried at every
 * word boundary) was quadratic: an 80 KB answer of `a.a.…` took about 5 s to print.
 */
export function redactUrlUserinfo(text: string): string {
  const parts = new TextBuilder();
  let copied = 0;
  let from = 0;
  for (let at = text.indexOf("://"); at !== -1; at = text.indexOf("://", from)) {
    const begin = at + 3;
    let end = begin;
    let lastAt = -1;
    for (; end < text.length; end++) {
      const c = text.charCodeAt(end);
      if (c === 0x2f || c === 0x3f || c === 0x23 || c === 0x27 || /\s/.test(text[end] as string)) break;
      if (c === 0x40) lastAt = end;
    }
    if (lastAt !== -1 && schemeStart(text, at, from) !== -1) {
      parts.push(text.slice(copied, begin), "***");
      copied = lastAt;
    }
    from = begin;
  }
  if (copied === 0) return text;
  parts.push(text.slice(copied));
  return parts.toString();
}

/** How many pieces a TextBuilder joins at a time. */
const BUILDER_BATCH = 16_384;

/**
 * A text put together from many pieces (slices of a server answer and their replacements),
 * joined in batches of BUILDER_BATCH into flat strings, so memory stays proportional to the text,
 * not to the number of pieces. One `+=` per piece made a rope node each, and one array of every
 * piece a slot each: millions of lone-surrogate repairs in a large answer exhausted a small heap
 * either way.
 */
export class TextBuilder {
  readonly #done: string[] = [];
  #batch: string[] = [];

  push(...pieces: string[]): void {
    for (const piece of pieces) this.#batch.push(piece);
    if (this.#batch.length >= BUILDER_BATCH) {
      this.#done.push(this.#batch.join(""));
      this.#batch = [];
    }
  }

  toString(): string {
    this.#done.push(this.#batch.join(""));
    this.#batch = [];
    return this.#done.join("");
  }
}

/**
 * The forms in which a server may echo the credentials of a userinfo (`user:password`,
 * as `credentialsIn` returns it) back in an error body: the `Authorization: Basic` value
 * (base64 of the decoded `user:password`, UTF-8 as the engine sends it), the decoded
 * `user:password` itself, and the password alone when it is at least 4 characters long.
 * `[]` for a userinfo without a password. None of them has an `@` to anchor on, so they
 * are replaced as exact strings (`redactSecrets`).
 */
export function echoedCredentialForms(userinfo: string): string[] {
  const colon = userinfo.indexOf(":");
  if (colon < 0) return [];
  const decode = (part: string): string => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const user = decode(userinfo.slice(0, colon));
  const password = decode(userinfo.slice(colon + 1));
  if (password === "") return [];
  const pair = `${user}:${password}`;
  const forms = [Buffer.from(pair, "utf8").toString("base64"), pair];
  if (password.length >= 4) forms.push(password);
  return forms;
}

/** `text` with every occurrence of each of `secrets` (exact strings, no anchor) replaced by `***`. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    out = out.split(secret).join("***");
  }
  return out;
}

/**
 * `text` with every occurrence of each credential (as `credentialsIn` returns them) that is
 * followed by `@` replaced by `***`. Matching the exact strings, not a pattern, covers
 * passwords with spaces, quotes, `#`, `?` or `/` that no URL pattern can delimit.
 */
export function redactCredentials(text: string, credentials: readonly string[]): string {
  let out = text;
  for (const secret of credentials) {
    if (secret === "") continue;
    out = out.split(`${secret}@`).join("***@");
  }
  return out;
}

/**
 * Longest URL or server text (in characters) an error message shows. A long search
 * query or a 200 kB error page would otherwise put one huge line on stderr or in a CI
 * log. The error's `url`, `detail` and `body` properties keep the full value. Every
 * value an own message quotes from a server answer or the user's input (a redirect
 * target, a charset, a Content-Type, an action name, a typed option value) is cut at
 * this length too, so a library caller's `err.message` stays bounded.
 */
export const MAX_MESSAGE_VALUE_LENGTH = 500;

/** `text` cut to MAX_MESSAGE_VALUE_LENGTH characters (never inside a surrogate pair), ending in "…" when cut. */
export function cutForMessage(text: string): string {
  return text.length > MAX_MESSAGE_VALUE_LENGTH ? `${cutText(text, MAX_MESSAGE_VALUE_LENGTH)}…` : text;
}

/**
 * `text` cut to at most `max` UTF-16 units, never inside a surrogate pair: when the cut
 * would land after a high surrogate it is made one unit earlier, so a message that holds
 * the cut text is well-formed (a lone `\ud83d` makes jq reject a whole JSON stream).
 * Text no longer than `max` is returned as it is; the caller marks a cut.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = max > 0 && isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;
  return text.slice(0, end);
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

/** Unicode General Category Cf (format): bidi controls, zero-width characters, U+00AD, U+FEFF, … */
const FORMAT_CHAR = /\p{Cf}/u;

/**
 * Quote a value for an error message, as `JSON.stringify` does, and also escape what it
 * leaves raw although a terminal acts on it: DEL, the C1 controls, every Unicode
 * format character (bidi overrides, zero-width characters) and the line and paragraph
 * separators U+2028/U+2029, which a viewer may break the line at. A value is echoed in
 * messages, and it can come from a pipeline or from the portal; an override in it would
 * reorder the rest of the line ("Trojan Source"), a zero-width space would hide why it
 * was refused. A value longer than MAX_MESSAGE_VALUE_LENGTH characters is cut, and the
 * "…" goes after the closing quote (`"AAAA"…`), so it does not read as part of the value.
 * The quoted part stays a valid JSON string.
 */
export function quoteValue(value: string): string {
  const cut = value.length > MAX_MESSAGE_VALUE_LENGTH;
  let out = "";
  for (const ch of JSON.stringify(cut ? cutText(value, MAX_MESSAGE_VALUE_LENGTH) : value)) {
    const n = ch.codePointAt(0) ?? 0;
    if ((n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029 || FORMAT_CHAR.test(ch)) {
      // One escape per UTF-16 unit, so a character above U+FFFF stays valid JSON.
      for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return cut ? `${out}…` : out;
}

/**
 * `text` with every lone surrogate (half of a character) replaced by U+FFFD, like
 * `String.prototype.toWellFormed` (ES2024, so not in this package's `lib`).
 */
export function toWellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/** Base class for every error originating from this client. */
export class CkanError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * The API responded with a non-2xx status code. `detail` holds a human-readable
 * message extracted from the response body when one is present.
 */
export class CkanApiError extends CkanError {
  readonly status: number;
  readonly detail: string | undefined;
  readonly url: string;
  readonly method: string;
  /**
   * The answer's body as text, the base URL's credentials scrubbed. As sent, unless it is JSON
   * whose decoded text still holds an echoed credential behind an escape: then the decoded JSON
   * written again (other escapes, no insignificant whitespace) with it replaced by `***`, and `""`
   * for such a body nested too deeply to write again.
   */
  readonly body: string;
  /** How many times the engine retried the request before giving up (0 when it did not). */
  readonly retries: number;
  /**
   * The wait the server asked for in `Retry-After` (milliseconds) when it was longer
   * than the engine waits (`MAX_RETRY_AFTER_MS`), so the request was not retried;
   * else undefined.
   */
  readonly retryAfterMs: number | undefined;

  constructor(args: {
    status: number;
    url: string;
    method: string;
    body: string;
    detail?: string;
    retries?: number;
    retryAfterMs?: number;
    maxRetryAfterMs?: number;
  }) {
    // The URL is shown without userinfo: a credential in --base-url must not leak.
    const url = redactUrl(args.url);
    const parts: string[] = [];
    if (args.detail) parts.push(cutForMessage(args.detail));
    if (args.retryAfterMs !== undefined) {
      // Say why the retries the caller asked for never ran: the server asked for a
      // wait longer than the engine sleeps, and retrying earlier would land inside it.
      const wait = Math.ceil(args.retryAfterMs / 1000);
      const cap = args.maxRetryAfterMs === undefined ? "" : `, longer than the ${args.maxRetryAfterMs / 1000} s the client waits`;
      parts.push(`the server asked to retry after ${wait} s${cap}; not retried — try again after that`);
    }
    const detailPart = parts.length > 0 ? `: ${parts.join("; ")}` : "";
    const retries = args.retries ?? 0;
    // Say that the status persisted through retries, so a user knows whether raising
    // --max-retries could help.
    const retryPart = retries > 0 ? ` (after ${retries} ${retries === 1 ? "retry" : "retries"})` : "";
    super(`HTTP ${args.status} for ${args.method} ${cutForMessage(url)}${detailPart}${retryPart}`);
    this.status = args.status;
    this.url = url;
    this.method = args.method;
    this.body = args.body;
    this.detail = args.detail;
    this.retries = retries;
    this.retryAfterMs = args.retryAfterMs;
  }

  /** True for statuses the API documents as transient and retry-able. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

/**
 * CKAN answered with a `success: false` envelope on a 2xx status: the portal's own error
 * answer, which CKAN can send with HTTP 200 (an error status is a `CkanApiError`). The
 * message is `GET <url>: CKAN action "<action>" failed: <CKAN's error, one line>`; `errorType` is
 * CKAN's `__type` (`"Not Found Error"`, `"Authorization Error"`, `"Validation Error"`),
 * or undefined when the error carries none.
 */
export class CkanActionError extends CkanError {
  readonly action: string;
  readonly errorType: string | undefined;
  /** The URL that answered, userinfo redacted; empty when the error was built without one. */
  readonly url: string;

  constructor(message: string, args: { action: string; errorType?: string | undefined; url?: string | undefined }) {
    super(message);
    this.action = args.action;
    this.errorType = args.errorType;
    this.url = args.url === undefined ? "" : redactUrl(args.url);
  }

  /** True for CKAN's `Not Found Error`: what a 404 says, sent with HTTP 200. */
  get isNotFound(): boolean {
    return this.errorType === "Not Found Error";
  }
}

/** A transport-level failure (DNS, connection reset, timeout, ...). */
export class CkanNetworkError extends CkanError {}

/** The response body could not be parsed as the expected JSON shape. */
export class CkanParseError extends CkanError {}

/**
 * An input the library refuses before sending any request: a client option or a
 * method parameter that breaks one of the rules in `validate.ts`. The message is
 * `Invalid <name>: <reason>`. The CLI reports it as a usage error.
 */
export class CkanValidationError extends CkanError {}

/**
 * Turn a CKAN `error` object into one readable line. CKAN has two shapes: a
 * `message` (`{"__type": "Not Found Error", "message": "Not found"}`), and a
 * validation error that maps each offending field to its messages instead
 * (`{"__type": "Validation Error", "rows": ["Invalid integer"]}`).
 */
export function describeCkanError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const { __type: type, message, ...fields } = error as Record<string, unknown>;
  let text: string;
  if (typeof message === "string") {
    text = solrReason(message) ?? message;
  } else {
    text = Object.entries(fields)
      .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
      .join("; ");
  }
  return typeof type === "string" ? `${type}: ${text}` : text;
}

/**
 * Solr's own reason inside a CKAN "Search Error" message, or undefined. CKAN
 * reports a Solr failure as the whole Solr query in a (nested) Python repr, with
 * the useful part as `[Reason: <java class>: <text>\nWas expecting …]`, its
 * quotes and newlines escaped several levels deep.
 */
function solrReason(message: string): string | undefined {
  // Only a window after the first "[Reason: " is read: the pattern's lazy group, tried against
  // `\\+n` at every step, is quadratic on a run of backslashes, and the message is uncut server
  // text (80 KB took 2.4 s, past --timeout, and it grows with the square). The window is twice what a
  // message shows; a reason that runs past it ends at the window's end.
  const at = message.indexOf(REASON);
  if (at === -1) return undefined;
  const end = at + REASON.length + 2 * MAX_MESSAGE_VALUE_LENGTH;
  const window = message.slice(at, end);
  const pattern = end < message.length ? SOLR_REASON_IN_CUT_WINDOW : SOLR_REASON;
  const match = pattern.exec(window);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\\+(['"])/g, "$1").trim();
}

const REASON = "[Reason: ";
const SOLR_REASON = /^\[Reason: (?:[\w.$]+(?:Exception|Error): )?([\s\S]*?)(?:\\+n|\n|\])/;
const SOLR_REASON_IN_CUT_WINDOW = /^\[Reason: (?:[\w.$]+(?:Exception|Error): )?([\s\S]*?)(?:\\+n|\n|\]|$)/;
