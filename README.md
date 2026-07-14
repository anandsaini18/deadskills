# 💀 deadskills

> Find the agent skills you never use.

Every installed skill's name + description is injected into **every prompt** you send. Skills you never invoke are pure context tax. `deadskills` parses your local agent transcripts and tells you which skills actually fire, how often, what they cost in tokens — and which ones are dead weight.

Works with **Claude Code** and **Codex** out of the box, auto-detected.

```
npx deadskills
```

**Zero runtime dependencies.** 100% local — your transcripts never leave your machine. No network calls, ever.

## What you get

```
💀 deadskills · claude-code · 42 sessions · 891 turns analyzed
Context tax: ~4,180 tokens added to every prompt by 31 installed skills

  pdf                    ████████████████████░░░░  57×  ~48,200 tok
  docx                   ████████░░░░░░░░░░░░░░░░  21×  ~19,900 tok
  commit-helper          ███░░░░░░░░░░░░░░░░░░░░░   8×   ~7,100 tok

💀 Dead skills (14) — installed, never invoked:
  legacy-formatter       personal · costs ~52 tok/prompt for nothing
  old-deploy-notes       project  · costs ~48 tok/prompt for nothing
  ...
```

## Usage

```bash
npx deadskills                 # full report, every detected agent
npx deadskills dead            # only the unused-skills list
npx deadskills doctor          # parse health — are your transcripts being read correctly?
npx deadskills --json          # canonical JSON reports (schema/report.schema.json)
npx deadskills --agent codex   # limit to one agent
```

## How it works

1. Discovers installed skills per agent (`~/.claude/skills`, `~/.codex/skills`, project `.claude`/`.codex`/`.agents` dirs, plugins) and parses `SKILL.md` frontmatter.
2. Parses session transcripts (`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl`) for skill invocations. Parsing is fail-soft and *accounted*: skipped lines are counted and surfaced, never silently dropped.
3. Attributes invocations to installed skills and estimates token cost: injection cost (name+description × every turn) plus expansion cost (SKILL.md body × invocations).

Token figures are estimates (~4 chars/token) and upper bounds (prompt caching makes re-reads cheaper) — directionally correct, which is all you need to delete 14 dead skills.

## Other agents

Cursor, OpenCode, and Gemini CLI support are welcome as PRs — an adapter is **one file** implementing a three-method interface, plus fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
make install   # npm install (dev deps only — runtime is zero-dep)
make check     # typecheck + tests
make run       # build + run against your own machine
make help      # all targets
```

## License

MIT. The [report schema](schema/report.schema.json) is CC0 — build on it freely.
