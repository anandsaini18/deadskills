```
██████╗ ███████╗ █████╗ ██████╗ ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗
██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝
██║  ██║█████╗  ███████║██║  ██║███████╗█████╔╝ ██║██║     ██║     ███████╗
██║  ██║██╔══╝  ██╔══██║██║  ██║╚════██║██╔═██╗ ██║██║     ██║     ╚════██║
██████╔╝███████╗██║  ██║██████╔╝███████║██║  ██╗██║███████╗███████╗███████║
╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝
               💀 find the agent skills you never use
```

> Unused agent skills waste context on **every prompt**. `deadskills` reads your local transcripts and shows which skills earn their seat — and which are dead weight you can delete.

[![npm version](https://img.shields.io/npm/v/deadskills.svg?style=flat-square)](https://www.npmjs.com/package/deadskills)
[![npm downloads](https://img.shields.io/npm/dw/deadskills.svg?style=flat-square)](https://www.npmjs.com/package/deadskills)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg?style=flat-square)](https://nodejs.org)

## Quick start

```bash
npx deadskills
```

That's it. No config, no login, no telemetry. Auto-detects **Claude Code** and **Codex**, reads your transcripts locally, prints the report.

Example output:

```
── claude-code ─────────────────────────────────────────────
107 sessions · 34,296 turns analyzed
Context tax: ~587 tokens added to every prompt by 6 installed skills

  swiftui-expert-skill           ████████████████████████    9×   ~3.5M tok
  tech-android                   ████████████████░░░░░░░░    6×   ~793K tok
  ui-ux-pro-max                  ████████████████░░░░░░░░    6×     ~8M tok
  playstore-requirements         █████████████░░░░░░░░░░░    5×   ~4.3M tok
  mobile-ios-design              ████████░░░░░░░░░░░░░░░░    3×   ~1.9M tok

💀 Dead skills (1) — installed, never invoked:
  xcode-project-setup            personal · costs ~49 tok/prompt for nothing


── codex ───────────────────────────────────────────────────
7 sessions · 138 turns analyzed
Context tax: ~476 tokens added to every prompt by 5 installed skills

  android-development            ████████████████████████    5×    ~24K tok

🧟 Zombie skills (2) — used before, silent for 90+ days:
  figma                          last used 2026-04-12 · 4× all-time
  imagegen                       last used 2026-04-12 · 2× all-time

💀 Dead skills (2) — installed, never invoked:
  playstore-requirements         personal · costs ~126 tok/prompt for nothing
  tech-android                   personal · costs ~23 tok/prompt for nothing
```

## Skill states

| State | Meaning |
|-------|---------|
| active | Invoked at least once — earning its context seat |
| 🧟 zombie | Invoked before, silent for 90+ days |
| 💀 dead | Installed, never invoked |

## Commands

```bash
npx deadskills                # full report for all detected agents
npx deadskills dead           # list dead skills only
npx deadskills doctor         # verify your transcripts are being read correctly
npx deadskills --since 30d    # limit to a time window (30d, 8w, 6m, or a date)
npx deadskills --json         # canonical JSON output (see schema/report.schema.json)
npx deadskills --agent codex  # one agent only
```

## Install

```bash
npx deadskills               # one-off run, always latest — recommended
npm install -g deadskills    # global install: run `deadskills` anywhere
```

Requires Node 18+. Zero runtime dependencies — the whole tool is one ~22 KB file.

## How it works

1. Discovers installed skills per agent (`~/.claude/skills`, `.claude/skills`, plugin dirs) and reads `SKILL.md` frontmatter for name, description, and token cost.
2. Parses session transcripts — JSONL files in `~/.claude/projects` and `~/.codex/sessions`. Skipped lines are counted and surfaced via `doctor`, never silently dropped.
3. Reports per-skill invocation counts and token cost (injection cost × turns, plus expansion cost × invocations), then flags dead and zombie skills.

Token figures are estimates (~4 chars/token) — directionally right, and real cost is usually lower thanks to prompt caching. Close enough to decide which skills to delete.

**Zero runtime dependencies.** Your transcripts never leave your machine. No network calls, ever.

## Supported agents

| Agent | Status |
|-------|--------|
| Claude Code | built-in |
| Codex | built-in |
| Cursor | [contribute an adapter](CONTRIBUTING.md) |
| Gemini CLI | [contribute an adapter](CONTRIBUTING.md) |
| OpenCode | [contribute an adapter](CONTRIBUTING.md) |

## Development

```bash
git clone https://github.com/anandsaini18/deadskills
cd deadskills
make install     # install dev deps
make check       # typecheck + tests
make run         # build and run against your own ~/.claude
make help        # all targets
```

## Contributing

An adapter is one TypeScript file implementing a three-method interface, plus hand-written fixtures. Run `make check` to verify, then open a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. The [report schema](schema/report.schema.json) is CC0 — build on it freely.
