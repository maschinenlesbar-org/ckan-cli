// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { CkanClient } from "../client/client.js";
import { DEFAULT_BASE_URL, MAX_RETRIES, MAX_RETRY_AFTER_MS } from "../client/engine.js";
import { MAX_TIMEOUT_MS } from "../client/http.js";
import { cutForMessage, redactUrl } from "../client/errors.js";
import { once, parseBaseUrl, parseBoundedInt, parseHeaderValue, parseIntArg, parsePortal } from "./shared.js";
import { registerCatalogueCommands } from "./commands/catalogue.js";
import { registerPortalCommands } from "./commands/portal.js";
import { DEFAULT_LOG_FORMAT, logFormatProblem } from "./log.js";

/**
 * Single source of truth for the version: read from package.json at runtime
 * rather than duplicating a literal that can silently drift after a release bump.
 * From the compiled location (dist/src/cli/program.js) package.json is three
 * directories up; the same offset holds for the source under src/cli.
 */
function readVersion(): string {
  try {
    const pkgUrl = new URL("../../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();

/** Default dependencies: real client + real stdout/stderr + real environment. */
export const defaultDeps: CliDeps = {
  io: defaultIO,
  env: process.env,
  createClient: (options) => new CkanClient(options),
};

/** commander value-parser for `--log-format`. */
function parseLogFormat(value: string): string {
  const problem = logFormatProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
}

/**
 * commander's hint for a mistyped command, `\n(Did you mean status?)` (or `one of a, b`),
 * or "" when nothing is close: the same rule as commander's own (an optimal-string-
 * alignment distance below 3 that keeps more than 40 % of the word). The root action
 * reports an unknown command itself, so commander's suggestion is rebuilt here.
 */
export function suggestSimilar(word: string, candidates: readonly string[]): string {
  let similar: string[] = [];
  let best = 3;
  for (const candidate of new Set(candidates)) {
    if (candidate.length <= 1) continue;
    const distance = editDistance(word, candidate, best);
    const length = Math.max(word.length, candidate.length);
    if ((length - distance) / length <= 0.4) continue;
    if (distance < best) {
      best = distance;
      similar = [candidate];
    } else if (distance === best) {
      similar.push(candidate);
    }
  }
  similar.sort((a, b) => a.localeCompare(b));
  if (similar.length > 1) return `\n(Did you mean one of ${similar.join(", ")}?)`;
  return similar.length === 1 ? `\n(Did you mean ${similar[0]}?)` : "";
}

/** Optimal-string-alignment distance between `a` and `b`; at least `cap` when it is that far. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) >= cap) return Math.max(a.length, b.length);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();
  const baseUrlDefault = deps.env["CKAN_BASE_URL"] || DEFAULT_BASE_URL;

  program
    .name("ckan")
    .description("CLI for any CKAN open-data portal (Action API v3)")
    .version(VERSION)
    .addOption(
      new Option("--base-url <url>", "CKAN site URL (env CKAN_BASE_URL)")
        .argParser(once(parseBaseUrl))
        // The help shows the default without userinfo: a password in
        // CKAN_BASE_URL must not end up in `--help` output or CI logs.
        .default(baseUrlDefault, JSON.stringify(redactUrl(baseUrlDefault))),
    )
    .addOption(
      new Option("--portal <id>", "a known portal by id (see `ckan portals`)")
        .argParser(once(parsePortal))
        .conflicts("baseUrl"),
    )
    .option("--timeout <ms>", "per-request timeout in milliseconds", once(parseBoundedInt(0, MAX_TIMEOUT_MS)))
    .option("--user-agent <ua>", "User-Agent header value", once(parseHeaderValue))
    .option(
      "--max-retries <n>",
      `retries for transient 429/503 responses (0..${MAX_RETRIES}; each backs off linearly, or waits a longer Retry-After up to ${MAX_RETRY_AFTER_MS / 1000} s)`,
      once(parseBoundedInt(0, MAX_RETRIES)),
    )
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      once(parseIntArg),
    )
    .option(
      "--log-format <format>",
      `how errors, warnings and notes are written to stderr: text (log4j style: time, level, [topic], message) or jsonl (one JSON object per line: ts, level, topic, msg); default ${DEFAULT_LOG_FORMAT}`,
      once(parseLogFormat),
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .showHelpAfterError();

  // A bare invocation (no subcommand) should print help to stdout and exit 0,
  // matching `ckan help` / `ckan --help`. Without an explicit root action,
  // commander writes help to stderr and exits 1 for the empty-command case.
  // A root action turns off two things commander otherwise does for a program
  // with subcommands, so both are restored: the implicit `help [command]`
  // subcommand (helpCommand(true)), and the "unknown command" error — the
  // action receives the stray operand (allowExcessArguments below) and reports
  // it, instead of commander's "too many arguments".
  program.helpCommand(true);
  program.action(() => {
    const [unknown] = program.args;
    if (unknown !== undefined) {
      // The name is the user's: cut, after its credentials are redacted (a cut could
      // otherwise leave part of a password without the "@" the redaction keys on).
      const names = program.commands.map((c) => c.name()).filter((name) => name !== "help");
      program.error(`error: unknown command '${cutForMessage(redactUrl(unknown))}'${suggestSimilar(unknown, names)}`, {
        code: "commander.unknownCommand",
      });
    }
    program.help();
  });

  // commander runs value parsers on flags but not on defaults, so a base URL
  // taken from CKAN_BASE_URL is checked here, before a command that uses it runs.
  // The commands that never use it skip the check: help (the root action prints
  // help or names an unknown command, `help` prints help) and `portals`, which
  // prints the built-in list or checks each portal at its own URL — a user whose
  // variable is broken is exactly the one looking for a working portal id.
  const offline = new Set(["help", "portals"]);
  program.hook("preAction", (_program, actionCommand) => {
    if (actionCommand === program || offline.has(actionCommand.name())) return;
    if (program.getOptionValueSource("baseUrl") !== "default" || program.opts()["portal"] !== undefined) return;
    try {
      parseBaseUrl(program.opts<{ baseUrl: string }>().baseUrl);
    } catch (err) {
      if (!(err instanceof InvalidArgumentError)) throw err;
      program.error(`error: CKAN_BASE_URL: ${err.message}`);
    }
  });

  registerCatalogueCommands(program, deps);
  registerPortalCommands(program, deps);
  // Set after the subcommands exist (they copy this setting when created), so it
  // applies to the root only: a stray operand reaches the root action above.
  program.allowExcessArguments(true);

  return program;
}
