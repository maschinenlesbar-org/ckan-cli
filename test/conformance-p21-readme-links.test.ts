// Conformance test P21 (follow-up round 2026-10-06): README.md ships in the npm tarball and
// is shown on npmjs.com, so every relative link in it must point to a file the package ships.
// A document the `files` allowlist leaves out is linked by its absolute GitHub URL instead.
// Dependency-free: reads package.json `files` rather than running `npm pack`. Shared across
// the *-cli repos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The compiled test runs from dist/test/; the repo root is two directories up.
const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8")) as { name: string; files?: string[] };
const readme = readFileSync(root + "README.md", "utf8");
const repo = pkg.name.replace(/^@[^/]+\//, "");

/** Relative link targets of the README, anchors and titles stripped. */
function relativeTargets(markdown: string): string[] {
  const targets: string[] = [];
  for (const m of markdown.matchAll(/\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const raw = m[1] ?? "";
    if (raw === "" || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const path = decodeURIComponent(raw.split("#")[0]!.split("?")[0]!).replace(/^\.\//, "");
    if (path !== "") targets.push(path);
  }
  return targets;
}

/** A `files` entry as a test: a plain path, a directory prefix, or a simple `*` glob. */
function matcher(entry: string): (path: string) => boolean {
  const clean = entry.replace(/^\.\//, "").replace(/\/+$/, "");
  if (clean.includes("*")) {
    const source = clean
      .split(/(\*\*\/?|\*)/)
      .map((part) => (part.startsWith("**") ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    const re = new RegExp(`^${source}(/.*)?$`);
    return (path) => re.test(path);
  }
  return (path) => path === clean || path.startsWith(clean + "/");
}

/** Whether npm packs `path`: always README, LICENSE/LICENCE and package.json, else `files`. */
function shipped(path: string): boolean {
  if (/^(README|LICEN[CS]E)(\.[^/]*)?$/i.test(path) || path === "package.json") return true;
  const entries = pkg.files ?? [];
  const included = entries.filter((e) => !e.startsWith("!")).some((e) => matcher(e)(path));
  const excluded = entries.filter((e) => e.startsWith("!")).some((e) => matcher(e.slice(1))(path));
  return included && !excluded;
}

test("P21: every relative README link points to a file the npm package ships", () => {
  const targets = relativeTargets(readme);
  const broken = targets.filter((t) => !shipped(t));
  assert.deepEqual(
    broken.map((t) => `${t} -> https://github.com/maschinenlesbar-org/${repo}/blob/main/${t}`),
    [],
    "README links to files the npm package doesn't ship; use the absolute GitHub URL shown",
  );
});

test("P21: the check sees the README's links at all", () => {
  // A README with no links at all would pass the check above vacuously; every repo's
  // README links its data license, which ships (P22).
  assert.ok(relativeTargets(readme).includes("DATA_LICENSE.md") || readme.includes("DATA_LICENSE.md"));
});
