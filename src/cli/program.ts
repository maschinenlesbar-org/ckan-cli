// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError, Option } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { CkanClient } from "../client/client.js";
import { DEFAULT_BASE_URL, MAX_RETRIES } from "../client/engine.js";
import { MAX_TIMEOUT_MS } from "../client/http.js";
import { redactUrl } from "../client/errors.js";
import { parseBaseUrl, parseBoundedInt, parseIntArg, parsePortal } from "./shared.js";
import { registerCatalogueCommands } from "./commands/catalogue.js";
import { registerPortalCommands } from "./commands/portal.js";

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

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();
  const baseUrlDefault = deps.env["CKAN_BASE_URL"] || DEFAULT_BASE_URL;

  program
    .name("ckan")
    .description("CLI for any CKAN open-data portal (Action API v3)")
    .version(VERSION)
    .addOption(
      new Option("--base-url <url>", "CKAN site URL (env CKAN_BASE_URL)")
        .argParser(parseBaseUrl)
        // The help shows the default without userinfo: a password in
        // CKAN_BASE_URL must not end up in `--help` output or CI logs.
        .default(baseUrlDefault, JSON.stringify(redactUrl(baseUrlDefault))),
    )
    .addOption(
      new Option("--portal <id>", "a known portal by id (see `ckan portals`)")
        .argParser(parsePortal)
        .conflicts("baseUrl"),
    )
    .option("--timeout <ms>", "per-request timeout in milliseconds", parseBoundedInt(0, MAX_TIMEOUT_MS))
    .option("--user-agent <ua>", "User-Agent header value")
    .option(
      "--max-retries <n>",
      "retries for transient 429/503 responses (0..10; each waits the server's Retry-After, up to 30 s)",
      parseBoundedInt(0, MAX_RETRIES),
    )
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      parseIntArg,
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .showHelpAfterError();

  // A bare invocation (no subcommand) should print help to stdout and exit 0,
  // matching `ckan help` / `ckan --help`. Without an explicit root action,
  // commander writes help to stderr and exits 1 for the empty-command case.
  program.action(() => {
    program.help();
  });

  // commander runs value parsers on flags but not on defaults, so a base URL
  // taken from CKAN_BASE_URL is checked here, before any command runs.
  program.hook("preAction", () => {
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

  return program;
}
