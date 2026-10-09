// Input rules of the library, as pure functions. Each `…Problem` function returns
// the reason a value is invalid, or `undefined` when it is valid. Client methods
// enforce them with `assertValid` before any request; the CLI's value parsers call
// the same functions, so a rule is written once and the CLI and the library agree.

import { CkanValidationError, cutForMessage } from "./errors.js";

/** A rule: the reason `value` is invalid (one sentence), or `undefined` when it is valid. */
export type Problem<T = unknown> = (value: T) => string | undefined;

/**
 * Throw `CkanValidationError("Invalid <name>: <reason>")` when `problem` finds
 * something wrong with `value`; otherwise return `value` unchanged. A method that
 * returns a promise calls this inside its async body, so a bad input rejects
 * rather than throwing synchronously.
 */
export function assertValid<T>(name: string, value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new CkanValidationError(`Invalid ${name}: ${reason}`);
  return value;
}

/** True for an empty or whitespace-only string: CKAN reads it as "not given". */
export function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * A blank string, or a list with a blank entry. CKAN treats an empty parameter as
 * no filter, so a blank search, filter, sort, facet field or tag query would
 * silently return the unfiltered result. Values that are not strings pass.
 */
export function blankProblem(value: unknown): string | undefined {
  const blank = (v: unknown): boolean => typeof v === "string" && isBlank(v);
  if (blank(value) || (Array.isArray(value) && value.some(blank))) return "Expected a non-empty value.";
  return undefined;
}

/** A non-blank string (an id, a query, a sort expression); anything else is refused. */
export function textProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  return blankProblem(value);
}

/** A list of non-blank strings (filter queries, facet fields). */
export function textListProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return "Expected a list of strings.";
  if (value.some((v) => typeof v !== "string")) return "Expected a list of strings.";
  return blankProblem(value);
}

/**
 * A value the query-string builder can send: a string, a finite number, a boolean
 * or a Date, or a list of them (`null`/`undefined` mean "not given"). An object, a
 * function or `NaN` would go out as `[object Object]` or `NaN`.
 */
export function queryValueProblem(value: unknown): string | undefined {
  const ok = (v: unknown): boolean =>
    v === null ||
    v === undefined ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v)) ||
    (v instanceof Date && !Number.isNaN(v.getTime()));
  if (Array.isArray(value) ? value.every(ok) : ok(value)) return blankProblem(value);
  return "Expected a string, a finite number, a boolean or a Date (or a list of them).";
}

/**
 * A count or offset (`rows`, `start`, `offset`): a non-negative safe integer.
 * A negative, fractional or non-finite value would go upstream as given, and
 * the `all_fields` pager would step on from it.
 */
export function countProblem(value: number): string | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? undefined : "Expected a non-negative integer.";
}

/** A `facet_limit`: -1 (every value) or a non-negative safe integer. */
export function facetLimitProblem(value: number): string | undefined {
  return value === -1 || countProblem(value) === undefined ? undefined : "Expected -1 or a non-negative integer.";
}

/**
 * A rule for a safe integer within `[min, max]`; the messages are the CLI's
 * (`Must be >= 0.`), so a flag and a client option report the same reason.
 */
export function intRangeProblem(min: number, max: number): Problem<number> {
  return (value) => {
    if (!Number.isSafeInteger(value)) return `Expected an integer from ${min} to ${max}.`;
    if (value < min) return `Must be >= ${min}.`;
    if (value > max) return `Must be <= ${max}.`;
    return undefined;
  };
}

/**
 * A value for an HTTP header (the User-Agent): not blank, no C0 control other
 * than tab, no DEL, nothing above U+00FF. Node's HTTP layer refuses those at
 * request time with an untyped "Invalid character in header content", and a
 * custom transport might send a CR/LF on as a forged header. Checked by char code
 * so the source stays free of control bytes.
 */
export function headerValueProblem(value: string): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  const blank = blankProblem(value);
  if (blank !== undefined) return blank;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09) || c === 0x7f) return "Value contains control characters.";
    if (c > 0xff) return "Value contains characters outside Latin-1 (above U+00FF).";
  }
  return undefined;
}

/**
 * A base URL (the CKAN site URL), checked in this order:
 *
 * - not blank;
 * - no surrounding or embedded whitespace and no control characters: `new URL`
 *   trims and drops tab/newline silently, but the client glues the value into
 *   every request URL as given, so a trailing space would request another path
 *   (`/ckan%20/api/3/...`) or reach a custom transport raw;
 * - an absolute URL with an http(s) scheme (`file:`, `ftp:` … never reach a
 *   transport);
 * - no query string or fragment: the API path is appended, so it would land in
 *   front of `/api/3/action`;
 * - a `%` in the user name or password must start a valid escape (`%25` for a
 *   literal one): the engine decodes the userinfo for the Authorization header.
 *
 * Userinfo (`https://user:pw@host`) is allowed; error messages redact it. The
 * reasons never quote the value, so a credential in it cannot leak through them.
 */
export function baseUrlProblem(value: string): string | undefined {
  if (typeof value !== "string") return "Expected a string with an absolute http(s) URL.";
  if (isBlank(value)) return "Expected an absolute http(s) URL.";
  if (value !== value.trim()) return "A base URL cannot have surrounding whitespace.";
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || /\s/u.test(ch)) return "A base URL cannot contain whitespace or control characters.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Expected an absolute http(s) URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Unsupported scheme "${cutForMessage(url.protocol)}". Expected an http(s) URL.`;
  }
  if (/[?#]/.test(value)) return "Expected a site URL without a query string or fragment.";
  // The engine decodes the userinfo into the Authorization header; a "%" that isn't an
  // escape would fail there ("URI malformed") at request time. Reject it here.
  for (const part of [url.username, url.password]) {
    try {
      decodeURIComponent(part);
    } catch {
      return 'The user name or password has a "%" that is not followed by two hex digits; write a literal "%" as %25.';
    }
  }
  return undefined;
}
