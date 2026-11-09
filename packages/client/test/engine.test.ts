import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { TextDecoder, inspect } from "node:util";
import { MAX_RETRY_AFTER_MS, RequestEngine, parseRetryAfter, sanitizeServerText } from "../src/engine.js";
import {
  CkanApiError,
  CkanNetworkError,
  CkanParseError,
  cutText,
  toWellFormed,
} from "../src/errors.js";
import { CkanClient } from "../src/client.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import type { HttpResponse } from "../src/http.js";

// Control characters built via char codes so no raw control byte ever appears in
// this source file.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = String.fromCharCode(0x9b); // a C1 control

/** True if the string contains any C0/C1 control char except tab/newline. */
function hasControlChars(s: string): boolean {
  return [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f);
  });
}

test("the constructor rejects a malformed base URL as a validation error, not a network error (GOV-01)", async () => {
  const { CkanValidationError } = await import("../src/errors.js");
  const { validateBaseUrl } = await import("../src/engine.js");
  for (const baseUrl of ["file:///etc/passwd", "not-a-url", "", "https://h.example?x=1", "https://h.example#f"]) {
    for (const build of [() => new RequestEngine({ baseUrl }), () => validateBaseUrl(baseUrl)]) {
      assert.throws(
        build,
        (err: unknown) =>
          err instanceof CkanValidationError && !(err instanceof CkanNetworkError) && /^Invalid base URL: /.test(err.message),
        JSON.stringify(baseUrl),
      );
    }
  }
  assert.equal(validateBaseUrl("https://h.example/ckan//"), "https://h.example/ckan");
});

test("buildUrl normalises the path and appends the query", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/" });
  assert.equal(e.buildUrl("api/"), "https://example.test/api/");
  assert.equal(
    e.buildUrl("/x", { a: "1", b: ["2", "3"] }),
    "https://example.test/x?a=1&b=2&b=3",
  );
});

test("getJson parses a JSON body", async () => {
  const mt = makeMockTransport(() => jsonResponse({ ok: true }));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: true });
});

test("getJson throws CkanParseError on invalid JSON", async () => {
  const mt = makeMockTransport(() => rawResponse("not json", "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => e.getJson("/x"), CkanParseError);
});

test("a number the JSON cannot carry exactly is a parse error, never a changed value", async () => {
  // JSON.parse rounds 12345678901234567890 (in any form: .0, e0, E-1) and 9007199254740992.5 to the
  // nearest double, turns 1e400 into Infinity (printed as null) and 1e-400 into 0, silently.
  const body = (n: string) => `{"id":"a","n":${n},"text":"12345678901234567890 in a string"}`;
  for (const n of [
    "12345678901234567890", "-9007199254740993", "1e400", "-1E400", "12345678901234567890.0", "9007199254740993e0",
    "90071992547409930E-1", "9007199254740992.5", "-9007199254740992.5", "1e-400", "-0.0001e-399",
    "123456789012345678901234567890",
    // Below the smallest normal double a subnormal has fewer digits: 3e-324 became 5e-324.
    "3e-324", "4e-324", "-4.9e-324", "1.2345678901234567e-310", "2.225073858507201e-309", "1.234e-322",
  ]) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    await assert.rejects(e.getJson("/items/a"), (err: unknown) => {
      assert.ok(err instanceof CkanParseError, n);
      assert.equal(err.message, `GET https://suche.transparenz.hamburg.de/items/a: the number ${n} cannot be represented exactly.`);
      return true;
    });
  }
  // What a double carries exactly, or as JSON means it (a decimal fraction below 2^53), passes.
  const exact: Array<[string, number]> = [
    ["9007199254740991", 9007199254740991], ["9007199254740992.0", 2 ** 53], ["9007199254740992e0", 2 ** 53],
    ["90071992547409920E-1", 2 ** 53], ["1e21", 1e21], ["1.2e21", 1.2e21], ["0", 0], ["-0", -0], ["0.0e-500", 0],
    ["1.10", 1.1], ["0.1", 0.1], ["1.00000000000000001", 1], ["5e-324", 5e-324],
    // A subnormal or the smallest normal double that prints as written.
    ["-5e-324", -5e-324], ["1e-310", 1e-310], ["2.2250738585072014e-308", 2.2250738585072014e-308], ["2.5e-323", 2.5e-323],
    // A double a server printed in its shortest form reads back as that double and prints as the
    // same number: not a changed value, though the decimal is not the double's exact binary value.
    ["1e23", 1e23], ["100000000000000000000000", 1e23], ["1E23", 1e23], ["1.7976931348623157E308", Number.MAX_VALUE], ["-1.7976931348623157e308", -Number.MAX_VALUE],
    ["4.35e30", 4.35e30],
  ];
  for (const [n, value] of exact) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    assert.equal((await e.getJson<{ n: number }>("/x")).n, value, n);
  }
});

test("the number check skips strings and costs one pass over the text", async () => {
  // Escaped quotes and backslashes must not end a string early and expose its digits.
  const tricky = `{"id":"a","s":"\\\\\\"12345678901234567890\\\\","t":"1e400","n":[1,2.5,-3e2]}`;
  const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(tricky, "application/json")).transport });
  assert.deepEqual(await e.getJson("/x"), JSON.parse(tricky));
  // 1 MB of numbers: the scan is linear.
  const big = `[${Array.from({ length: 200_000 }, (_, i) => i * 7).join(",")}]`;
  const f = new RequestEngine({ transport: makeMockTransport(() => rawResponse(big, "application/json")).transport });
  assert.equal((await f.getJson<number[]>("/x")).length, 200_000);
});

test("a number with a long run of zeros is refused in linear time (A)", async () => {
  // The trailing-zero regex `/0+$/` tried a match at every zero of a run that doesn't end the
  // literal: 1.<100 000 zeros>1e300 took about 15 s, past --timeout (the scan runs once the answer is in).
  const literal = `1.${"0".repeat(100_000)}1e300`;
  const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"n":${literal}}`, "application/json")).transport });
  const start = performance.now();
  await assert.rejects(e.getJson("/x"), (err: unknown) => err instanceof CkanParseError && /cannot be represented exactly/.test(err.message));
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
  // The count of zeros still sets the exponent: trailing zeros in the fraction are no digits.
  const g = new RequestEngine({ transport: makeMockTransport(() => rawResponse(`{"n":9007199254740992.${"0".repeat(50_000)}}`, "application/json")).transport });
  assert.equal((await g.getJson<{ n: number }>("/x")).n, 2 ** 53);
});

test("a 503 is retried up to maxRetries then surfaces as CkanApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "busy" }, 503);
  });
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 2,
    sleep: async () => {},
  });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof CkanApiError && err.status === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("a retried request that then succeeds resolves", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {} });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(calls, 2);
});

test("the User-Agent and Accept headers are sent", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const e = new RequestEngine({ transport: mt.transport, userAgent: "ua/1" });
  await e.getJson("/x");
  assert.equal(mt.last().headers?.["User-Agent"], "ua/1");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("a same-origin redirect is followed with headers preserved", async () => {
  let calls = 0;
  const mt = makeMockTransport((req) => {
    calls += 1;
    if (calls === 1) {
      return { status: 302, headers: { location: "/moved" }, body: Buffer.from("") };
    }
    // Second request must still carry the User-Agent (same origin).
    assert.equal(req.headers?.["User-Agent"], "ua/1");
    assert.ok(new URL(req.url).pathname === "/moved");
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://example.test",
    userAgent: "ua/1",
  });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(calls, 2);
});

test("error detail is stripped of terminal control characters (GOV-02)", async () => {
  // A CKAN-shaped error body whose message interleaves ESC/CSI/BEL escapes with
  // printable text. JSON.parse turns the escaped bytes into real control bytes.
  const evil = `boom${ESC}[31mred${BEL}${CSI}2J`;
  const body: HttpResponse = {
    status: 500,
    headers: { "content-type": "application/json" },
    body: Buffer.from(
      JSON.stringify({ error: { __type: "Internal Server Error", message: evil } }),
    ),
  };
  const mt = makeMockTransport(() => body);
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://a.example",
    maxRetries: 0,
  });

  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof CkanApiError);
      // Control bytes are gone from both the structured detail and the
      // human-readable message that run.ts prints to stderr...
      assert.ok(!hasControlChars(err.detail ?? ""));
      assert.ok(!hasControlChars(err.message));
      // ...while the printable characters (and the __type prefix) survive.
      // Whole escape sequences go, not only their control bytes: no `[31m` or `2J` is left.
      assert.equal(err.detail, "Internal Server Error: boomred");
      return true;
    },
  );
});

test("error detail loses newlines and bidi overrides, so it cannot forge stderr lines", async () => {
  const RLO = String.fromCharCode(0x202e);
  const mt = makeMockTransport(() =>
    jsonResponse(
      { success: false, error: { __type: "Not Found Error", message: `Not found\nOK: 0 problems, dataset verified ${RLO}` } },
      404,
    ),
  );
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof CkanApiError);
      assert.equal(err.detail, "Not Found Error: Not found OK: 0 problems, dataset verified");
      assert.ok(!err.message.includes("\n"));
      return true;
    },
  );
});

test("a cross-origin redirect keeps only Accept and User-Agent (credential-strip guard)", async () => {
  let calls = 0;
  const mt = makeMockTransport((req) => {
    calls += 1;
    if (calls === 1) {
      return {
        status: 302,
        headers: { location: "https://evil.test/x" },
        body: Buffer.from(""),
      };
    }
    // Crossing origin: only the engine's own Accept and User-Agent go along.
    assert.deepEqual(req.headers, { Accept: "application/json", "User-Agent": "ua/1" });
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({
    transport: mt.transport,
    baseUrl: "https://example.test",
    userAgent: "ua/1",
  });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(calls, 2);
});

test("a CKAN validation error (HTTP 409 field map) is spelled out in the detail", async () => {
  // Hamburg: package_search?rows=abc
  const mt = makeMockTransport(() =>
    jsonResponse(
      {
        help: "h",
        error: { rows: ["Invalid integer", "Please enter an integer value"], __type: "Validation Error" },
        success: false,
      },
      409,
    ),
  );
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) =>
      err instanceof CkanApiError &&
      err.status === 409 &&
      err.detail === "Validation Error: rows: Invalid integer, Please enter an integer value",
  );
});

test("a bare JSON string error body (CKAN's unknown-action 400) becomes the detail", async () => {
  const mt = makeMockTransport(() =>
    jsonResponse("Bad request - Action name not known: nope", 400),
  );
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/api/3/action/nope"),
    (err: unknown) =>
      err instanceof CkanApiError && err.detail === "Bad request - Action name not known: nope",
  );
});

test("a non-JSON 2xx body names the full URL and the content type it got", async () => {
  // register.opendata.sachsen.de serves an HTML page with HTTP 200 on /api/3/action/*.
  const mt = makeMockTransport(() => rawResponse("<!DOCTYPE html><html>", "text/html"));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://register.example.test" });
  await assert.rejects(
    () => e.getJson("/api/3/action/package_search", { rows: 0 }),
    (err: unknown) =>
      err instanceof CkanParseError &&
      err.message ===
        'GET https://register.example.test/api/3/action/package_search?rows=0: the answer is not valid JSON (expected JSON, got Content-Type "text/html").',
  );
});

test("control characters in the Content-Type are stripped from the error message", async () => {
  const mt = makeMockTransport(() => rawResponse("<html></html>", `text/${CSI}31m${ESC}[2Jhtml; charset=utf-8`));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof CkanParseError);
      assert.equal(err.message, 'GET https://a.example/x: the answer is not valid JSON (expected JSON, got Content-Type "text/html").');
      return true;
    },
  );
});

test("broken JSON labelled as JSON is reported as invalid JSON, not as the wrong type", async () => {
  const mt = makeMockTransport(() => rawResponse('{"help": "h", "succ', "application/json;charset=utf-8"));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => err instanceof CkanParseError && err.message === "GET https://a.example/x: the answer is not valid JSON.",
  );
});

test("a Solr syntax error is cut down to Solr's own reason", async () => {
  // The message Hamburg sends for q=title:( (shortened): the whole Solr query as a
  // Python repr, with the reason nested three escaping levels deep.
  const message = JSON.parse(
    String.raw`"Search error: 'SOLR returned an error running query: {\\'q\\': \\'title:(\\', \\'rows\\': 0, \\'df\\': \\'text\\'} Error: SolrError(\\'Solr responded with an error (HTTP 400): [Reason: org.apache.solr.search.SyntaxError: Cannot parse \\\\\\'title:(\\\\\\': Encountered \"<EOF>\" at line 1, column 7.\\\\nWas expecting one of:\\\\n    <NOT> ...\\\\n    ]\\')'"`,
  ) as string;
  const mt = makeMockTransport(() =>
    jsonResponse({ help: "h", error: { __type: "Search Error", message }, success: false }, 409),
  );
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) =>
      err instanceof CkanApiError &&
      err.detail === `Search Error: Cannot parse 'title:(': Encountered "<EOF>" at line 1, column 7.`,
  );
});

test("a redirect loop ends with an error that says the redirect limit was reached", async () => {
  // opendata.bonn.de and open-data.bielefeld.de answer every API URL with a 301 to itself.
  const mt = makeMockTransport((req) => ({
    status: 301,
    headers: { location: new URL(req.url).pathname },
    body: Buffer.from(""),
  }));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://loop.example.test", maxRedirects: 3 });
  await assert.rejects(
    () => e.getJson("/api/3/action/package_search"),
    (err: unknown) =>
      err instanceof CkanApiError &&
      err.status === 301 &&
      err.detail === "stopped after 3 redirects (a redirect loop?)",
  );
  assert.equal(mt.calls.length, 4);
});

// ---- Retry-After ----

function retryingEngine(retryAfter: string | undefined, maxRetries = 2) {
  const delays: number[] = [];
  const mt = makeMockTransport(() => ({
    status: 429,
    headers: {
      "content-type": "application/json",
      ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
    },
    body: Buffer.from(JSON.stringify({ detail: "slow down" })),
  }));
  const engine = new RequestEngine({
    transport: mt.transport,
    maxRetries,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { engine, mt, delays };
}

test("a 429 with Retry-After in seconds waits that long before each retry", async () => {
  const { engine, mt, delays } = retryingEngine("1");
  await assert.rejects(() => engine.getJson("/x"), (e: unknown) => e instanceof CkanApiError && e.status === 429);
  assert.equal(mt.calls.length, 3);
  assert.deepEqual(delays, [1000, 1000]);
});

test("without a usable Retry-After the retries back off linearly", async () => {
  for (const header of [undefined, "", "-1", "1.5", "soon", "1e3", "2026-09-26T10:00:00Z"]) {
    const { engine, delays } = retryingEngine(header);
    await assert.rejects(() => engine.getJson("/x"));
    assert.deepEqual(delays, [200, 400], String(header));
  }
});

test("a Retry-After above MAX_RETRY_AFTER_MS is not retried: the error surfaces at once", async () => {
  for (const header of ["31", "999999", "99999999999999999999", "Fri, 31 Dec 9999 23:59:59 GMT"]) {
    const { engine, mt, delays } = retryingEngine(header);
    await assert.rejects(() => engine.getJson("/x"), (e: unknown) => e instanceof CkanApiError && e.status === 429);
    assert.equal(mt.calls.length, 1, header);
    assert.deepEqual(delays, [], header);
  }
});

test("parseRetryAfter reads delay-seconds and IMF-fixdate HTTP-dates", () => {
  const now = Date.parse("Sat, 26 Sep 2026 10:00:00 GMT");
  assert.equal(parseRetryAfter("0", now), 0);
  assert.equal(parseRetryAfter(" 30 ", now), 30_000);
  assert.equal(parseRetryAfter(["2", "9"], now), 2000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 10:00:05 GMT", now), 5000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 09:00:00 GMT", now), 0); // past date: retry now
  for (const bad of [undefined, "", "-1", "+5", "1.5", "1e3", "0x10", "Saturday, 26-Sep-26 10:00:05 GMT"]) {
    assert.equal(parseRetryAfter(bad, now), undefined, String(bad));
  }
  assert.equal(MAX_RETRY_AFTER_MS, 30_000);
});

test("a redirect with a malformed or missing Location is an API error naming it, not a crash", async () => {
  const cases: [Record<string, string>, string][] = [
    [{ location: "http://[::1" }, "redirect to http://[::1 not followed"],
    [{ location: `http://[::1${ESC}[31m` }, "redirect to http://[::1 not followed"],
    [{}, "redirect not followed (no Location header)"],
  ];
  for (const [headers, detail] of cases) {
    const mt = makeMockTransport(() => ({ status: 302, headers, body: Buffer.from("") }));
    const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
    await assert.rejects(
      () => e.getJson("/x"),
      (err: unknown) => {
        assert.ok(err instanceof CkanApiError);
        assert.equal(err.status, 302);
        assert.equal(err.detail, detail);
        assert.equal(err.message, `HTTP 302 for GET https://a.example/x: ${detail}`);
        return true;
      },
    );
    assert.equal(mt.calls.length, 1);
  }
});

test("a UTF-8 BOM is ignored and a declared charset is decoded", async () => {
  const bom = makeMockTransport(() =>
    rawResponse(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"city":"München"}')]), "application/json"),
  );
  assert.deepEqual(await new RequestEngine({ transport: bom.transport }).getJson("/x"), { city: "München" });

  const latin1 = makeMockTransport(() =>
    rawResponse(Buffer.from('{"city":"München"}', "latin1"), "application/json; charset=iso-8859-1"),
  );
  assert.deepEqual(await new RequestEngine({ transport: latin1.transport }).getJson("/x"), { city: "München" });

  const quoted = makeMockTransport(() =>
    rawResponse(Buffer.from('{"city":"München"}', "utf8"), 'application/json; charset="UTF-8"'),
  );
  assert.deepEqual(await new RequestEngine({ transport: quoted.transport }).getJson("/x"), { city: "München" });
});

test("an unknown response charset is a CkanParseError naming it", async () => {
  const mt = makeMockTransport(() => rawResponse("{}", `application/json; charset=x-nope${ESC}`));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) =>
      err instanceof CkanParseError &&
      err.message === 'GET https://a.example/x: unsupported response charset "x-nope".',
  );
});

test("the constructor refuses out-of-range numeric limits (CkanValidationError, no request)", async () => {
  const { CkanValidationError } = await import("../src/errors.js");
  const { MAX_REDIRECTS, MAX_RETRIES } = await import("../src/engine.js");
  const bad: [string, number][] = [
    ["timeoutMs", -1], ["timeoutMs", 1.5], ["timeoutMs", NaN], ["timeoutMs", 2_147_483_648],
    ["maxRetries", -1], ["maxRetries", 1.5], ["maxRetries", Infinity], ["maxRetries", MAX_RETRIES + 1],
    ["maxRedirects", -1], ["maxRedirects", NaN], ["maxRedirects", MAX_REDIRECTS + 1],
    ["maxResponseBytes", -1], ["maxResponseBytes", 1.5], ["maxResponseBytes", NaN],
    ["retryDelayMs", -1], ["retryDelayMs", Infinity],
  ];
  for (const [name, value] of bad) {
    assert.throws(
      () => new RequestEngine({ [name]: value }),
      (err: unknown) => err instanceof CkanValidationError && err.message.startsWith(`Invalid ${name}: `),
      `${name}=${value}`,
    );
  }
  const good: [string, number][] = [
    ["timeoutMs", 0], ["timeoutMs", 2_147_483_647], ["maxRetries", 0], ["maxRetries", MAX_RETRIES],
    ["maxRedirects", 0], ["maxRedirects", MAX_REDIRECTS], ["maxResponseBytes", 0], ["retryDelayMs", 0],
  ];
  for (const [name, value] of good) new RequestEngine({ [name]: value });
});

test("the constructor refuses a blank or unsendable userAgent, before any request", async () => {
  const { CkanValidationError } = await import("../src/errors.js");
  const { assertHeaderValue } = await import("../src/engine.js");
  for (const ua of ["", " ", "a\r\nb", "€"]) {
    const mt = makeMockTransport(() => jsonResponse({}));
    assert.throws(
      () => new RequestEngine({ transport: mt.transport, userAgent: ua }),
      (err: unknown) => err instanceof CkanValidationError && err.message.startsWith("Invalid userAgent: "),
      JSON.stringify(ua),
    );
    assert.equal(mt.calls.length, 0);
  }
  assert.equal(assertHeaderValue("User-Agent", "a\tb"), "a\tb");
});

test("a fetch-style transport's headers are read in any case: Location, charset (result 04 Bug 2)", async () => {
  // A 302 whose Location sits in a Headers object is followed.
  let n = 0;
  const redirect = makeMockTransport(() =>
    n++ === 0
      ? ({ status: 302, headers: new Headers({ Location: "/moved" }), body: Buffer.alloc(0) } as unknown as HttpResponse)
      : jsonResponse({ ok: true }),
  );
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: redirect.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: true });
  assert.equal(redirect.calls[1]?.url, "https://example.test/moved");
  // A canonical-case Content-Type with a Latin-1 charset is decoded, not read as UTF-8.
  const latin1 = makeMockTransport(() => ({
    status: 200,
    headers: { "Content-Type": "application/json; charset=iso-8859-1" } as unknown as HttpResponse["headers"],
    body: Buffer.from([0x22, 0xe4, 0x22]),
  }));
  assert.equal(await new RequestEngine({ baseUrl: "https://example.test", transport: latin1.transport }).getJson("/x"), "ä");
});

test("a redirect to a non-http(s) scheme is refused before the transport sees it", async () => {
  const mt = makeMockTransport(() => ({ status: 302, headers: { location: "ftp://files.example/x" }, body: Buffer.alloc(0) }));
  await assert.rejects(
    new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport }).getJson("/x"),
    (err: unknown) => err instanceof CkanNetworkError && /unsupported protocol "ftp:"/.test(err.message),
  );
  assert.equal(mt.calls.length, 1);
});

test("cutText never cuts inside a surrogate pair; toWellFormed replaces half a character", () => {
  assert.equal(cutText("ab\u{1f600}cd", 3), "ab");
  assert.equal(cutText("ab\u{1f600}cd", 4), "ab\u{1f600}");
  assert.equal(cutText("short", 10), "short");
  assert.equal(toWellFormed("a\ud83d b\ude00 \u{1f600}"), "a\ufffd b\ufffd \u{1f600}");
});

test("a server message cut at 500 characters keeps the message well-formed (error answer and success:false)", async () => {
  for (const message of ["\u{1f600}".repeat(400), "a" + "\u{1f600}".repeat(400)]) {
    const error = { __type: "Search Error", message };
    for (const answer of [jsonResponse({ success: false, error }, 409), jsonResponse({ success: false, error })]) {
      const client = new CkanClient({ transport: async () => answer });
      await assert.rejects(client.status(), (err: Error) => {
        assert.equal(toWellFormed(err.message), err.message);
        assert.match(err.message, /…$/);
        return true;
      });
    }
  }
});

test("a charset, a content type, a redirect target and an action name are quoted at most 500 characters long (L3)", async () => {
  const x = "x".repeat(5000);
  const answers: HttpResponse[] = [
    { status: 200, headers: { "content-type": `application/json; charset=${x}` }, body: Buffer.from("{}") },
    { status: 200, headers: { "content-type": `text/${x}` }, body: Buffer.from("<html>") },
    { status: 302, headers: { location: `${x}:/elsewhere` }, body: Buffer.from("") },
    { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}"), url: `https://other.example.test/${x}` },
  ];
  for (const answer of answers) {
    const engine = new RequestEngine({ transport: async () => answer });
    await assert.rejects(engine.getJson("/api/3/action/status_show"), (err: Error) => {
      assert.ok(err.message.length < 800, `${err.message.length}: ${err.message.slice(0, 100)}`);
      assert.match(err.message, /x…/);
      return true;
    });
  }
  const name = "a".repeat(5000);
  for (const answer of [jsonResponse({ success: false, error: { message: "denied" } }), jsonResponse({ hello: "world" })]) {
    const client = new CkanClient({ transport: async () => answer });
    await assert.rejects(client.action(name), (err: Error) => {
      // The request (the URL holds the name) and the name: two values, each cut at 500.
      assert.ok(err.message.length < 1300, `${err.message.length}`);
      assert.match(err.message, /a…/);
      return true;
    });
  }
});

test("credentials a server echoes are scrubbed from the error: Basic, user:password, password (L13)", async () => {
  const basic = Buffer.from("alice:pa ss-pw", "utf8").toString("base64");
  const body = JSON.stringify({ success: false, error: { message: `no: Basic ${basic} / alice:pa ss-pw / pa ss-pw` } });
  const engine = new RequestEngine({
    baseUrl: "https://alice:pa%20ss-pw@mirror.example",
    transport: async () => ({ status: 403, headers: { "content-type": "application/json" }, body: Buffer.from(body) }),
  });
  await assert.rejects(engine.getJson("/api/3/action/status_show"), (err: CkanApiError) => {
    for (const form of [basic, "alice:pa ss-pw", "pa ss-pw"]) {
      assert.ok(!err.message.includes(form), err.message);
      assert.ok(!err.body.includes(form), err.body);
    }
    assert.match(err.message, /no: Basic \*\*\* \/ \*\*\* \/ \*\*\*/);
    return true;
  });
  // The same echo in a success:false envelope on HTTP 200.
  const client = new CkanClient({
    baseUrl: "https://alice:pa%20ss-pw@mirror.example",
    transport: async () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(body) }),
  });
  await assert.rejects(client.status(), (err: Error) => {
    for (const form of [basic, "alice:pa ss-pw", "pa ss-pw"]) assert.ok(!err.message.includes(form), err.message);
    return true;
  });
});

test("a header named __proto__ is an ordinary header, never the prototype of the headers read (T12)", async () => {
  // A JavaScript transport may return any object; JSON.parse makes "__proto__" an own key.
  const headers = JSON.parse('{"__proto__":{"content-type":"text/html"}}') as Record<string, string>;
  const e = new RequestEngine({ transport: async () => ({ status: 200, headers, body: Buffer.from("<html>") }) });
  // With the prototype set, "text/html" was read as the Content-Type and named in the message.
  await assert.rejects(e.getJson("/x"), (err: Error) => err instanceof CkanParseError && !err.message.includes("text/html"));
  const fetchLike = new Headers([["__proto__", "x"], ["content-type", "application/json"]]);
  const f = new RequestEngine({ transport: async () => ({ status: 200, headers: fetchLike as unknown as Record<string, string>, body: Buffer.from('{"a":1}') }) });
  assert.deepEqual(await f.getJson("/x"), { a: 1 });
});

test("an answer error names the request: method and URL, userinfo left out (D9)", async () => {
  const answers: Array<[string, () => HttpResponse]> = [
    ["the answer is not valid JSON (expected JSON, got Content-Type \"text/html\").", () => rawResponse("<html>", "text/html")],
    ["the answer is not valid JSON.", () => rawResponse("{", "application/json")],
    ["empty response body.", () => rawResponse(" ", "application/json")],
    ["the number 1e400 cannot be represented exactly.", () => rawResponse('{"n":1e400}', "application/json")],
    ['unsupported response charset "x-bogus".', () => rawResponse("{}", "application/json; charset=x-bogus")],
  ];
  for (const [what, respond] of answers) {
    const e = new RequestEngine({ baseUrl: "https://alice:s3cret@ckan.example.test", transport: makeMockTransport(respond).transport });
    await assert.rejects(e.getJson("/items", { q: "x" }), (err: unknown) => {
      assert.ok(err instanceof CkanParseError, what);
      assert.equal(err.message, `GET https://ckan.example.test/items?q=x: ${what}`);
      return true;
    });
  }
});

test("text that is not valid is replaced with U+FFFD and reported through onWarning, never silently (D2)", async () => {
  const cases: Array<[string, Buffer, string, unknown, number]> = [
    // A lone surrogate written as an escape (high alone, low alone); a real pair and an escaped backslash stay.
    ["lone escapes", Buffer.from('{"a":"x\\ud800y","b":"\\udc00","c":"\\ud83d\\ude00","d":"\\\\ud800"}'), "application/json", { a: "x\ufffdy", b: "\ufffd", c: "\u{1f600}", d: "\\ud800" }, 2],
    // A lone surrogate in a member name.
    ["lone in a key", Buffer.from('{"\\udbff":1}'), "application/json", { "\ufffd": 1 }, 1],
    // Invalid UTF-8 bytes; a U+FFFD the server sent is not counted.
    ["invalid bytes", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xc3]), Buffer.from('","b":"\ufffd"}')]), "application/json", { a: "\ufffd\ufffd", b: "\ufffd" }, 2],
    // A byte undefined in a single-byte charset.
    ["iso-8859-3", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xa5]), Buffer.from('"}')]), "application/json; charset=iso-8859-3", { a: "\ufffd" }, 1],
  ];
  for (const [label, body, type, expected, count] of cases) {
    const warnings: string[] = [];
    const e = new RequestEngine({ onWarning: (m) => warnings.push(m), transport: makeMockTransport(() => rawResponse(body, type)).transport });
    const value = await e.getJson("/items", { q: "x" });
    assert.deepEqual(value, expected, label);
    assert.ok(!/[\ud800-\udfff]/u.test(JSON.stringify(value)), `${label}: well-formed`);
    assert.deepEqual(warnings, [
      `GET https://suche.transparenz.hamburg.de/items?q=x: ${count} ${count === 1 ? "character" : "characters"} of the answer ${count === 1 ? "was" : "were"} not valid text (invalid bytes or a lone surrogate) and replaced with U+FFFD.`,
    ], label);
  }
  // Valid text: no warning; a throwing hook never fails the request.
  const quiet: string[] = [];
  const ok = new RequestEngine({ onWarning: (m) => quiet.push(m), transport: makeMockTransport(() => rawResponse('{"a":"\\u00fc\ufffd"}', "application/json")).transport });
  assert.deepEqual(await ok.getJson("/x"), { a: "ü\ufffd" });
  assert.deepEqual(quiet, []);
  const throwing = new RequestEngine({ onWarning: () => { throw new Error("hook"); }, transport: makeMockTransport(() => rawResponse('"\\ud800"', "application/json")).transport });
  assert.equal(await throwing.getJson("/x"), "\ufffd");
  const { CkanValidationError } = await import("../src/errors.js");
  assert.throws(() => new RequestEngine({ onWarning: "log" as unknown as () => void }), CkanValidationError);
});

test("bigIntegerKeys: a declared member's number is its exact literal as a string; others keep the rule (D3)", async () => {
  const { bigIntegerKeysOption, firstInexactNumber, scanNumbers } = await import("../src/engine.js");
  const { CkanValidationError } = await import("../src/errors.js");
  const body = '{"_version_":1858054135406919680,"small":{"_version_":5},"neg":{"\\u005fversion_":-12345678901234567890},' +
    '"s":{"_version_":"text"},"n":{"_version_":null},"arr":{"_version_":[1]},"t":"\\"_version_\\":1","n2":42}';
  const e = new RequestEngine({
    bigIntegerKeys: new Set(["_version_"]),
    transport: makeMockTransport(() => rawResponse(body, "application/json")).transport,
  });
  assert.deepEqual(await e.getJson("/x"), {
    _version_: "1858054135406919680", small: { _version_: "5" }, neg: { _version_: "-12345678901234567890" },
    s: { _version_: "text" }, n: { _version_: null }, arr: { _version_: [1] }, t: '"_version_":1', n2: 42,
  });
  assert.deepEqual([...e.bigIntegerKeys], ["_version_"]);
  // An undeclared big number is still refused; a declared member doesn't make others exact.
  const other = new RequestEngine({
    bigIntegerKeys: ["_version_"] as unknown as ReadonlySet<string>,
    transport: makeMockTransport(() => rawResponse('{"_version_":1858054135406919680,"id":12345678901234567890}', "application/json")).transport,
  });
  await assert.rejects(other.getJson("/x"), /the number 12345678901234567890 cannot be represented exactly/);
  // Malformed stays malformed: a declared member with a leading zero still fails JSON.parse.
  const malformed = new RequestEngine({ bigIntegerKeys: new Set(["_version_"]), transport: makeMockTransport(() => rawResponse('{"_version_":01}', "application/json")).transport });
  await assert.rejects(malformed.getJson("/x"), /not valid JSON/);
  for (const bad of [new Set([""]), new Set([1]), "x", 5, null]) {
    assert.throws(() => new RequestEngine({ bigIntegerKeys: bad as unknown as ReadonlySet<string> }),
      (err: unknown) => err instanceof CkanValidationError && err.message === "Invalid option bigIntegerKeys: expected a set of non-empty member names.");
  }
  // The option reader copies a set or a list; undefined is none.
  const names = new Set(["a"]);
  const copy = bigIntegerKeysOption(names);
  names.add("b");
  assert.deepEqual([...copy], ["a"]);
  assert.deepEqual([...bigIntegerKeysOption(["x", "y"] as unknown as ReadonlySet<string>)], ["x", "y"]);
  assert.equal(bigIntegerKeysOption(undefined).size, 0);
  // Without declarations the scan is the plain number check.
  assert.equal(firstInexactNumber('{"a":"1e400","b":3e-324}'), "3e-324");
  assert.deepEqual(scanNumbers('{"a":1}'), { json: '{"a":1}', inexact: undefined });
});

test("an answer longer than V8's longest string is a CkanParseError naming the request, not a plain Error (T14)", async (t) => {
  // A real one needs a body of 512 MB and more (possible with maxResponseBytes 0): V8's own
  // error is stood in for, for the body marked by its length. `fatalToo` false: the strict
  // decode fails as for an invalid byte, and only the replacing one after it is too long.
  const huge = Buffer.from('{"success":true,"result":[]}  ');
  const tooLong = (): Error => Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" });
  let fatalToo = true;
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, input?: Uint8Array, options?: { stream?: boolean }) {
    if (input !== undefined && input.byteLength === huge.length) {
      if (this.fatal && !fatalToo) throw Object.assign(new TypeError("The encoded data was not valid"), { code: "ERR_ENCODING_INVALID_ENCODED_DATA" });
      throw tooLong();
    }
    return decode.call(this, input, options);
  });
  const toString = Buffer.prototype.toString;
  t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (this.length === huge.length && args[0] === "utf8") throw tooLong();
    return toString.apply(this, args);
  });
  for (const strictToo of [true, false]) {
    fatalToo = strictToo;
    const e = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "application/json")).transport });
    await assert.rejects(e.getJson("/api/3/action/package_list", { q: "x" }), (err: unknown) => {
      assert.ok(err instanceof CkanParseError, `${strictToo}: ${String(err)}`);
      assert.equal(
        err.message,
        `GET https://suche.transparenz.hamburg.de/api/3/action/package_list?q=x: the answer is too large to read as text (${huge.length} bytes; the longest string is 536870888 characters).`,
      );
      return true;
    });
  }
  // An error status with such a body is still the API error, without the unreadable body.
  const failing = new RequestEngine({ maxResponseBytes: 0, maxRetries: 0, transport: makeMockTransport(() => rawResponse(huge, "application/json", 500)).transport });
  await assert.rejects(failing.getJson("/x"), (err: unknown) => err instanceof CkanApiError && err.status === 500 && err.body === "");
  // So is a redirect that is not followed.
  const moved = new RequestEngine({
    maxResponseBytes: 0,
    maxRedirects: 0,
    transport: makeMockTransport(() => ({ status: 301, headers: { location: "https://elsewhere.example/x" }, body: huge })).transport,
  });
  await assert.rejects(moved.getJson("/x"), (err: unknown) => err instanceof CkanApiError && err.status === 301 && err.body === "");
});

test("redactUrlUserinfo hides every URL's userinfo in one linear pass, however many URLs", async () => {
  const { redactUrlUserinfo } = await import("../src/errors.js");
  const elapsed = (f: () => unknown): number => {
    const started = performance.now();
    f();
    return performance.now() - started;
  };
  // The URL regex this replaces (a scheme tried at every word start) takes about 3 s on this.
  assert.ok(elapsed(() => redactUrlUserinfo("a.".repeat(30_000))) < 1000);
  assert.equal(redactUrlUserinfo("a -https://u:p@h/x and x-ftp://v@w?q, mail@example.org"), "a -https://***@h/x and x-ftp://***@w?q, mail@example.org");
  assert.equal(redactUrlUserinfo("argument 'ftp://user:s3cret@h.example' is invalid"), "argument 'ftp://***@h.example' is invalid");
  assert.equal(redactUrlUserinfo("1://u:p@h ://u:p@h"), "1://u:p@h ://u:p@h");
  assert.equal(redactUrlUserinfo("https://h/p?u=a@b"), "https://h/p?u=a@b");
  for (const text of ["a".repeat(1_000_000), "a.".repeat(500_000), "://".repeat(100_000), `https://${"u".repeat(1_000_000)}`]) {
    assert.equal(redactUrlUserinfo(text), text);
  }
  assert.equal(redactUrlUserinfo("https://u:p@h ".repeat(100_000)), "https://***@h ".repeat(100_000));
});


test("redactUrlUserinfo hides the userinfo of a URL glued onto the one before it, still linear (B2)", async () => {
  const { redactUrlUserinfo } = await import("../src/errors.js");
  const elapsed = (f: () => unknown): number => {
    const started = performance.now();
    f();
    return performance.now() - started;
  };
  // The authority read for the first `://` ends at the `/` of the second; the second URL starts
  // inside it (its scheme is the first one's host, or follows a redacted `@`), so the search goes
  // on after each `://`, not after the authority. The regex this replaces redacted both; the
  // first linear pass missed them.
  assert.equal(redactUrlUserinfo("https://host://u:p@h"), "https://host://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@x://v:q@w"), "https://***@x://***@w");
  assert.equal(redactUrlUserinfo("see https://h.example:/x://u:p@h"), "see https://h.example:/x://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@1://v:q@w"), "https://***@1://v:q@w");
  // Many glued URLs, unredacted and redacted, and long scheme-character runs: one pass each.
  const n = 100_000;
  for (const [text, want] of [
    [`${"a://".repeat(n)}u:p@h`, `${"a://".repeat(n)}***@h`],
    ["x://u:p@".repeat(n), "x://***@".repeat(n)],
    [`${"a.".repeat(500_000)}://u:p@h`, `${"a.".repeat(500_000)}://***@h`],
    [`https://${"a.".repeat(500_000)}://u:p@h`, `https://${"a.".repeat(500_000)}://***@h`],
    ["a:".repeat(500_000), "a:".repeat(500_000)],
  ] as const) {
    let got = "";
    const ms = elapsed(() => (got = redactUrlUserinfo(text)));
    assert.ok(got === want, `${text.slice(0, 40)}…`);
    assert.ok(ms < 1000, `${Math.round(ms)} ms on ${text.slice(0, 40)}…`);
  }
});

test("a TextBuilder joins its pieces in order across batches", async () => {
  const { TextBuilder } = await import("../src/errors.js");
  const b = new TextBuilder();
  const expected: string[] = [];
  for (let i = 0; i < 40_000; i++) {
    b.push(String(i), ",");
    expected.push(String(i), ",");
  }
  assert.equal(b.toString(), expected.join(""));
  assert.equal(new TextBuilder().toString(), "");
});

test("Solr's reason is found in linear time, however long the server's message", async () => {
  const { describeCkanError, MAX_MESSAGE_VALUE_LENGTH } = await import("../src/errors.js");
  // A lazy group tried against `\\+n` at every step was quadratic on a run of backslashes:
  // 16 000 took ~0.4 s, a few MB would hold the process for hours, past --timeout.
  for (const tail of ["\\".repeat(1_000_000), "\\'".repeat(500_000), "x".repeat(1_000_000)]) {
    const started = performance.now();
    describeCkanError({ __type: "Search Error", message: `[Reason: ${tail}` });
    describeCkanError({ __type: "Search Error", message: `Search error: [Reason: java.lang.Error: ${tail}]` });
    const ms = performance.now() - started;
    assert.ok(ms < 500, `${tail.slice(0, 2)}…: ${Math.round(ms)} ms`);
  }
  // A reason that ends within reach is cut out as before; an unterminated one leaves the message.
  assert.equal(describeCkanError({ __type: "Search Error", message: "x [Reason: a.b.FooException: bad \\\\'q\\\\'\\\\nmore]" }), "Search Error: bad 'q'");
  assert.equal(describeCkanError({ __type: "Search Error", message: "x [Reason: bad" }), "Search Error: x [Reason: bad");
  assert.equal(describeCkanError({ __type: "Search Error", message: "x [Reason: ]" }), "Search Error: x [Reason: ]");
  // A reason longer than the window is shown from its start (the message cuts it at 500 anyway).
  const long = "r".repeat(3 * MAX_MESSAGE_VALUE_LENGTH);
  const shown = describeCkanError({ __type: "Search Error", message: `q [Reason: ${long}]` });
  assert.ok(shown.startsWith(`Search Error: ${"r".repeat(MAX_MESSAGE_VALUE_LENGTH)}`), shown.slice(0, 40));
});

test("a base URL the URL parser and a text reading could see as two hosts is refused, never echoing the password", async () => {
  const { CkanValidationError, credentialsIn } = await import("../src/errors.js");
  const { validateBaseUrl } = await import("../src/engine.js");
  const pw = "s3cret-Pw";
  // WHATWG ends an http(s) host at "\" and skips any slashes after "http:"; the text reading
  // ended the authority only at "/", "?" or "#" and needed "//".
  for (const base of [
    `http://alice:${pw}@trusted.example\\@127.0.0.1:9`,
    `https://alice:${pw}@portal.example\\@attacker.example`,
    "https://api.example\\evil",
    `http:alice:${pw}@127.0.0.1:9`,
    `http:/alice:${pw}@127.0.0.1:9`,
    `http:///alice:${pw}@127.0.0.1:9`,
    `https:\\\\alice:${pw}@127.0.0.1:9`,
  ]) {
    for (const build of [() => new CkanClient({ baseUrl: base }), () => new RequestEngine({ baseUrl: base }), () => validateBaseUrl(base)]) {
      assert.throws(
        build,
        (err: unknown) => err instanceof CkanValidationError && /^Invalid base URL: /.test(err.message) && !err.message.includes(pw),
        base,
      );
    }
  }
  // The userinfo a URL carries ends where WHATWG ends the authority, at a backslash too.
  assert.deepEqual(credentialsIn(`https://alice:pw@api.example\\@evil.example/x`), ["alice:pw"]);
  assert.deepEqual(credentialsIn("http://alice:pw@h.example\\x"), ["alice:pw"]);
  assert.deepEqual(credentialsIn("foo://u:p@a.example\\@b.example/x"), ["u:p@a.example\\"]);
  assert.deepEqual(credentialsIn("https://alice:pw@api.example/v1/@x"), ["alice:pw"]);
  // After a special scheme WHATWG skips any slashes and backslashes; so does the userinfo.
  for (const base of ["http:alice:pw@h.example", "http:/alice:pw@h.example", "http:///alice:pw@h.example/x", "HTTPS:\\\\alice:pw@h.example"]) {
    assert.deepEqual(credentialsIn(base), ["alice:pw"], base);
    assert.equal(new URL(base).password, "pw", base);
  }
});

test("requests go to the host of the parsed base URL, spelled as it parses, with the userinfo only in the Authorization header", async () => {
  for (const base of ["https://alice:pw@api.example/v1/@evil.example", "https://API.Example:443/v1", "https://bob:p%40ss@h.example:8443/ckan/"]) {
    const parsed = new URL(base);
    const mt = makeMockTransport(() => jsonResponse({ help: "h", success: true, result: {} }));
    await new RequestEngine({ transport: mt.transport, baseUrl: base }).getJson("/api/3/action/status_show");
    const sent = mt.last();
    assert.equal(new URL(sent.url).origin, parsed.origin, `${base}: ${sent.url}`);
    // The URL as sent names that host in the text too, without the userinfo, so a transport
    // that reads the string (not the parsed URL) reaches the same host and sends no credential.
    assert.equal(sent.url.slice(sent.url.indexOf("//") + 2).split("/")[0], parsed.host, `${base}: ${sent.url}`);
    const pair = parsed.username === "" ? undefined : `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
    assert.equal(sent.headers?.["Authorization"], pair === undefined ? undefined : `Basic ${Buffer.from(pair).toString("base64")}`);
  }
});

test("sanitizeServerText drops whole escape sequences, not just their control bytes (C)", () => {
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  for (const [input, expected] of [
    [`line1 ${ESC}]0;title${BEL}rest`, "line1 rest"],
    [`${ESC}]8;;https://evil.example${ESC}\\click${ESC}]8;;${ESC}\\`, "click"],
    [`${ESC}[31mred${ESC}[0m plain`, "red plain"],
    [`${ESC}[1;31;4mbold`, "bold"],
    [`${CSI}2Jcleared`, "cleared"],
    [`${OSC8}0;t${ST8}ok`, "ok"],
    [`a${ESC}7b${ESC}(Bc`, "abc"],
    // Unterminated: only ESC and its introducer go, the text stays.
    [`keep ${ESC}]0;no terminator here`, "keep 0;no terminator here"],
  ] as const) {
    assert.equal(sanitizeServerText(input), expected, JSON.stringify(input));
  }
});

test("sanitizeServerText drops invisible format characters (zero-width, soft hyphen, BOM) (C)", () => {
  const text = "real​ error Error: forged⁦x⁩ ﻿end­‍⁠!";
  assert.equal(sanitizeServerText(text), "real error Error: forgedx end!");
  assert.equal(sanitizeServerText("  Cannot GET  /api/3/action/x  Größe  "), "Cannot GET /api/3/action/x Größe");
});

test("sanitizeServerText reads a bounded prefix and drops what the per-character filter dropped (C)", () => {
  // The filter it replaces, one character at a time: C0 but TAB to CR, DEL, C1 and Cf go.
  const perCharacter = (text: string): string =>
    [...text]
      .filter((ch) => {
        const n = ch.codePointAt(0) ?? 0;
        return (n >= 0x09 && n <= 0x0d) || !(n <= 0x1f || (n >= 0x7f && n <= 0x9f) || /\p{Cf}/u.test(ch));
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const every = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join("") + "\u{1f600}\u{e0001}\ud800x";
  for (let at = 0; at < every.length; at += 512) {
    const piece = every.slice(at, at + 512).replace(/[\u001b\u0090\u0098\u009b-\u009f]/g, "");
    assert.equal(sanitizeServerText(piece), perCharacter(piece), `from U+${at.toString(16)}`);
  }
  // At most 16 384 units of the text are read, never half a surrogate pair.
  assert.equal(sanitizeServerText("x".repeat(100_000)).length, 16_384);
  assert.equal(sanitizeServerText(`${"x".repeat(16_383)}\u{1f600}`), "x".repeat(16_383));
  // A control string ends at another introducer: the first is dropped by the filter, the second
  // string as a whole.
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  assert.equal(sanitizeServerText(`a${OSC8}0;x${OSC8}0;t${ST8}b`), "a0;xb");
  assert.equal(sanitizeServerText(`a${ESC}]0;x${ESC}]0;t${BEL}b`), "a0;xb");
});

test("an error answer of unterminated control-string introducers is cleaned in linear time (C)", async () => {
  // 100 000 × U+009D took about 16 s with a control-string body that admitted the introducers.
  for (const opener of ["\\u009d", "\\u0090", "\\u0098", "\\u009e", "\\u009f", "\\u001b]"]) {
    const body = `{"success":false,"error":{"__type":"Search Error","message":"${opener.repeat(100_000)} tail"}}`;
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body, "application/json", 500)).transport, maxRetries: 0 });
    const start = performance.now();
    await assert.rejects(e.getJson("/x"), (err: unknown) => err instanceof CkanApiError && !hasControlChars(err.message));
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${opener}: ${Math.round(ms)} ms`);
  }
});

// These tests start a process with a small heap: 30 s instead of the suite's 5 s.
const STARTS_A_PROCESS = { timeout: 30_000 };

test("scanNumbers quotes millions of declared members within a small heap (C)", STARTS_A_PROCESS, () => {
  // One `+=` per quoted member made a rope node each: 3 million of them exhausted a 128 MB heap.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const n = 3_000_000;
  const script =
    `const { scanNumbers } = await import(${JSON.stringify(engine)});` +
    `const json = "[" + '{"k":1},'.repeat(${n - 1}) + '{"k":1}]';` +
    `process.stdout.write(String(scanNumbers(json, new Set(["k"])).json.length));`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out, String(n * 10 + 1));
});

test("an answer of millions of lone surrogate escapes is repaired within a small heap (C)", STARTS_A_PROCESS, () => {
  // 6 million repairs (36 MB): one `+=` each exhausted a 128 MB heap; batched, it fits.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const n = 6_000_000;
  const script =
    `const { RequestEngine } = await import(${JSON.stringify(engine)});` +
    `const body = Buffer.from('{"x":"' + "\\\\ud800".repeat(${n}) + '"}');` +
    `let warned = "";` +
    `const transport = async () => ({ status: 200, headers: { "content-type": "application/json" }, body });` +
    `const value = await new RequestEngine({ transport, onWarning: (m) => (warned = m) }).getJson("/x");` +
    `process.stdout.write(value.x.length + " " + /: (\\d+) characters/.exec(warned)[1]);`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out, `${n} ${n}`);
});

// A password with characters a JSON writer escapes (a quote) or may write as \u00XX (an umlaut).
const ECHO_PW = "pä\"s's-W0rd";
const ECHO_BASE = `https://alice:${encodeURIComponent(ECHO_PW)}@mirror.example`;
const ECHO_BASIC = Buffer.from(`alice:${ECHO_PW}`, "utf8").toString("base64");
/** The forms of the credential an error must not carry: decoded, and as a quoted value spells them (`\"`). */
const ECHO_SECRETS = [ECHO_PW, `alice:${ECHO_PW}`, ECHO_BASIC].flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);

/** Everything a library user may log of an error: inspect, message, detail, errorType, and the decoded body. */
function everythingOf(err: unknown): string {
  let text = inspect(err, { depth: 10, showHidden: true });
  const e = err as { message?: unknown; detail?: unknown; errorType?: unknown; body?: unknown };
  text += [e.message, e.detail, e.errorType, e.body].map(String).join("\n");
  let decoded: unknown;
  try {
    decoded = typeof e.body === "string" ? JSON.parse(e.body) : undefined;
  } catch {
    // not JSON: the body as sent is all a caller reads
  }
  const walk = (v: unknown): void => {
    if (typeof v === "string") text += `\n${v}`;
    else if (v !== null && typeof v === "object") {
      for (const [k, w] of Object.entries(v)) {
        text += `\n${k}`;
        walk(w);
      }
    }
  };
  walk(decoded);
  return text;
}

/** `text` as a JSON writer that escapes every non-ASCII character writes it (Python's json.dumps). */
const asciiJson = (text: string): string =>
  JSON.stringify(text).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** `text` with every character written as a \uXXXX escape: no spelling of it as sent matches. */
const escapedJson = (text: string): string => `"${[...text].map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"`;

test("a credential echoed with JSON escapes is scrubbed from the message, the detail and the decoded body (D)", async () => {
  const echoes: Array<[string, string]> = [
    ["the password, ASCII-only JSON", asciiJson(`wrong password ${ECHO_PW}`)],
    ["the user:password, minimal JSON", JSON.stringify(`bad login alice:${ECHO_PW}`)],
    ["the password, every character escaped", escapedJson(ECHO_PW)],
    ["the site URL as the server decoded it", JSON.stringify(`no access to https://alice:${ECHO_PW}@mirror.example/x`)],
  ];
  const shapes: Array<[string, (json: string) => string]> = [
    ["CKAN's error object", (json) => `{"help":"h","success":false,"error":{"__type":"Authorization Error","message":${json}}}`],
    ["a plain message", (json) => `{"message":${json}}`],
    ["a bare JSON string", (json) => json],
  ];
  for (const status of [401, 500]) {
    for (const [shape, bodyWith] of shapes) {
      for (const [label, json] of echoes) {
        const e = new RequestEngine({ baseUrl: ECHO_BASE, maxRetries: 0, transport: async () => rawResponse(bodyWith(json), "application/json", status) });
        const err = await e.getJson("/api/3/action/status_show").catch((caught: unknown) => caught);
        assert.ok(err instanceof CkanApiError && err.message.startsWith(`HTTP ${status} `), `${shape}, ${label}: ${String(err)}`);
        const seen = everythingOf(err);
        for (const secret of ECHO_SECRETS) assert.ok(!seen.includes(secret), `${status} ${shape}, ${label}: ${seen.slice(0, 2000)}`);
      }
    }
  }
});

test("a credential in CKAN's success:false error on HTTP 200 is scrubbed, its __type too (D)", async () => {
  for (const json of [asciiJson(ECHO_PW), JSON.stringify(`alice:${ECHO_PW}`), escapedJson(ECHO_PW)]) {
    const body = `{"help":"h","success":false,"error":{"__type":${json},"message":${json}}}`;
    const client = new CkanClient({ baseUrl: ECHO_BASE, transport: async () => rawResponse(body, "application/json") });
    const err = await client.status().catch((caught: unknown) => caught);
    assert.ok(err instanceof Error, String(err));
    const seen = everythingOf(err);
    for (const secret of ECHO_SECRETS) assert.ok(!seen.includes(secret), `${json}: ${seen.slice(0, 2000)}`);
  }
});

test("an error body keeps its spelling unless a credential hides behind an escape (D)", async () => {
  const base = "https://alice:s3cret-pw@mirror.example";
  const bodyOf = async (body: string): Promise<string> => {
    const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "application/json", 500) });
    const err = await e.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof CkanApiError, String(err));
    return err.body;
  };
  // No credential, or one spelled as sent: the body as sent (scrubbed), escapes kept.
  assert.equal(await bodyOf('{"m":"caf\\u00e9 \\"x\\""}'), '{"m":"caf\\u00e9 \\"x\\""}');
  assert.equal(await bodyOf('{"m":"pw s3cret-pw \\u00e9"}'), '{"m":"pw *** \\u00e9"}');
  // Escaped: written again decoded, scrubbed in that spelling.
  assert.equal(await bodyOf('{"m":"pw s3cret\\u002dpw \\u00e9"}'), '{"m":"pw *** é"}');
  // Not JSON: nobody decodes it, it stays as sent.
  assert.equal(await bodyOf("pw s3cret\\u002dpw"), "pw s3cret\\u002dpw");
  // Deeply nested: written again where this runtime can, else left out (probed, not assumed:
  // whether JSON.stringify recurses depends on the Node version).
  const deep = `${"[".repeat(200_000)}"s3cret\\u002dpw"${"]".repeat(200_000)}`;
  let parses = true;
  let writes = true;
  try {
    const value: unknown = JSON.parse(deep);
    try {
      JSON.stringify(value);
    } catch {
      writes = false;
    }
  } catch {
    parses = false;
  }
  if (parses) {
    const body = await bodyOf(deep);
    assert.ok(!body.includes("s3cret"), body.slice(199_990, 200_030));
    assert.equal(body === "", !writes);
  }
});

test("an echo of the base URL as WHATWG spells it is scrubbed, a short password too (D)", async () => {
  // Typed raw; WHATWG writes `p%22%C3%A4` in the URL, which a server may echo.
  const e = new RequestEngine({
    baseUrl: 'https://alice:p"ä@mirror.example',
    maxRetries: 0,
    transport: async () => rawResponse(JSON.stringify({ message: "no access: https://alice:p%22%C3%A4@mirror.example/x" }), "application/json", 403),
  });
  const err = await e.getJson("/x").catch((caught: unknown) => caught);
  assert.ok(err instanceof CkanApiError, String(err));
  for (const text of [err.message, err.detail ?? "", err.body]) {
    assert.ok(!text.includes("p%22%C3%A4@") && !text.includes('p"ä@'), text);
  }
});

/** `text` with every run of percent escapes decoded where it is valid UTF-8. */
const percentDecoded = (text: string): string =>
  text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });

test("a credential in a redirect's Location is scrubbed from the error, in its path and its query (D2)", async () => {
  const locations = [
    `https://elsewhere.example/login?user=alice&pw=${encodeURIComponent(ECHO_PW)}`,
    `https://elsewhere.example/login?pw=${ECHO_PW}`,
    `https://elsewhere.example/${encodeURIComponent(`alice:${ECHO_PW}`)}/x`,
    `https://elsewhere.example/auth?basic=${ECHO_BASIC}`,
    `/relative/${ECHO_PW}`,
  ];
  for (const location of locations) {
    // Answered with the same 302 forever: the error names the last hop it reached.
    const loop = new RequestEngine({ baseUrl: ECHO_BASE, maxRetries: 0, transport: async () => ({ status: 302, headers: { location }, body: Buffer.from("") }) });
    const err = await loop.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof CkanApiError && /^HTTP 302 .*stopped after 5 redirects/.test(err.message), String(err));
    // One hop, then an error answer, a broken answer and a failed request: each names the URL it reached.
    const answers: Array<() => HttpResponse> = [
      () => rawResponse("{}", "application/json", 500),
      () => rawResponse("<html>", "text/html"),
      () => {
        throw new Error("connection reset");
      },
    ];
    const errors: unknown[] = [err];
    for (const answer of answers) {
      let calls = 0;
      const hop = new RequestEngine({
        baseUrl: ECHO_BASE,
        maxRetries: 0,
        transport: async () => (calls++ === 0 ? { status: 302, headers: { location }, body: Buffer.from("") } : answer()),
      });
      errors.push(await hop.getJson("/x").catch((caught: unknown) => caught));
    }
    for (const e of errors) {
      assert.ok(e instanceof Error, String(e));
      const seen = percentDecoded(everythingOf(e));
      for (const secret of ECHO_SECRETS) assert.ok(!seen.includes(secret), `${location}: ${seen.slice(0, 2000)}`);
    }
  }
  // A Location that does not parse is quoted as it came, scrubbed.
  const bad = new RequestEngine({ baseUrl: ECHO_BASE, transport: async () => ({ status: 302, headers: { location: `http://[::1/${ECHO_PW}` }, body: Buffer.from("") }) });
  const err = await bad.getJson("/x").catch((caught: unknown) => caught);
  assert.ok(err instanceof CkanApiError && /redirect to http:\/\/\[::1\/\*\*\* not followed/.test(err.message), String(err));
});

test("echoedCredentialForms treats a userinfo without a password as a token (Basic `TOKEN:`) (E)", async () => {
  const { echoedCredentialForms } = await import("../src/errors.js");
  const basic = (pair: string): string => Buffer.from(pair, "utf8").toString("base64");
  assert.deepEqual(echoedCredentialForms("alice:s3cret"), [basic("alice:s3cret"), "alice:s3cret", "s3cret"]);
  assert.deepEqual(echoedCredentialForms("T0ken"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T0ken:"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T%C3%B6k"), [basic("Tök:"), "Tök:"]); // short: not alone
  assert.deepEqual(echoedCredentialForms(":pw12"), [basic(":pw12"), ":pw12", "pw12"]);
  assert.deepEqual(echoedCredentialForms(""), []);
  assert.deepEqual(echoedCredentialForms(":"), []);
});

test("a token as the base URL's userinfo is scrubbed from library errors in every echoed form (E)", async () => {
  const token = "T0kenS3cret";
  const basic = Buffer.from(`${token}:`, "utf8").toString("base64");
  for (const base of [`https://${token}@mirror.example`, `https://${token}:@mirror.example`]) {
    for (const echo of [`bad token ${token}`, `Authorization: Basic ${basic}`, `user ${token}: unknown`]) {
      const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(JSON.stringify({ message: echo }), "application/json", 401) });
      const err = await e.getJson("/x").catch((caught: unknown) => caught);
      assert.ok(err instanceof CkanApiError && /^HTTP 401 /.test(err.message), String(err));
      const seen = everythingOf(err);
      assert.ok(!seen.includes(token) && !seen.includes(basic), `${base} ${echo}: ${seen.slice(0, 2000)}`);
    }
  }
});
