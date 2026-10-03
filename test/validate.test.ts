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
