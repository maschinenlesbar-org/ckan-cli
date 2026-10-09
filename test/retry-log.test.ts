// The CLI logs each retry as one WARN record of `ckan.http`; stdout is the same as
// without the retry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { CkanClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpResponse } from "../src/client/http.js";
import { untimed } from "./helpers.js";

async function exercise(extra: string[], failures: number, retryAfter?: string, retryDelayMs?: number) {
  const out: string[] = [];
  const err: string[] = [];
  let n = 0;
  const transport = async (): Promise<HttpResponse> =>
    n++ < failures
      ? { status: 503, headers: retryAfter ? { "retry-after": retryAfter } : {}, body: Buffer.from("{}") }
      : { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ help: "h", success: true, result: { ckan_version: "2.10.11" } })) };
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s), },
    env: {},
    now: () => new Date("2026-01-02T03:04:05.678Z"),
    createClient: (opts) =>
      new CkanClient({ ...opts, transport, sleep: async () => {}, ...(retryDelayMs === undefined ? {} : { retryDelayMs }) }),
  };
  const code = await run([...extra, ...["status"]], deps);
  return { code, out: out.join("\n"), err };
}

test("a 503 then 200 exits 0, same stdout, and logs one WARN of ckan.http", async () => {
  const plain = await exercise([], 0);
  const retried = await exercise(["--base-url", "https://mirror.test"], 1, "2");
  assert.equal(retried.code, 0);
  assert.equal(retried.out, plain.out);
  assert.equal(plain.err.length, 0);
  assert.deepEqual(untimed(retried.err.join("\n")).split("\n"), [
    "WARN  [ckan.http] HTTP 503 from mirror.test: retry 1 of 2 in 2 s",
  ]);
});

test("the same record in jsonl, with the delay in ms under one second", async () => {
  const r = await exercise(["--log-format", "jsonl"], 1, undefined, 200);
  assert.equal(r.code, 0);
  assert.equal(r.err.length, 1);
  const rec = JSON.parse(r.err[0] as string) as Record<string, unknown>;
  assert.equal(rec["level"], "WARN");
  assert.equal(rec["topic"], "ckan.http");
  assert.equal(rec["msg"], "HTTP 503 from suche.transparenz.hamburg.de: retry 1 of 2 in 200 ms");
});
