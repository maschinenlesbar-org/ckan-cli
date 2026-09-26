# ckan-cli — Claude Code Skills

A set of [Claude Code](https://code.claude.com/docs/en/skills) **Agent Skills** for German
CKAN open-data portals, all powered by the **[ckan](README.md)** CLI over the open CKAN
Action API: the Hamburg Transparenzportal by default, and the other known portals —
GovData, Berlin, Open.NRW, Schleswig-Holstein, München and more — by name.

Each skill teaches Claude how to drive the `ckan` CLI to answer a specific, real-world
question — "which portals have open data on Radverkehr?", "which publishers have the most
datasets in Berlin?", "which contracts did Hamburg publish this month?" — and to report the
answer with evidence rather than guesswork. They encode the parts that are easy to get
wrong (format and licence values spelled differently on every portal, facet lists cut off at
50, date fields that can't be range-filtered, Hamburg's document-type values that only match
in their stemmed form) so Claude doesn't have to rediscover them each time.

## Skills

| Skill | What it does | Ask it… |
|---|---|---|
| **ckan-dataset-finder** | Finds which portals have data on a topic, then searches one, ranks and dedupes the hits, and gives each with publisher, formats, licence and links. | "which German portals have open data on Radverkehr?", "CSV data about Baumkataster in Berlin", "newest datasets on Luftqualität in NRW" |
| **ckan-catalogue-stats** | Builds counts and rankings from CKAN facets — publishers, formats, licences, themes, counts per year — and compares portals, folding the per-portal spellings into a clean breakdown. | "which publishers have the most datasets in Berlin?", "what file formats dominate Open.NRW?", "compare the German portals by size" |
| **ckan-hamburg-transparency** | Searches the Hamburg Transparenzportal's official documents — contracts, Gutachten, Senate papers, decisions, regulations — by type, topic and date, with PDFs and attribution text. | "which contracts did Hamburg publish this month?", "Gutachten zum Radverkehr in Hamburg", "latest Senatsmitteilungen about Wohnungsbau" |

## Requirements

- **[Claude Code](https://code.claude.com/docs/en/overview)** (or any harness that loads
  Agent Skills).
- **The `ckan` CLI** installed globally:
  ```bash
  npm i -g @maschinenlesbar.org/ckan-cli   # installs the `ckan` bin
  ```
  No API key is required — the portals' CKAN APIs are free, open, and read-only.

The CKAN server software installs an admin command that is also called `ckan`. If it
comes first on your `PATH`, the skills notice (its `--help` differs) and tell you instead
of running it.

## Installation

### Plugin marketplace (recommended)

The skills are published as the `ckan` plugin in the
[maschinenlesbar.org plugin marketplace](https://github.com/maschinenlesbar-org/plugins),
which lists the plugins for all maschinenlesbar.org CLIs. Installation is two commands
inside Claude Code:

```
/plugin marketplace add maschinenlesbar-org/plugins
/plugin install ckan@maschinenlesbar
```

The first command registers the marketplace (once, for all maschinenlesbar.org
plugins); the second installs the `ckan` plugin, which bundles all three skills.
Update later with `/plugin marketplace update maschinenlesbar`.

### Manual (copy the skill folders)

Prefer not to use the marketplace? Copy the skills into your **personal** directory
(available across all your projects):

```bash
git clone https://github.com/maschinenlesbar-org/ckan-cli tmp-skills
mkdir -p ~/.claude/skills
cp -R tmp-skills/skills/* ~/.claude/skills/
rm -rf tmp-skills
```

…or into a single project's `.claude/skills/` by swapping `~/.claude/skills` for
`.claude/skills`. Each skill lives in its own directory with a `SKILL.md`, e.g.
`skills/ckan-dataset-finder/SKILL.md`. Start a new Claude Code session and the skills
are picked up automatically.

## Usage

You don't normally invoke these by name — Claude auto-selects the right skill from your
request. Just ask in natural language:

> Which German open-data portals have data on Radverkehr?

> Which publishers have the most datasets on the Berlin portal, and in which formats?

> Show me the contracts of public interest Hamburg published this month.

You can also invoke a skill explicitly with its slash command, e.g. `/ckan-dataset-finder`.

## How it works

Every skill is a single `SKILL.md` — a short, model-facing playbook describing which
`ckan` subcommands to call, in what order, and how to interpret the JSON. The skills
encode the non-obvious parts of these portals, for example:

- **every portal spells formats and licences differently** — `pdf` vs `PDF` vs an EU
  vocabulary URI, `dl-de-by-2.0` vs `dl-by-de/2.0` vs a DCAT-AP URI — and Berlin's format
  filter is case-sensitive, so a naive `--fq res_format:CSV` misses matches; the skills look
  up the spellings with a facet first (see **ckan-dataset-finder**, **ckan-catalogue-stats**);
- **the package licence is empty on GovData and daten.bw** — the licence is on the
  resources there;
- **facets stop at 50 values** unless `--facet-limit -1` is given, come back unsorted, and
  count datasets, not files (see **ckan-catalogue-stats**);
- **GovData harvests the Länder portals**, so its counts overlap theirs and are never
  added to them;
- **Hamburg's document types match only in their stemmed form** — `vertrageoffinteress`,
  not Hamburg's documented `vertraege_oeff_interesse` (0 results) — and the example on
  Hamburg's own API page over-counts; many Hamburg records have no organization, and the
  `publishing_date` field can't be range-filtered (see **ckan-hamburg-transparency**);
- an empty search is `{"count":0,…}` at exit `0` (a valid "nothing matched"), exit `4` is an
  HTTP 404 (a not-found id, or no CKAN at this URL), exit `1` is a real error with a
  readable reason.

Real runs of each skill are in [EXAMPLE.md](EXAMPLE.md).

## Contributing

This project does not accept external code contributions (see
[CONTRIBUTING.md](CONTRIBUTING.md)). When adding a skill internally, keep `SKILL.md`
focused, give it a `description` with concrete trigger phrases, and follow the
[official skill format](https://code.claude.com/docs/en/skills).

## License

[AGPL-3.0-or-later](LICENSE) © Sebastian Schürmann. See [LICENSING.md](LICENSING.md) for
the dual-licensing / commercial option.
