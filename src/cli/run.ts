// Run the CLI and resolve to a process exit code. Kept separate from the bin
// shim so tests can call run() directly with injected deps and assert on the
// captured output and exit code without spawning a subprocess.

import { CommanderError, type Command } from "commander";
import { buildProgram, defaultDeps } from "./program.js";
import { logOf, type CliDeps } from "./io.js";
import { createLogger, logFormatFromArgv } from "./log.js";
import {
  CkanApiError,
  CkanError,
  CkanNetworkError,
  CkanValidationError,
  credentialsIn,
  redactCredentials,
} from "../client/errors.js";

/** The exit code of a usage error: commander's own for a rejected option value. */
const USAGE_EXIT = 1;

/**
 * Apply exitOverride + output redirection to every command in the tree.
 * commander does not propagate these to subcommands, so a parse error on a
 * subcommand would otherwise call process.exit() and bypass our error handling.
 */
function configureTree(command: Command, deps: CliDeps): void {
  command.exitOverride();
  command.configureOutput({
    writeOut: (str) => deps.io.out(str.replace(/\n$/, "")),
    // commander's own messages are log records too: its "error: …" an ERROR, the help it
    // shows after one an INFO.
    writeErr: (str) => {
      const text = str.replace(/\n$/, "");
      // The blank line commander writes between an error and the help it shows after.
      if (text === "") return;
      if (text.startsWith("error: ")) logOf(deps).error("cli", text.slice("error: ".length));
      else logOf(deps).info("cli", text);
    },
  });
  for (const child of command.commands) configureTree(child, deps);
}

/**
 * Replace the userinfo of every URL in `text` with `***`, the form `redactUrl` gives
 * (`https://user:secret@host` becomes `https://***@host`). Text-based, so it also
 * covers a URL that does not parse; a fallback behind the exact strings of
 * `withRedactedOutput`.
 */
export function redactUserinfo(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#']*@/gi, "$1***@");
}

/** The secrets of a run, and the two ways they are replaced. */
export interface Redaction {
  /** stdout text: the userinfo of every URL-like argument and of CKAN_BASE_URL replaced (`***@`). */
  out(text: string): string;
  /** stderr text, a record's message: the same replacements. */
  err(text: string): string;
}

/**
 * The secrets of the run in `argv` and CKAN_BASE_URL. Commander echoes rejected values in
 * its errors (`--base-url`, `--portal`, a URL typed where the command goes), the client's
 * own messages name the values they refuse, and help shows the base URL's default:
 * whatever path a credential takes to stdout or stderr, the exact userinfo (as
 * `credentialsIn` finds it, plus its JSON-escaped and percent-encoded forms) is replaced
 * by `***`. A pattern alone can't delimit a password with spaces, quotes, `#`, `?` or
 * `/`; the exact strings can. Without credentials the text passes through unchanged.
 */
export function redactionFor(argv: readonly string[], env: Record<string, string | undefined>): Redaction {
  // An `--option=value` token is echoed as its value alone.
  const values = argv.map((token) => (token.startsWith("-") && token.includes("=") ? token.slice(token.indexOf("=") + 1) : token));
  const sources = [...argv, ...values, env["CKAN_BASE_URL"] ?? ""];
  const secrets = new Set<string>();
  const encoded = new Set<string>();
  for (const source of sources) {
    for (const secret of credentialsIn(source)) {
      secrets.add(secret);
      secrets.add(JSON.stringify(secret).slice(1, -1));
      // A URL sent as a parameter (`package <url>`) is echoed percent-encoded in a
      // 404 message: `id=https%3A%2F%2Fuser%3Apw%40host`.
      encoded.add(encodeURIComponent(`${secret}@`));
    }
  }
  if (secrets.size === 0) return { out: (text) => text, err: (text) => text };
  const list = [...secrets];
  const redact = (text: string): string => {
    let out = redactUserinfo(redactCredentials(text, list));
    for (const form of encoded) out = out.split(form).join("***%40");
    return out;
  };
  return { out: redact, err: redact };
}

/**
 * `deps` that keep the secrets of this run (`redactionFor`) out of everything they
 * print: `io.out` is redacted, and the log (`deps.log`) replaces them in each record's
 * message before formatting it, then writes to the raw `io.err`, so the frame is never
 * touched and a password with DEL, C1 or bidi characters is matched in its raw form.
 * `io.err` itself is redacted too, for anything that writes to stderr without the log.
 */
export function withRedactedOutput(deps: CliDeps, argv: readonly string[]): CliDeps {
  const redaction = redactionFor(argv, deps.env);
  const { out, err } = deps.io;
  return {
    ...deps,
    io: { ...deps.io, out: (text) => out(redaction.out(text)), err: (text) => err(redaction.err(text)) },
    log: createLogger({
      format: logFormatFromArgv(argv),
      write: err,
      redact: redaction.err,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    }),
  };
}

/**
 * The index of a `help` command whose topic names no command (`ckan help nonexistent`),
 * or undefined. Commander answers that with the root help on stderr and exit 1, but
 * no line saying what was wrong. Global options before `help` are skipped with their
 * values; scanning stops at `--`.
 */
export function unknownHelpTopic(program: Command, argv: readonly string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") return undefined;
    if (token.startsWith("-")) {
      if (token.includes("=")) continue;
      const option = program.options.find((o) => o.long === token || o.short === token);
      if (option?.required) i++;
      continue;
    }
    if (token !== "help") return undefined;
    const topic = argv[i + 1];
    if (topic === undefined || topic.startsWith("-")) return undefined;
    const known = program.commands.some((c) => c.name() === topic || c.aliases().includes(topic));
    return known ? undefined : i;
  }
  return undefined;
}

export async function run(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  // The log replaces the secrets of the run in every message, in either format.
  deps = withRedactedOutput(deps, argv);
  const program = buildProgram(deps);
  configureTree(program, deps);

  // `help <unknown>` is answered like `<unknown>`: "error: unknown command '<unknown>'",
  // the help after it, exit 1 — not the help alone with a failure code.
  const helpAt = unknownHelpTopic(program, argv);
  if (helpAt !== undefined) argv = argv.filter((_, i) => i !== helpAt);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version requests exit 0; genuine parse errors carry their own code.
      return err.exitCode;
    }
    const log = logOf(deps);
    if (err instanceof CkanValidationError) {
      // An input the library refused before any request (a rule the commander
      // parsers do not see, e.g. one across parameters): a usage error.
      log.error("cli", err.message);
      return USAGE_EXIT;
    }
    if (err instanceof CkanApiError) {
      log.error("api", err.message);
      // Map a few notable statuses to distinct exit codes for scripting.
      if (err.status === 404) return 4;
      return 1;
    }
    if (err instanceof CkanError) {
      log.error(err instanceof CkanNetworkError ? "http" : "cli", err.message);
      return 1;
    }
    log.error("cli", `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
