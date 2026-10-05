// Conformance test P8 + P9 + P13 (fix plan 2026-10-06): a body is decoded by its declared
// charset (P8); a 2xx body without the documented shape is a parse error, never data or
// "nothing found" (P9); every rejected input is the library's validation error, never a raw
// TypeError or RangeError (P13). Shared across the *-cli repos; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HttpResponse } from "../src/client/http.js";

// ---- adapter (per repo) -------------------------------------------------------------
import { CkanClient as Client } from "../src/client/client.js";
import {
  CkanError as BaseError,
  CkanParseError as ParseError,
  CkanValidationError as ValidationError,
} from "../src/client/errors.js";
import { checkPortalUrls, findPortal } from "../src/client/portals.js";
import { PORTALS } from "../src/client/portals-list.js";
/** A call whose answer contains a text field, and how to read that field from the result. */
const textCall = (client: Client): Promise<unknown> => client.status();
const textBody = (text: string): unknown => ({ help: "h", success: true, result: { site_title: text } });
const readText = (result: unknown): string => (result as { site_title: string }).site_title;
/**
 * 2xx bodies the call must reject (not a CKAN envelope, or a result of the wrong shape).
 * CKAN's own error envelope (`success: false`) is an API failure, a CkanError with CKAN's
 * message (exit 1), tested in client.test.ts; it is not a parse error, so it is not listed.
 */
const malformedBodies: unknown[] = [
  null, {}, [], "text", 42, { error: "boom" }, { success: "yes", result: {} }, { help: "h" },
  { success: true }, { success: true, result: null }, { success: true, result: [] }, { success: true, result: "x" },
];
const c = (): Client => new Client({ transport: async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }) });
/** Library calls with wrong-typed or out-of-range input. */
const badCalls: Array<[string, () => unknown]> = [
  ["packageShow(5)", () => c().packageShow(5 as unknown as string)],
  ["packageShow('')", () => c().packageShow("")],
  ["resourceShow(null)", () => c().resourceShow(null as unknown as string)],
  ["packageSearch(null)", () => c().packageSearch(null as never)],
  ["packageSearch({ q: 5 })", () => c().packageSearch({ q: 5 as unknown as string })],
  ["packageSearch({ fq: 'x' })", () => c().packageSearch({ fq: "x" as unknown as string[] })],
  ["packageSearch({ fq: [5] })", () => c().packageSearch({ fq: [5] as unknown as string[] })],
  ["packageSearch({ facet_field: 'x' })", () => c().packageSearch({ facet_field: "x" as unknown as string[] })],
  ["packageSearch({ rows: '5' })", () => c().packageSearch({ rows: "5" as unknown as number })],
  ["packageSearch({ rows: -1 })", () => c().packageSearch({ rows: -1 })],
  ["packageSearch({ facet_limit: -2 })", () => c().packageSearch({ facet_limit: -2 })],
  ["organizationList({ limit: 0 })", () => c().organizationList({ limit: 0 })],
  ["organizationList({ all_fields: 'false' })", () => c().organizationList({ all_fields: "false" as unknown as boolean })],
  ["groupList({ offset: 1.5 })", () => c().groupList({ offset: 1.5 })],
  ["tagList({ query: 5 })", () => c().tagList({ query: 5 as unknown as string })],
  ["action(5)", () => c().action(5 as unknown as string)],
  ["action('../x')", () => c().action("../x")],
  ["action('x', { k: {} })", () => c().action("x", { k: {} as never })],
  ["action('x', { k: NaN })", () => c().action("x", { k: Number.NaN })],
  ["timeoutMs: 'x'", () => new Client({ timeoutMs: "x" as unknown as number })],
  ["timeoutMs: -1", () => new Client({ timeoutMs: -1 })],
  ["maxRetries: 1.5", () => new Client({ maxRetries: 1.5 })],
  ["maxRedirects: 11", () => new Client({ maxRedirects: 11 })],
  ["retryDelayMs: 1e9", () => new Client({ retryDelayMs: 1e9 })],
  ["baseUrl: 5", () => new Client({ baseUrl: 5 as unknown as string })],
  ["baseUrl: {}", () => new Client({ baseUrl: {} as unknown as string })],
  ["userAgent: {}", () => new Client({ userAgent: {} as unknown as string })],
  ["transport: 'x'", () => new Client({ transport: "x" as never })],
  ["sleep: 1", () => new Client({ sleep: 1 as never })],
  ["findPortal(5)", () => findPortal(5 as unknown as string, PORTALS)],
  ["checkPortalUrls('x')", () => checkPortalUrls("x" as unknown as string[])],
  ["checkPortalUrls([], { concurrency: 0 })", () => checkPortalUrls([], { concurrency: 0 })],
];
// --------------------------------------------------------------------------------------

const respond = (body: Buffer, contentType: string) => async (): Promise<HttpResponse> => ({
  status: 200,
  headers: { "content-type": contentType },
  body,
});

test("P8: a body is decoded by its declared charset", async () => {
  const text = "Müller µg/l";
  for (const [charset, encoding] of [["iso-8859-1", "latin1"], ["utf-8", "utf8"]] as const) {
    const body = Buffer.from(JSON.stringify(textBody(text)), encoding);
    const client = new Client({ transport: respond(body, `application/json; charset=${charset}`) });
    assert.equal(readText(await textCall(client)), text, charset);
  }
});

test("P9: a 2xx body without the documented shape is a parse error", async () => {
  for (const body of malformedBodies) {
    const client = new Client({ transport: respond(Buffer.from(JSON.stringify(body)), "application/json"), maxRetries: 0 });
    await assert.rejects(textCall(client), ParseError, `body ${JSON.stringify(body)}`);
  }
  for (const raw of ["", "<html>maintenance</html>"]) {
    const client = new Client({ transport: respond(Buffer.from(raw), "text/html"), maxRetries: 0 });
    await assert.rejects(textCall(client), BaseError, `raw ${JSON.stringify(raw)}`);
  }
});

test("P13: every rejected input is the validation error, never a raw TypeError", async () => {
  for (const [label, fn] of badCalls) {
    await assert.rejects(async () => fn(), (e: unknown) => e instanceof ValidationError, label);
  }
});
