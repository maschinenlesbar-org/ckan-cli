// Error types raised by the client. Kept free of any I/O so they are trivial to
// construct in tests and to `instanceof`-check by consumers.

/**
 * Replace the userinfo of a URL (`https://user:secret@host/...`) with `***`, so a
 * credential in a base URL never reaches an error message, a log or CI output.
 * A URL without userinfo, or one that does not parse, is returned unchanged.
 */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username === "" && parsed.password === "") return url;
  parsed.username = "***";
  parsed.password = "";
  return parsed.href;
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
  readonly body: string;

  constructor(args: {
    status: number;
    url: string;
    method: string;
    body: string;
    detail?: string;
  }) {
    // The URL is shown without userinfo: a credential in --base-url must not leak.
    const url = redactUrl(args.url);
    const detailPart = args.detail ? `: ${args.detail}` : "";
    super(`HTTP ${args.status} for ${args.method} ${url}${detailPart}`);
    this.status = args.status;
    this.url = url;
    this.method = args.method;
    this.body = args.body;
    this.detail = args.detail;
  }

  /** True for statuses the API documents as transient and retry-able. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status === 503;
  }
}

/** A transport-level failure (DNS, connection reset, timeout, ...). */
export class CkanNetworkError extends CkanError {}

/** The response body could not be parsed as the expected JSON shape. */
export class CkanParseError extends CkanError {}

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
  const match = /\[Reason: (?:[\w.$]+(?:Exception|Error): )?([\s\S]*?)(?:\\+n|\n|\])/.exec(message);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\\+(['"])/g, "$1").trim();
}
