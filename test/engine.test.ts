import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRY_AFTER_MS, RequestEngine, parseRetryAfter } from "../src/client/engine.js";
import {
  CkanApiError,
  CkanNetworkError,
  CkanParseError,
} from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import type { HttpResponse } from "../src/client/http.js";

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

test("the constructor rejects a non-http(s) base URL (GOV-01)", () => {
  assert.throws(
    () => new RequestEngine({ baseUrl: "file:///etc/passwd" }),
    CkanNetworkError,
  );
  assert.throws(() => new RequestEngine({ baseUrl: "not a url" }), CkanNetworkError);
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
      assert.equal(err.detail, "Internal Server Error: boom[31mred2J");
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
        "Expected JSON from https://register.example.test/api/3/action/package_search?rows=0 but got text/html",
  );
});

test("control characters in the Content-Type are stripped from the error message", async () => {
  const mt = makeMockTransport(() => rawResponse("<html></html>", `text/${CSI}31m${ESC}[2Jhtml; charset=utf-8`));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => {
      assert.ok(err instanceof CkanParseError);
      assert.equal(err.message, "Expected JSON from https://a.example/x but got text/31m[2Jhtml");
      return true;
    },
  );
});

test("broken JSON labelled as JSON is reported as invalid JSON, not as the wrong type", async () => {
  const mt = makeMockTransport(() => rawResponse('{"help": "h", "succ', "application/json;charset=utf-8"));
  const e = new RequestEngine({ transport: mt.transport, baseUrl: "https://a.example" });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => err instanceof CkanParseError && err.message === "Invalid JSON from https://a.example/x",
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
    [{ location: `http://[::1${ESC}[31m` }, "redirect to http://[::1[31m not followed"],
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
