# deadskills — Agent Skill Usage Analytics

> Which of your installed skills actually earn their context budget?

A local-first CLI that parses AI coding agent session transcripts and reports per-skill usage: what triggered, how often, what it cost in tokens, and which skills are dead weight.

---

## 1. Problem & Demand Evidence

Every installed skill's name + description is injected into every prompt. Users install dozens of skills from marketplaces and have **zero visibility** into:

- Which skills ever trigger (unused skills = pure context tax on every message)
- How often each skill fires, and on what kinds of prompts
- Token cost per skill (injection cost + expanded SKILL.md cost when invoked)
- Mis-triggers (wrong skill fired for a task)

**Demand evidence (verified 2026-07-14):**

- Open feature request on anthropics/claude-code: [#35319 — Skill invocation tracking and usage analytics](https://github.com/anthropics/claude-code/issues/35319). Explicitly asks for unused-skill detection, adoption measurement, context-budget justification. Unfilled.
- GitHub trending is dominated by the skills ecosystem: `agentskills/agentskills` (spec), `obra/superpowers` (245k★), `JuliusBrussee/caveman` (token efficiency, 2.8k★/day), `safishamsi/graphify` (77k★).
- Adjacent niches are saturated (skill linters: 6+ projects; skill security scanners: 3+; session token dashboards: 3+). **Per-skill analytics has no direct competitor.**

Competitive moat: linters analyze skills *statically*; token dashboards analyze sessions *without skill attribution*. We join the two: transcripts × installed skills.

## 2. Name: `deadskills`

Availability verified 2026-07-14:

| Name | npm | GitHub | Verdict |
|---|---|---|---|
| `deadskills` | ✅ free | ✅ only unrelated Unity game | **Chosen** |
| `skillprune` | ✅ free | ✅ clear | Runner-up |
| `contexttax` | free | ❌ similar tool exists (PavelTkachenk0/ContextTax, MCP token cost) | Dropped |
| `skillmeter` | free | ⚠️ skillmeter.com is an existing SaaS brand | Dropped |
| `skillscope` | — | overused | Dropped |

Why `deadskills`: one word, easy to type, zero collisions → ranks #1 on publish. The name IS the shareable headline ("💀 you have 14 dead skills"). SEO terms ("claude code skill usage", "unused skills", "agent skill analytics") go in the repo description + topics, which GitHub search indexes.

## 3. Tech Stack

Originally modeled on prompts.chat's CLI package (Ink + meow), then **rewritten to zero runtime dependencies** after design review ("a context-bloat auditor with a dependency tree is a punchline"):

- **Language:** TypeScript 5, Node ≥ 18, ESM-only
- **Output:** hand-rolled ANSI (`src/output/format.ts`) — no UI framework
- **Args:** hand-parsed (`src/cli.ts`)
- **Build:** tsup → single ~18 KB ESM file, bin entry for npx
- **Tests:** Vitest, fixture transcripts in `tests/fixtures/{claude,codex}`
- **Zero runtime deps, period.** No network calls, ever. 100% local — headline features (transcripts contain private code; npx cold-start is instant; no supply chain to trust).

Explicitly deferred: website, database, hosted anything. prompts.chat ran 2+ years as static files before building its Next.js app.

## 4. Architecture

```
deadskills/
├── src/
│   ├── cli.tsx              # Ink entry point, command routing
│   ├── adapters/            # ← contribution surface: one file per agent
│   │   ├── types.ts         # Adapter interface (canonical event model)
│   │   ├── claude-code.ts   # v1: parse ~/.claude/projects/**/*.jsonl
│   │   ├── codex.ts         # community PR
│   │   └── cursor.ts        # community PR
│   ├── discovery/
│   │   └── skills.ts        # enumerate installed skills:
│   │                        #   ~/.claude/skills/, .claude/skills/,
│   │                        #   plugin dirs; parse SKILL.md frontmatter
│   ├── analysis/
│   │   ├── attribute.ts     # match transcript events → skill invocations
│   │   ├── tokens.ts        # est. injection cost (name+desc × messages)
│   │   │                    #   + expansion cost (SKILL.md tokens × fires)
│   │   └── report.ts        # aggregate: fires, last-used, cost, dead list
│   ├── output/
│   │   ├── tui.tsx          # pretty terminal report (the screenshot)
│   │   ├── json.ts          # canonical report schema (CC0)
│   │   └── csv.ts
│   └── mcp/
│       └── server.ts        # `deadskills mcp` — agents query their own stats
├── schema/report.schema.json  # versioned, CC0 — the "prompts.csv" of this project
├── plugins/claude/            # Claude Code plugin wrapper + skill
├── AGENTS.md / CLAUDE.md      # repo legible to coding agents
├── CONTRIBUTING.md            # "add an adapter in one file" template
└── README.md
```

### Canonical event model (adapter contract)

Each adapter converts a native transcript format into:

```ts
interface SessionEvent {
  sessionId: string;
  timestamp: string;
  role: "user" | "assistant" | "tool";
  skillInvocation?: { name: string; source: "auto" | "explicit" };
  tokens?: { input: number; output: number; cacheRead?: number };
  project?: string;
}
```

The **JSON report schema is the strategic asset** (prompts.chat lesson: the CSV was the moat). Version it, document it, license it CC0 so other tools build on it.

### Attribution approach (v1, Claude Code)

1. Enumerate installed skills → name, description, SKILL.md token count.
2. Scan transcript JSONL for skill invocation markers (Skill tool calls, `<command-name>` expansions, plugin-namespaced names).
3. Injection cost = tokens(name + description) × total assistant turns (they ride every prompt).
4. Expansion cost = tokens(SKILL.md body) × invocation count.
5. Dead skill = installed, ≥ N sessions observed, zero invocations.

⚠️ **First implementation task: validate assumptions against real transcripts** (`~/.claude/projects/`). Transcript format is undocumented and changes between Claude Code versions — pin what we parse, fail soft, and treat format drift as an ongoing maintenance reality. Adapter tests run against committed fixture files.

## 5. Commands (v1)

```
npx deadskills              # default: full report, pretty TUI
npx deadskills --json       # canonical report to stdout
npx deadskills dead         # just the unused-skills list
npx deadskills skill <name> # drill into one skill: when/where it fired
npx deadskills mcp          # run as MCP server
```

## 6. Roadmap

**v0.1 (weekend):** Claude Code adapter, skill discovery, dead-skill detection, TUI + JSON output.
**v0.2:** Token cost attribution, `skill <name>` drill-down, CSV export.
**v0.3:** MCP server mode, Claude Code plugin, report schema v1 frozen.
**v0.4 (community):** Codex/Cursor/OpenCode adapters via PRs; trigger-overlap detector (idea #2 — pairwise description similarity warning: "these two skills compete").
**Later, only if traction:** hosted trend dashboards, team aggregation (the B2B angle in issue #35319 — orgs measuring skill adoption).

## 7. Launch Playbook (prompts.chat lessons applied)

1. **`npx deadskills` is the entire pitch** — first line of README, zero config, auto-discovers transcripts.
2. **Engineer the shareable artifact:** the TUI report must be screenshot-worthy (usage bars, "💀 dead skills" section, "context tax: 4.2k tokens/message" headline number). The screenshot is the growth loop.
3. **README structure:** hero tagline → animated GIF of the TUI → quick-start → "how it works" → adapter contribution invite → license. Badges for npm, CI, schema version.
4. **Be agent-native on day one:** MCP mode + plugin + AGENTS.md (they retrofitted; we launch with it). A skill that analyzes skills, installable as a skill, is inherently viral in this audience.
5. **Contribution friction near zero:** new adapter = one file + one fixture, PR template provided. Contributors visible via contrib.rocks graph.
6. **Endorsement targets:** Anthropic DevRel, authors of superpowers/caveman/agentskills (cross-promo: "check your superpowers usage with deadskills"), the #35319 issue thread itself (announce there — pre-qualified audience).
7. **Licensing:** MIT code, CC0 `schema/report.schema.json`.
8. **Privacy as a feature:** "Your transcripts never leave your machine" in the hero. This audience is paranoid (rightly — see Snyk's ToxicSkills research).
9. **Monetize never, or late:** sponsors block only after traction.

## 8. Risks

- **Anthropic ships it natively** (#35319 gets built). Mitigation: multi-agent adapters make us the cross-agent standard; native telemetry likely won't cover Cursor/Codex.
- **Transcript format churn.** Mitigation: adapter isolation, fixture tests, fail-soft parsing, quick-release cadence.
- **Token estimates are approximations** (no tokenizer parity). Mitigation: label as estimates; directionally correct is enough for "delete these 12 dead skills."
