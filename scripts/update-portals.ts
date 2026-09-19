// Refresh the built-in portal list, src/client/portals-list.ts.
//
// Collects candidate CKAN portals in Germany from three upstream lists — Wikidata,
// the CKAN project's instance registry (ckan/ckan-instances) and GovData's harvest
// sources — checks every candidate and every entry already in the list live (see
// `checkPortal`: a search must answer with a CKAN envelope), and rewrites the list.
// Entries already in the list are never dropped: a failing check marks them
// `working: false`. A new candidate is added only when its check passes. The pure
// logic lives in portal-sources.ts; this file only does the I/O.
//
//   npm run update-portals                    # build, check, rewrite the list
//   npm run update-portals -- --dry-run       # check and report only
//
// Options: --dry-run, --concurrency <n> (default 6), --timeout <ms> (default 15000),
// --no-discover (only re-check the entries already in the list).

import { readFileSync, writeFileSync } from "node:fs";
import { CkanClient, RequestEngine, checkPortal, mapLimit, portalKey } from "../src/index.js";
import type { PortalCheck } from "../src/index.js";
import {
  HARVEST_QUERY,
  WIKIDATA_QUERY,
  ckanInstancesCandidates,
  harvestCandidates,
  mergePortals,
  readPortalsSource,
  renderPortalsSource,
  wikidataCandidates,
  type Candidate,
} from "./portal-sources.js";

/** From dist/scripts/ back to the source file. */
const LIST_FILE = new URL("../../src/client/portals-list.ts", import.meta.url);
const USER_AGENT = "ckan-cli update-portals (https://github.com/maschinenlesbar-org/ckan-cli)";
/** Pause before a failed portal is checked a second time. */
const RETRY_DELAY_MS = 3000;

const USAGE = "Usage: update-portals [--dry-run] [--no-discover] [--concurrency n] [--timeout ms]";

function usageError(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

// Strict parsing: a mistyped flag (`--dryrun`) must not be dropped silently and
// rewrite the list.
const options = { dryRun: false, discover: true, concurrency: 6, timeoutMs: 15_000 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const token = argv[i]!;
  const eq = token.indexOf("=");
  const name = eq === -1 ? token : token.slice(0, eq);
  const value = (): number => {
    const raw = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (raw === undefined || !/^\d+$/.test(raw)) usageError(`${name} needs a number.`);
    return Number(raw);
  };
  if (name === "--dry-run" && eq === -1) options.dryRun = true;
  else if (name === "--no-discover" && eq === -1) options.discover = false;
  else if (name === "--concurrency") options.concurrency = value();
  else if (name === "--timeout") options.timeoutMs = value();
  else usageError(`Unknown option "${token}".`);
}
if (options.concurrency < 1) usageError("--concurrency takes a number >= 1.");
if (options.timeoutMs < 1000) usageError("--timeout takes a number of milliseconds >= 1000.");

const engineOptions = { timeoutMs: options.timeoutMs, userAgent: USER_AGENT, maxRetries: 1 };
const log = (line: string): void => void process.stderr.write(`${line}\n`);

/**
 * One upstream list, tried twice (Wikidata's query service answers 502 now and
 * then); a second failure is reported and yields no candidates.
 */
async function fromSource(name: string, load: () => Promise<Candidate[]>): Promise<Candidate[]> {
  try {
    const candidates = await load().catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return load();
    });
    log(`${name}: ${candidates.length} candidate URLs`);
    return candidates;
  } catch (err) {
    log(`${name}: FAILED (${err instanceof Error ? err.message : String(err)}); skipped`);
    return [];
  }
}

/** A check, repeated once after a pause if it fails, so one timeout does not count as down. */
async function check(url: string): Promise<PortalCheck> {
  const client = new CkanClient({ ...engineOptions, baseUrl: url });
  const first = await checkPortal(client);
  if (first.working) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return checkPortal(client);
}

const source = readFileSync(LIST_FILE, "utf8");
const existing = readPortalsSource(source); // throws on a hand edit it cannot read: nothing is written
const today = new Date().toISOString().slice(0, 10);

const candidates: Candidate[] = [];
if (options.discover) {
  const lists = await Promise.all([
    fromSource("Wikidata", async () =>
      wikidataCandidates(
        await new RequestEngine({ ...engineOptions, baseUrl: "https://query.wikidata.org" }).getJson("/sparql", {
          query: WIKIDATA_QUERY,
          format: "json",
        }),
      ),
    ),
    fromSource("ckan-instances", async () =>
      ckanInstancesCandidates(
        await new RequestEngine({ ...engineOptions, baseUrl: "https://raw.githubusercontent.com" }).getJson(
          "/ckan/ckan-instances/gh-pages/config/instances.json",
        ),
      ),
    ),
    fromSource("GovData harvest sources", async () =>
      harvestCandidates(
        await new CkanClient({ ...engineOptions, baseUrl: "https://ckan.govdata.de" }).action("package_search", {
          ...HARVEST_QUERY,
        }),
      ),
    ),
  ]);
  candidates.push(...lists.flat());
}

const known = new Set(existing.map((p) => portalKey(p.url)));
const toCheck = [...new Map(candidates.map((c) => [portalKey(c.url), c.url])).entries()].filter(
  ([key]) => !known.has(key),
);
log(`checking ${existing.length} listed portals and ${toCheck.length} new candidates …`);

const existingChecks = await mapLimit(existing, options.concurrency, (p) => check(p.url));
const candidateChecks = new Map(
  await mapLimit(toCheck, options.concurrency, async ([key, url]) => [key, await check(url)] as const),
);

const { portals, added, rejected } = mergePortals({ existing, existingChecks, candidates, candidateChecks, today });

for (const p of portals.filter((p) => !p.working)) log(`  listed, but not working: ${p.id} (${p.url}): ${p.problem}`);
for (const p of added) log(`  added: ${p.id} — ${p.title} (${p.url}), ${p.datasets} datasets`);
log(`  ${rejected.length} candidate URLs are not a working CKAN (${summarize(rejected.map((r) => r.problem))})`);
log(`${portals.length} portals, ${portals.filter((p) => p.working).length} working, ${added.length} new`);

if (options.dryRun) {
  log("dry run: the list was not written");
} else {
  writeFileSync(LIST_FILE, renderPortalsSource(source, portals));
  log(`wrote ${LIST_FILE.pathname}`);
}

/** "12× HTTP 404, 3× host not found". */
function summarize(problems: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p ?? "unknown", (counts.get(p ?? "unknown") ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n}× ${p}`).join(", ") || "none";
}
