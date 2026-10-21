// Commands about the portal itself rather than its datasets.

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "../io.js";
import { action, toEngineOptions, type GlobalOptions } from "../shared.js";
import { renderJson } from "../output.js";
import { checkPortals } from "@maschinenlesbar.org/ckan-client/internal/portals";
import { PORTALS } from "@maschinenlesbar.org/ckan-client/internal/portals-list";
import { normalizeToken, textProblem, tokenProblem } from "@maschinenlesbar.org/ckan-client/internal/validate";
import { quoteValue, redactUrl } from "@maschinenlesbar.org/ckan-client/internal/errors";

/**
 * A typed value as a message quotes it: visibly (`quoteValue`: invisible and control characters
 * escaped, cut at MAX_MESSAGE_VALUE_LENGTH), after its credentials are redacted (a cut could
 * otherwise leave part of a password without the "@" the argv redaction keys on).
 */
function shown(value: string): string {
  return quoteValue(redactUrl(value));
}

/**
 * commander accumulator for repeatable `key=value` pairs into a record. The library's rules,
 * as a usage error: the name is a token (`tokenProblem`; sent trimmed, so ` q` and `q` are the
 * same name, and giving it twice is refused), the value is text (`textProblem`: not blank, no
 * control or invisible character).
 */
function collectKeyValue(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const eq = value.indexOf("=");
  // Throw commander's InvalidArgumentError (not a CkanError) so the failure is
  // formatted as a usage error with `error:` prefix and help, consistent with
  // other parse-time flag validation (e.g. `--rows abc`).
  if (eq < 0) throw new InvalidArgumentError(`Invalid --param ${shown(value)}. Expected key=value.`);
  const key = value.slice(0, eq);
  // A blank key (`=x`, ` =x`) names no parameter: the library refuses it too.
  const keyProblem = tokenProblem(key);
  if (keyProblem !== undefined) throw new InvalidArgumentError(`Invalid --param ${shown(value)}: the name: ${keyProblem}`);
  // Reject a duplicated key (as it is sent, trimmed) rather than silently overwriting the earlier value.
  const name = normalizeToken(key);
  if (Object.keys(previous).some((k) => normalizeToken(k) === name)) {
    throw new InvalidArgumentError(`Duplicate --param key ${shown(name)}.`);
  }
  // A blank value is refused by the library as well (CKAN reads an empty
  // parameter as unset, so `--param q=` would run the action unfiltered).
  const paramValue = value.slice(eq + 1);
  const valueProblem = textProblem(paramValue);
  if (valueProblem !== undefined) throw new InvalidArgumentError(`Invalid --param ${shown(value)}: the value: ${valueProblem}`);
  // A computed key in a literal is an own data property, even for `__proto__`.
  return { ...previous, [key]: paramValue };
}

export function registerPortalCommands(program: Command, deps: CliDeps): void {
  program
    .command("status")
    .description("Show the portal's site title, CKAN version and extensions")
    .action(
      action(deps, async ({ client, global }) => {
        renderJson(deps, global, await client.status());
      }),
    );

  program
    .command("licenses")
    .description("List the licences the portal offers")
    .action(
      action(deps, async ({ client, global }) => {
        renderJson(deps, global, await client.licenseList());
      }),
    );

  program
    .command("action <name>")
    .description("Call any CKAN action by name (generic escape hatch)")
    .option("--param <key=value>", "query parameter (repeatable)", collectKeyValue)
    .action(
      action(deps, async ({ client, global, opts }, [name]) => {
        const params = (opts["param"] as Record<string, string> | undefined) ?? {};
        renderJson(deps, global, await client.action(name!, params));
      }),
    );

  program
    .command("portals")
    .description("List the known CKAN portals in Germany (use one with --portal <id>)")
    .option("--check", "check every portal live now and report the result")
    .action(async (opts: { check?: boolean }, command: Command) => {
      const global = command.optsWithGlobals() as GlobalOptions;
      if (!opts.check) {
        renderJson(deps, global, PORTALS);
        return;
      }
      const checked = await checkPortals(PORTALS, {
        engineOptions: toEngineOptions(global),
        createClient: deps.createClient,
      });
      renderJson(deps, global, checked);
    });
}
