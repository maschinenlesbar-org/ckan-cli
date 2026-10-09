// The engine's onRetry hook: called once per retry, right before the backoff sleep.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine } from "../src/client/engine.js";
import { CkanApiError, CkanValidationError } from "../src/client/errors.js";
import { jsonResponse, makeMockTransport } from "./helpers.js";

test("onRetry is called once per retry, with the event fields, right before the sleep", async () => {
  const log: string[] = [];
  const events: unknown[] = [];
  let n = 0;
  const mt = makeMockTransport(() =>
    n++ < 2
      ? { status: 503, headers: n === 1 ? { "retry-after": "2" } : {}, body: Buffer.from("{}") }
      : jsonResponse({ ok: 1 }),
  );
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://user:pw@example.test",
    maxRetries: 3,
    retryDelayMs: 200,
    sleep: async (ms) => void log.push(`sleep ${ms}`),
    onRetry: (ev) => {
      events.push(ev);
      log.push("retry");
    },
  });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.deepEqual(log, ["retry", "sleep 2000", "retry", "sleep 400"]);
  assert.equal(events.length, 2);
  for (const [i, ev] of (events as { url: string }[]).entries()) {
    const { url, ...rest } = ev;
    assert.deepEqual(rest, { retry: i + 1, maxRetries: 3, delayMs: i === 0 ? 2000 : 400, status: 503 });
    assert.match(url, /^https:\/\/(\*\*\*@)?example\.test\//);
    assert.ok(!url.includes("pw") && !url.includes("user"), url);
  }
});

test("onRetry is never called without a retry", async () => {
  const events: unknown[] = [];
  const onRetry = (ev: unknown) => void events.push(ev);
  const ok = new RequestEngine({ transport: makeMockTransport(() => jsonResponse({ ok: 1 })).transport, sleep: async () => {}, onRetry });
  await ok.getJson("/x");
  const notFound = new RequestEngine({
    transport: makeMockTransport(() => jsonResponse({ detail: "no" }, 404)).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(() => notFound.getJson("/x"), CkanApiError);
  // retries exhausted: the last 503 is an error, not a retry
  const down = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: {}, body: Buffer.from("{}") })).transport,
    maxRetries: 1,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(() => down.getJson("/x"), CkanApiError);
  assert.equal(events.length, 1);
  // a Retry-After over the cap is not retried
  const long = new RequestEngine({
    transport: makeMockTransport(() => ({ status: 503, headers: { "retry-after": "999999" }, body: Buffer.from("{}") })).transport,
    sleep: async () => {},
    onRetry,
  });
  await assert.rejects(() => long.getJson("/x"), CkanApiError);
  assert.equal(events.length, 1);
});

test("a throw inside onRetry is swallowed", async () => {
  let n = 0;
  const e = new RequestEngine({
    transport: makeMockTransport(() => (n++ === 0 ? { status: 503, headers: {}, body: Buffer.from("{}") } : jsonResponse({ ok: 1 }))).transport,
    sleep: async () => {},
    onRetry: () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
});

test("onRetry must be a function", () => {
  assert.throws(() => new RequestEngine({ onRetry: 5 as never }), CkanValidationError);
});
