// Commands over the catalogue: datasets, their resources, publishers, themes
// and tags.

import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import {
  action,
  collectNonEmpty,
  parseBoundedInt,
  parseIntArg,
  parseNonEmpty,
  parseOptionValue,
  renderJson,
} from "../shared.js";

/**
 * commander value-parser for a list --limit: 1 or more. CKAN reads `limit=0` as
 * "no limit" and would send the whole list; leave --limit out for that.
 */
const parseLimit = parseBoundedInt(1, Number.MAX_SAFE_INTEGER);

/** commander value-parser for --facet-limit: a count, or -1 for every value. */
function parseFacetLimit(value: string): number {
  return value === "-1" ? -1 : parseIntArg(value);
}

export function registerCatalogueCommands(program: Command, deps: CliDeps): void {
  program
    .command("search")
    .description("Search datasets (Solr query syntax)")
    .argument("[query]", "full-text query, e.g. elbe or title:haushalt", parseNonEmpty)
    .option("--rows <n>", "max results (servers cap this, usually at 1000)", parseIntArg)
    .option("--start <n>", "offset for paging", parseIntArg)
    .option("--sort <expr>", 'e.g. "metadata_modified desc"', parseOptionValue)
    .option("--fq <filter>", "filter query, e.g. organization:allris (repeatable; all must match)", collectNonEmpty)
    .option("--facet <field>", "count values of a field, e.g. res_format (repeatable)", collectNonEmpty)
    .option("--facet-limit <n>", "max values per facet (default 50; -1 = all)", parseFacetLimit)
    .action(
      action(deps, async ({ client, global, opts }, [query]) => {
        renderJson(
          deps,
          global,
          await client.packageSearch({
            q: query,
            rows: opts["rows"] as number | undefined,
            start: opts["start"] as number | undefined,
            sort: opts["sort"] as string | undefined,
            fq: opts["fq"] as string[] | undefined,
            facet_field: opts["facet"] as string[] | undefined,
            facet_limit: opts["facetLimit"] as number | undefined,
          }),
        );
      }),
    );

  program
    .command("package")
    .description("Show one dataset by id or name")
    .argument("<id>", "id or name", parseNonEmpty)
    .action(
      action(deps, async ({ client, global }, [id]) => {
        renderJson(deps, global, await client.packageShow(id!));
      }),
    );

  program
    .command("resource")
    .description("Show one resource (distribution) by id")
    .argument("<id>", "resource id", parseNonEmpty)
    .action(
      action(deps, async ({ client, global }, [id]) => {
        renderJson(deps, global, await client.resourceShow(id!));
      }),
    );

  program
    .command("organization")
    .description("Show one organization (publisher) by id or name")
    .argument("<id>", "id or name", parseNonEmpty)
    .action(
      action(deps, async ({ client, global }, [id]) => {
        renderJson(deps, global, await client.organizationShow(id!));
      }),
    );

  program
    .command("group")
    .description("Show one group (theme/category) by id or name")
    .argument("<id>", "id or name", parseNonEmpty)
    .action(
      action(deps, async ({ client, global }, [id]) => {
        renderJson(deps, global, await client.groupShow(id!));
      }),
    );

  program
    .command("packages")
    .description("List dataset names")
    .option("--limit <n>", "max names (1 or more; omit for all)", parseLimit)
    .option("--offset <n>", "offset for paging", parseIntArg)
    .action(
      action(deps, async ({ client, global, opts }) => {
        renderJson(
          deps,
          global,
          await client.packageList({
            limit: opts["limit"] as number | undefined,
            offset: opts["offset"] as number | undefined,
          }),
        );
      }),
    );

  program
    .command("organizations")
    .description("List organizations (data publishers)")
    .option("--all-fields", "return full objects instead of names")
    .option("--limit <n>", "max entries (1 or more; omit for all)", parseLimit)
    .option("--offset <n>", "offset for paging", parseIntArg)
    .action(
      action(deps, async ({ client, global, opts }) => {
        renderJson(
          deps,
          global,
          await client.organizationList({
            all_fields: opts["allFields"] as boolean | undefined,
            limit: opts["limit"] as number | undefined,
            offset: opts["offset"] as number | undefined,
          }),
        );
      }),
    );

  program
    .command("groups")
    .description("List groups (themes/categories)")
    .option("--all-fields", "return full objects instead of names")
    .option("--limit <n>", "max entries (1 or more; omit for all)", parseLimit)
    .option("--offset <n>", "offset for paging", parseIntArg)
    .action(
      action(deps, async ({ client, global, opts }) => {
        renderJson(
          deps,
          global,
          await client.groupList({
            all_fields: opts["allFields"] as boolean | undefined,
            limit: opts["limit"] as number | undefined,
            offset: opts["offset"] as number | undefined,
          }),
        );
      }),
    );

  program
    .command("tags")
    .description("List tags")
    .option("--query <substring>", "only tags containing this substring", parseOptionValue)
    .action(
      action(deps, async ({ client, global, opts }) => {
        renderJson(deps, global, await client.tagList({ query: opts["query"] as string | undefined }));
      }),
    );
}
