// Input rules of the library, as pure functions. Each `…Problem` function returns
// the reason a value is invalid, or `undefined` when it is valid. Client methods
// enforce them with `assertValid` before any request; the CLI's value parsers call
// the same functions, so a rule is written once and the CLI and the library agree.

import { CkanValidationError } from "./errors.js";

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
