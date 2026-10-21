// Shared helpers used across CLI command groups: option parsers and the global
// option resolver. Results are written by output.ts.

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import { logOf, type CliDeps } from "./io.js";
import { cleartextProblem, DEFAULT_BASE_URL, type EngineOptions, type RetryEvent } from "@maschinenlesbar.org/ckan-client/internal/engine";
import { quoteValue, redactUrl } from "@maschinenlesbar.org/ckan-client/internal/errors";
import { findPortal } from "@maschinenlesbar.org/ckan-client/internal/portals";
import {
  baseUrlProblem,
  countProblem,
  headerValueProblem,
  idProblem,
  intRangeProblem,
  textProblem,
  type Problem,
} from "@maschinenlesbar.org/ckan-client/internal/validate";
import { PORTALS } from "@maschinenlesbar.org/ckan-client/internal/portals-list";

/** commander value-parser: a non-negative integer. */
export function parseIntArg(value: string): number {
  // Validate the literal shape rather than trusting Number(): that rejects
  // empty/whitespace ("" and " " coerce to 0), hex (0x10) and exponent (1e3)
  // notation, all of which Number() would silently accept.
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer.");
  }
  const n = Number(value);
  // The library's count rule; it also rejects magnitudes that cannot be
  // represented exactly (silent precision loss).
  const reason = countProblem(n);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return n;
}

/**
 * A commander value-parser for the library's `problem` rule (`textProblem`, `idProblem`, …),
 * reported as a usage error before the client is built. The value goes on as typed: the
 * library canonicalises it (`normalizeText`, `normalizeToken`).
 */
function parseWith(problem: Problem<string>): (value: string) => string {
  return (value) => {
    const reason = problem(value);
    if (reason !== undefined) throw new InvalidArgumentError(reason);
    return value;
  };
}

/** commander value-parser for free text (the search text): the library's `textProblem`. */
export const parseText = parseWith(textProblem);

/** commander value-parser for the id or name of a dataset, resource, organization or group: the library's `idProblem`. */
export const parseId = parseWith(idProblem);

/**
 * commander value-parser for a value that ends up in an HTTP header (`--user-agent`):
 * the library's headerValueProblem rule (not blank, no control characters but tab,
 * nothing above U+00FF), reported as a usage error.
 */
export function parseHeaderValue(value: string): string {
  const reason = headerValueProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/**
 * A commander value-parser for an option's value: not another long option, then the library's
 * `problem` rule (`textProblem` for a filter or tag query, `sortProblem`, `fieldProblem`).
 * commander takes the next argument as the value of an option that needs one, even when it is
 * a flag, so a forgotten value (`search --fq --rows 5`) silently shifted the rest into the
 * query (`fq=--rows`, `q=5`) and still exited 0. No CKAN filter, sort, facet field or tag query
 * starts with `--`; a single `-` (a negated Solr filter, `-organization:x`) stays allowed.
 */
export function parseOptionValue(problem: Problem<string>): (value: string) => string {
  const parse = parseWith(problem);
  return (value) => {
    if (value.startsWith("--")) {
      throw new InvalidArgumentError("Expected a value, got another option. Give the option its value first.");
    }
    return parse(value);
  };
}

/**
 * Wrap a commander value-parser for a single-valued option so that a second
 * occurrence is a usage error. commander otherwise keeps only the last value, so
 * `--rows 5 --rows 50` (or a second `--base-url`) silently dropped the first. The
 * wrapper keeps its own count, so it also works for an option with a default (which
 * commander hands the parser as `previous`); build it per program (`buildProgram`).
 */
export function once<T>(parse: (value: string) => T): (value: string) => T {
  let seen = false;
  return (value) => {
    if (seen) throw new InvalidArgumentError("Given more than once; this option takes a single value.");
    seen = true;
    return parse(value);
  };
}

/** commander accumulator for a repeatable option (`--fq`, `--facet`), each value checked by parseOptionValue(problem). */
export function collectValues(problem: Problem<string>): (value: string, previous?: string[]) => string[] {
  const parse = parseOptionValue(problem);
  return (value, previous = []) => previous.concat([parse(value)]);
}

/** Build a commander value-parser for a non-negative integer within [min, max] (the library's intRangeProblem). */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  const problem = intRangeProblem(min, max);
  return (value: string) => {
    const n = parseIntArg(value);
    const reason = problem(n);
    if (reason !== undefined) throw new InvalidArgumentError(reason);
    return n;
  };
}

/**
 * commander value-parser for --base-url (and CKAN_BASE_URL, via the preAction hook
 * in program.ts): the library's baseUrlProblem rule (not blank, no whitespace, an
 * absolute http(s) URL, no query string or fragment), reported as a usage error
 * before the client is built.
 */
export function parseBaseUrl(value: string): string {
  const reason = baseUrlProblem(value);
  if (reason !== undefined) throw new InvalidArgumentError(reason);
  return value;
}

/** commander value-parser for --portal: the URL of a portal in the built-in list. */
export function parsePortal(value: string): string {
  const portal = findPortal(value, PORTALS);
  if (!portal) {
    throw new InvalidArgumentError(`Unknown portal ${quoteValue(redactUrl(value))}. \`ckan portals\` lists the known ones.`);
  }
  return portal.url;
}

export interface GlobalOptions {
  baseUrl?: string;
  /** The URL of the portal chosen with --portal. */
  portal?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxResponseBytes?: number;
  compact?: boolean;
}

/** Translate resolved global CLI options into client EngineOptions. */
export function toEngineOptions(global: GlobalOptions): EngineOptions {
  const options: EngineOptions = {};
  const baseUrl = global.portal ?? global.baseUrl;
  if (baseUrl !== undefined) options.baseUrl = baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  return options;
}

/**
 * Log a warning (`ckan.http`) when the effective base URL (--portal >
 * --base-url > CKAN_BASE_URL > default) is plain `http:` to a host other than loopback
 * (cleartextProblem): requests, and any credentials in the URL, travel unencrypted.
 * Called once per run, after the options are parsed and before the first request;
 * stdout and the exit code are untouched.
 */
export function warnOnCleartext(deps: CliDeps, global: GlobalOptions): void {
  const problem = cleartextProblem(global.portal ?? global.baseUrl ?? DEFAULT_BASE_URL);
  if (problem !== undefined) logOf(deps).warn("http", problem);
}

/** `HTTP 503 from host: retry 1 of 3 in 2 s` (host only; whole seconds, ms under 1 s). */
export function retryMessage(event: RetryEvent): string {
  let host: string;
  try {
    host = new URL(event.url).host;
  } catch {
    host = "the server";
  }
  const why = event.status === undefined ? "connection reset" : `HTTP ${event.status}`;
  const wait = event.delayMs < 1000 ? `${event.delayMs} ms` : `${Math.round(event.delayMs / 1000)} s`;
  return `${why} from ${host}: retry ${event.retry} of ${event.maxRetries} in ${wait}`;
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
}

/**
 * Wrap an async command action with consistent global-option resolution and
 * client construction. The callback receives a context (client + resolved global
 * options + this command's options) and the command's positional arguments.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    warnOnCleartext(deps, global);
    const options = toEngineOptions(global);
    options.onRetry = (event) => logOf(deps).warn("http", retryMessage(event));
    // An answer delivered changed (invalid text replaced with U+FFFD) is never silent.
    options.onWarning = (message) => logOf(deps).warn("api", message);
    const client = deps.createClient(options);
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}
