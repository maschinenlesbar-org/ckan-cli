// CLI <-> library parity: the same input through run() and through CkanClient, on
// one recording mock transport, must give the same outcome (2026-10-03 parity
// report). Each test names the finding it covers.

import { test } from "node:test";
import { CkanClient } from "../src/client/client.js";
import { assertBothReject, assertSameRequests, jsonResponse, parity } from "./helpers.js";

const SEARCH = () => jsonResponse({ help: "h", success: true, result: { count: 0, results: [] } });
const LIST = () => jsonResponse({ help: "h", success: true, result: ["alpha"] });

// Finding 1 (PAT-9): a blank search, filter, sort, facet, tag query or action
// parameter is refused on both sides, never sent or dropped.
test("parity: blank search, filter, sort, facet, tag-query and param values are refused", async () => {
  const cases: [string[], (c: CkanClient) => Promise<unknown>][] = [
    [["search", ""], (c) => c.packageSearch({ q: "" })],
    [["search", " "], (c) => c.packageSearch({ q: " " })],
    [["search", "--fq", ""], (c) => c.packageSearch({ fq: [""] })],
    [["search", "--fq", " "], (c) => c.packageSearch({ fq: [" "] })],
    [["search", "--fq", "organization:a", "--fq", ""], (c) => c.packageSearch({ fq: ["organization:a", ""] })],
    [["search", "--sort", ""], (c) => c.packageSearch({ sort: "" })],
    [["search", "--sort", " "], (c) => c.packageSearch({ sort: " " })],
    [["search", "--facet", ""], (c) => c.packageSearch({ facet_field: [""] })],
    [["tags", "--query", ""], (c) => c.tagList({ query: "" })],
    [["tags", "--query", " "], (c) => c.tagList({ query: " " })],
    [["action", "package_search", "--param", "q="], (c) => c.action("package_search", { q: "" })],
    [["action", "package_search", "--param", "q= "], (c) => c.action("package_search", { q: " " })],
    [["action", "package_search", "--param", "=x"], (c) => c.action("package_search", { "": "x" })],
    [["action", "package_search", "--param", " =x"], (c) => c.action("package_search", { " ": "x" })],
  ];
  for (const [argv, call] of cases) {
    const result = await parity(argv, (transport) => call(new CkanClient({ transport })), { responder: SEARCH });
    assertBothReject(result);
  }
});

test("parity: non-blank search and tag values go out the same on both sides", async () => {
  assertSameRequests(
    await parity(
      ["search", "elbe", "--fq", "organization:a", "--fq", "res_format:CSV", "--sort", "name asc", "--facet", "tags"],
      (transport) =>
        new CkanClient({ transport }).packageSearch({
          q: "elbe",
          fq: ["organization:a", "res_format:CSV"],
          sort: "name asc",
          facet_field: ["tags"],
        }),
      { responder: SEARCH },
    ),
  );
  assertSameRequests(
    await parity(["tags", "--query", "wasser"], (transport) => new CkanClient({ transport }).tagList({ query: "wasser" }), {
      responder: LIST,
    }),
  );
});
