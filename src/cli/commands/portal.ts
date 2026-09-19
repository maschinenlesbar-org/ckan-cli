// Commands about the portal itself rather than its datasets.

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "../io.js";
import { action, renderJson, toEngineOptions, type GlobalOptions } from "../shared.js";
import { checkPortal, mapLimit, withCheck } from "../../client/portals.js";
import { PORTALS } from "../../client/portals-list.js";

/** How many portals `portals --check` checks at once. */
const CHECK_CONCURRENCY = 6;

/** commander accumulator for repeatable `key=value` pairs into a record. */
function collectKeyValue(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const eq = value.indexOf("=");
  // Throw commander's InvalidArgumentError (not a CkanError) so the failure is
  // formatted as a usage error with `error:` prefix and help, consistent with
  // other parse-time flag validation (e.g. `--rows abc`).
  if (eq <= 0) {
    throw new InvalidArgumentError(`Invalid --param "${value}". Expected key=value.`);
  }
  const key = value.slice(0, eq);
  // Reject a duplicated key rather than silently overwriting the earlier value.
  if (Object.prototype.hasOwnProperty.call(previous, key)) {
    throw new InvalidArgumentError(`Duplicate --param key "${key}".`);
  }
  return { ...previous, [key]: value.slice(eq + 1) };
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
      const today = new Date().toISOString().slice(0, 10);
      const engine = toEngineOptions(global);
      const checked = await mapLimit(PORTALS, CHECK_CONCURRENCY, async (portal) =>
        withCheck(portal, await checkPortal(deps.createClient({ ...engine, baseUrl: portal.url })), today),
      );
      renderJson(deps, global, checked);
    });
}
