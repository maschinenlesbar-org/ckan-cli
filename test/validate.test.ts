import { test } from "node:test";
import assert from "node:assert/strict";
import { assertValid } from "../src/client/validate.js";
import { CkanError, CkanValidationError } from "../src/client/errors.js";
import * as library from "../src/index.js";
import { CkanClient } from "../src/client/client.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { parity } from "./helpers.js";

const positive = (n: number): string | undefined => (n > 0 ? undefined : "Expected a positive number.");

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("rows", 5, positive), 5);
});

test("assertValid throws CkanValidationError 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("rows", 0, positive),
    (err: unknown) =>
      err instanceof CkanValidationError &&
      err instanceof CkanError &&
      err.name === "CkanValidationError" &&
      err.message === "Invalid rows: Expected a positive number.",
  );
});

test("the package root exports CkanValidationError and assertValid", () => {
  assert.equal(library.CkanValidationError, CkanValidationError);
  assert.equal(library.assertValid, assertValid);
});

test("run() reports a CkanValidationError from an action as a usage error", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    env: {},
    createClient: (): CkanClient => {
      throw new CkanValidationError("Invalid rows: Expected a positive number.");
    },
  };
  assert.equal(await run(["status"], deps), 1);
  assert.deepEqual(err, ["Error: Invalid rows: Expected a positive number."]);
  assert.deepEqual(out, []);
});

test("parity() runs the CLI and the library on one transport and splits their requests", async () => {
  const result = await parity(["--compact", "status"], (transport) => new CkanClient({ transport }).status(), {
    responder: () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ success: true, result: { ckan_version: "2.10.11" } })),
    }),
  });
  assert.equal(result.cli.code, 0);
  assert.equal(result.cli.out, '{"ckan_version":"2.10.11"}');
  assert.equal(result.cli.requests.length, 1);
  assert.deepEqual(result.lib, { ok: true, value: { ckan_version: "2.10.11" }, requests: result.lib.requests });
  assert.equal(result.lib.requests.length, 1);
  assert.equal(result.cli.requests[0]!.url, result.lib.requests[0]!.url);
});

test("blankProblem: blank strings and lists with a blank entry are invalid", async () => {
  const { blankProblem, isBlank } = await import("../src/client/validate.js");
  for (const value of ["", " ", "\t\n", [""], ["a", " "]]) {
    assert.equal(blankProblem(value), "Expected a non-empty value.", JSON.stringify(value));
  }
  for (const value of ["a", " a ", [], ["a", "b"], 0, true, undefined, null]) {
    assert.equal(blankProblem(value), undefined, JSON.stringify(value));
  }
  assert.equal(isBlank(" "), true);
  assert.equal(isBlank("x"), false);
});

test("countProblem: a non-negative safe integer", async () => {
  const { countProblem } = await import("../src/client/validate.js");
  for (const n of [0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(countProblem(n), undefined, String(n));
  for (const n of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(countProblem(n), "Expected a non-negative integer.", String(n));
  }
});

test("facetLimitProblem: -1 or a non-negative safe integer", async () => {
  const { facetLimitProblem } = await import("../src/client/validate.js");
  for (const n of [-1, 0, 50]) assert.equal(facetLimitProblem(n), undefined, String(n));
  for (const n of [-2, 1.5, NaN, Infinity]) {
    assert.equal(facetLimitProblem(n), "Expected -1 or a non-negative integer.", String(n));
  }
});

test("intRangeProblem: a safe integer within [min, max], with the CLI's messages", async () => {
  const { intRangeProblem } = await import("../src/client/validate.js");
  const problem = intRangeProblem(0, 10);
  for (const n of [0, 5, 10]) assert.equal(problem(n), undefined, String(n));
  assert.equal(problem(-1), "Must be >= 0.");
  assert.equal(problem(11), "Must be <= 10.");
  for (const n of [1.5, NaN, Infinity]) assert.equal(problem(n), "Expected an integer from 0 to 10.", String(n));
});
