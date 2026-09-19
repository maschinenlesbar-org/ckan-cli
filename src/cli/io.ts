// I/O seam for the CLI. Everything the CLI writes goes through a CliIO object so
// tests can capture output instead of hitting the real stdout/stderr, and the
// environment is injected so tests never depend on the real process.env.

import type { CkanClient } from "../client/client.js";
import type { EngineOptions } from "../client/engine.js";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  io: CliIO;
  /** Environment variables (injectable for tests). */
  env: Record<string, string | undefined>;
  /** Build a client from the resolved global options (injectable for tests). */
  createClient(options: EngineOptions): CkanClient;
}

export const defaultIO: CliIO = {
  out: (text) => process.stdout.write(text + "\n"),
  err: (text) => process.stderr.write(text + "\n"),
};
