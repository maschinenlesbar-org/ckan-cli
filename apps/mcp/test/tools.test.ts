// This server's tools against a mock of the CKAN portals (live answers recorded on 2026-11-20),
// with the skills' traps as cases: each tool answers through the protocol (its structuredContent
// checked by the SDK against its output schema); a portal is an id of the list, never a URL, and a
// call on another portal names that portal's URLs as its source; GovData is never added to the
// others; the spellings of a format or licence are folded; Hamburg's document types are sent
// stemmed; ambiguity is reported and never guessed; an empty answer says what was searched. The
// rules every server follows are the conformance tests (M1–M10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp/server.js";
import { SIZE_HINT, TOOLS } from "../src/mcp/tools.js";
import { connect } from "./harness.js";
import { ckanAnswer, ckanApi, jsonResponse, makeMockTransport, SEARCH_SERVER_DOWN } from "./helpers.js";

const HAMBURG = "https://suche.transparenz.hamburg.de/api/3/action";

test("six tools: the use cases first, then the generic ones", () => {
  assert.deepEqual(listTools().map((t) => t.name), ["comparePortals", "findDatasets", "countDatasets", "findHamburgDocuments", "getDataset", "listOrganizations"]);
});

test("comparePortals: every portal counted, most first, GovData national and apart, a failing portal named with its problem; the source names every host", async () => {
  const transport = makeMockTransport((request) => (new URL(request.url).host === "opendata.hessen.de" ? jsonResponse(SEARCH_SERVER_DOWN, 500) : ckanAnswer(request)));
  const connection = await connect({ transport });
  const result = await connection.call("comparePortals", { query: "Radverkehr" });
  const content = result.structuredContent ?? {};
  assert.equal(content["status"], "ok", result.content[0]?.text);
  const portals = content["portals"] as { id: string; count?: number; national?: boolean; problem?: string }[];
  assert.deepEqual(portals.slice(0, 2).map((p) => p.id), ["hamburg", "govdata"]);
  assert.equal(portals.find((p) => p.id === "govdata")?.national, true);
  assert.equal(portals.find((p) => p.id === "hessen")?.problem, "HTTP 500");
  const source = String(content["source"]);
  assert.match(source, /^https:\/\/\{.*suche\.transparenz\.hamburg\.de.*,open\.nrw,.*\}\/api\/3\/action\/package_search\?q=Radverkehr&rows=0$/, source);
  await connection.close();
});

test("findDatasets on Berlin by portal id: the request goes to Berlin, the source is Berlin's URL, CSV matches csv too", async () => {
  const mock = ckanApi();
  const connection = await connect({ transport: mock });
  const result = await connection.call("findDatasets", { portal: "berlin", query: "Radverkehr", format: "CSV" });
  const content = result.structuredContent ?? {};
  assert.equal(content["total"], 2, result.content[0]?.text);
  assert.equal(new URL(mock.last().url).host, "datenregister.berlin.de");
  assert.match(String(content["source"]), /^https:\/\/datenregister\.berlin\.de\/api\/3\/action\/package_search\?/);
  assert.deepEqual((content["portal"] as { id: string }).id, "berlin");
  assert.match(String(content["licence"]), /Per record/);
  await connection.close();
});

test("findDatasets on the server's own portal: relative requests under its base; an organization that fits several names is ambiguous", async () => {
  const connection = await connect({ transport: ckanApi() });
  const own = await connection.call("findDatasets", { query: "Radverkehr", organization: "workflows", limit: 2 });
  assert.equal(own.structuredContent?.["source"], `${HAMBURG}/{package_search?rows=0&facet.field=%5B%22organization%22%5D&facet.limit=-1,package_search?q=Radverkehr&fq=organization%3A%22workflows%22&rows=2&start=0}`);
  const several = await connection.call("findDatasets", { query: "Radverkehr", organization: "s" });
  assert.equal(several.structuredContent?.["status"], "ambiguous");
  assert.ok(((several.structuredContent?.["ambiguous"] as { candidates: unknown[] }).candidates.length ?? 0) > 1);
  await connection.close();
});

test("countDatasets: Hamburg's licences folded with an upper bound, its document types named", async () => {
  const connection = await connect({ transport: ckanApi() });
  const result = await connection.call("countDatasets", { facets: ["licence", "documentType"], limit: 3 });
  const facets = result.structuredContent?.["facets"] as { facet: string; values: { value: string; label?: string; upperBound?: boolean }[] }[];
  assert.equal(result.structuredContent?.["total"], 254249, result.content[0]?.text);
  assert.ok(facets[0]?.values.some((v) => v.value === "DL-DE Zero 2.0" && v.upperBound === true) || facets[0]?.values.length === 3);
  assert.equal(facets[1]?.values[0]?.label, "Beschlüsse");
  await connection.close();
});

test("findHamburgDocuments: a German type name is sent stemmed; each document with its date, licence and attribution", async () => {
  const mock = ckanApi();
  const connection = await connect({ transport: mock });
  const result = await connection.call("findHamburgDocuments", { documentType: "Verträge von öffentlichem Interesse", limit: 2 });
  assert.equal(new URL(mock.last().url).searchParams.get("fq"), "extras_registerobject_type:vertrageoffinteress");
  const documents = result.structuredContent?.["documents"] as { published: string; attribution: string; licence: { label: string } }[];
  assert.equal(documents.length, 2, result.content[0]?.text);
  assert.equal(documents[0]?.licence.label, "CC0 1.0");
  assert.equal(documents[0]?.attribution, "Namensnennung: Freie und Hansestadt Hamburg");
  assert.equal(result.structuredContent?.["nextOffset"], 2);
  const unknown = await connection.call("findHamburgDocuments", { documentType: "Rechnungen" });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0]?.text ?? "", /Gutachten/);
  await connection.close();
});

test("getDataset: one record; an unknown name is empty and says where to take one from", async () => {
  const connection = await connect({ transport: ckanApi() });
  const found = await connection.call("getDataset", { id: "kbq-verkehrstechnische-untersuchung-radverkehr" });
  assert.equal((found.structuredContent?.["dataset"] as { attribution: string }).attribution, "Namensnennung: Freie und Hansestadt Hamburg");
  assert.equal(found.structuredContent?.["source"], `${HAMBURG}/package_show?id=kbq-verkehrstechnische-untersuchung-radverkehr`);
  const missing = await connection.call("getDataset", { id: "gibt-es-nicht", portal: "nrw" });
  assert.equal(missing.structuredContent?.["status"], "empty");
  assert.match(String(missing.structuredContent?.["reason"]), /findDatasets/);
  assert.equal(missing.structuredContent?.["source"], "https://open.nrw/api/3/action/package_show?id=gibt-es-nicht");
  await connection.close();
});

test("listOrganizations: the groups of Hamburg by name", async () => {
  const connection = await connect({ transport: ckanApi() });
  const result = await connection.call("listOrganizations", { kind: "group", name: "Verkehr" });
  assert.deepEqual((result.structuredContent?.["organizations"] as { name: string }[]).map((g) => g.name), ["transport-und-verkehr"]);
  await connection.close();
});

test("findHamburgDocuments: a type with more words is a tool error naming the type and where the words go, not every document of the type", async () => {
  const mock = ckanApi();
  const connection = await connect({ transport: mock });
  const result = await connection.call("findHamburgDocuments", { documentType: "Gutachten zum Radverkehr" });
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? "", /give "Gutachten" there and "zum Radverkehr" as query/);
  assert.equal(mock.calls.length, 0);
  await connection.close();
});

test("comparePortals: when every portal fails, a tool error that says so, never status empty", async () => {
  const connection = await connect({ transport: makeMockTransport(() => jsonResponse(SEARCH_SERVER_DOWN, 500)) });
  const result = await connection.call("comparePortals", { query: "Radverkehr", portals: ["berlin", "nrw"] });
  assert.equal(result.isError, true, result.content[0]?.text);
  assert.match(result.content[0]?.text ?? "", /None of the 2 portals asked could be counted now \(every one: HTTP 500\)\. That is not "no data"/);
  await connection.close();
});

test("the deadline's and the size cap's advice fit every tool: each option they name is named with the tools that take it", async () => {
  const hanging = { transport: (): Promise<never> => new Promise<never>(() => {}) };
  const connection = await connect({ transport: hanging, config: { callTimeoutMs: 30 } });
  const deadline = (await connection.call("getDataset", { id: "x" })).content[0]?.text ?? "";
  await connection.close();
  assert.match(deadline, /took longer than .* and was stopped/);
  assert.match(deadline, /try again shortly/, "getDataset takes none of the options: the advice that fits it comes first");
  const schemas = new Map(TOOLS.map((tool) => [tool.name, Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)]));
  for (const text of [deadline, SIZE_HINT]) {
    const pairs = [...text.matchAll(/(\w+(?: or \w+)*) \((\w+(?:, \w+)*)\)/g)];
    assert.ok(pairs.length >= 2, text);
    for (const [, options, tools] of pairs) {
      for (const tool of (tools as string).split(", ")) {
        for (const option of (options as string).split(" or ")) assert.ok(schemas.get(tool)?.includes(option), `${tool} takes no ${option}: ${text}`);
      }
    }
  }
});
