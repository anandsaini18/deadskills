import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createClaudeCodeAdapter,
  normalizeSkillName,
  parseLine,
  rawSkillName,
} from "../src/adapters/claude-code.js";
import { createCodexAdapter, parseCodexLine } from "../src/adapters/codex.js";
import { buildReport, parseSince } from "../src/analysis/report.js";
import { discoverSkills, parseSkillMd, type InstalledSkill } from "../src/discovery/skills.js";
import { parseArgs } from "../src/cli.js";
import { formatReport, formatWordmark, humanTokens } from "../src/output/format.js";

const fixturesRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(fixturesRoot, "..");
const builtCli = join(projectRoot, "dist", "cli.js");
const claudeFixtures = join(fixturesRoot, "fixtures", "claude");
const codexFixtures = join(fixturesRoot, "fixtures", "codex");

const claudeSkillRoots = [{ dir: join(claudeFixtures, "skills"), scope: "personal" }];
const codexSkillRoots = [{ dir: join(codexFixtures, "skills"), scope: "personal" }];

describe("claude-code adapter", () => {
  it("detects the fixture dir", () => {
    expect(createClaudeCodeAdapter(claudeFixtures).detect()).toBe(true);
  });

  it("parses events, records skipped garbage in health", async () => {
    const { events, health } = await createClaudeCodeAdapter(claudeFixtures).loadEvents();
    expect(events).toHaveLength(7); // session-1: 6 lines - 1 garbage; session-2: 2 lines
    expect(health.linesParsed).toBe(7);
    expect(health.linesSkipped).toBe(1);
    expect(health.skippedSamples[0]).toContain("not-json");
    expect(health.files).toBe(2);
  });

  it("extracts Skill tool_use invocations", () => {
    const ev = parseLine(
      JSON.stringify({
        type: "assistant",
        sessionId: "x",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Skill", input: { skill: "pdf" } }],
        },
      }),
      "proj",
      "x.jsonl"
    );
    expect(ev?.skillInvocation).toEqual({ name: "pdf", source: "auto" });
  });

  it("keeps namespaces raw in <command-name> invocations", () => {
    const ev = parseLine(
      JSON.stringify({
        type: "user",
        sessionId: "x",
        message: { role: "user", content: "<command-name>/my-plugin:pdf</command-name>" },
      }),
      "proj",
      "x.jsonl"
    );
    expect(ev?.skillInvocation).toEqual({ name: "my-plugin:pdf", source: "explicit" });
  });

  it("returns null for junk", () => {
    expect(parseLine("not json", "p", "f.jsonl")).toBeNull();
  });

  it("exposes claude skill roots", () => {
    const roots = createClaudeCodeAdapter(claudeFixtures).skillRoots("/tmp/proj");
    expect(roots.some((r) => r.dir === join(claudeFixtures, "skills"))).toBe(true);
    expect(roots.some((r) => r.dir.includes(join("/tmp/proj", ".claude", "skills")))).toBe(true);
  });
});

describe("codex adapter", () => {
  it("detects the fixture dir", () => {
    expect(createCodexAdapter(codexFixtures).detect()).toBe(true);
  });

  it("walks nested YYYY/MM/DD rollouts, tracks health", async () => {
    const { events, health } = await createCodexAdapter(codexFixtures).loadEvents();
    expect(health.files).toBe(1);
    expect(health.linesSkipped).toBe(1); // the garbage line
    expect(health.linesParsed).toBe(7);
    expect(events.filter((e) => e.role === "assistant")).toHaveLength(2);
  });

  it("detects skill via SKILL.md path in function_call arguments", async () => {
    const { events } = await createCodexAdapter(codexFixtures).loadEvents();
    const invocations = events.filter((e) => e.skillInvocation);
    expect(invocations.length).toBeGreaterThanOrEqual(1);
    expect(invocations.some((e) => e.skillInvocation!.name === "codex-used")).toBe(true);
  });

  it("detects $mention in user messages", () => {
    const parsed = parseCodexLine(
      JSON.stringify({
        timestamp: "t",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ text: "please $my-skill now" }] },
      }),
      "s1"
    );
    expect(parsed?.event?.skillInvocation).toEqual({ name: "my-skill", source: "explicit" });
  });

  it("captures project cwd from session_meta", () => {
    const parsed = parseCodexLine(
      JSON.stringify({ type: "session_meta", payload: { id: "x", cwd: "/repo" } }),
      "s1"
    );
    expect(parsed?.meta?.cwd).toBe("/repo");
  });

  it("returns null for junk", () => {
    expect(parseCodexLine("garbage", "s1")).toBeNull();
  });
});

describe("skill name handling", () => {
  it.each([
    ["pdf", "pdf"],
    ["/pdf", "pdf"],
    ["plugin:pdf", "pdf"],
    ["ns:sub:pdf", "pdf"],
    [" pdf ", "pdf"],
  ])("normalize %s → %s", (input, expected) => {
    expect(normalizeSkillName(input)).toBe(expected);
  });

  it("rawSkillName keeps namespace, strips slash", () => {
    expect(rawSkillName("/plugin:pdf")).toBe("plugin:pdf");
  });
});

describe("skill discovery", () => {
  it("finds skills under adapter-provided roots", () => {
    const claude = discoverSkills(claudeSkillRoots);
    expect(claude.map((s) => s.name).sort()).toEqual(["dead-skill", "used-skill", "zombie-skill"]);

    const codex = discoverSkills(codexSkillRoots);
    expect(codex.map((s) => s.name).sort()).toEqual(["codex-dead", "codex-used"]);
  });

  it("qualifies names when root has a namespace", () => {
    const skills = discoverSkills([
      { dir: join(claudeFixtures, "skills"), scope: "plugin", namespace: "my-plugin" },
    ]);
    expect(skills.find((s) => s.name === "used-skill")?.qualifiedName).toBe("my-plugin:used-skill");
  });

  it("estimates token costs", () => {
    for (const s of discoverSkills(claudeSkillRoots)) {
      expect(s.injectionTokens).toBeGreaterThan(0);
      expect(s.bodyTokens).toBeGreaterThan(s.injectionTokens);
    }
  });

  it("parseSkillMd returns null for missing file", () => {
    expect(parseSkillMd("/nope/SKILL.md", "personal")).toBeNull();
  });
});

describe("report", () => {
  it("claude: attributes usage, flags dead + zombie skills, carries health", async () => {
    const adapter = createClaudeCodeAdapter(claudeFixtures);
    const skills = discoverSkills(claudeSkillRoots);
    const { events, health } = await adapter.loadEvents();
    const report = buildReport(skills, events, adapter.name, health);

    expect(report.schemaVersion).toBe(1);
    expect(report.agent).toBe("claude-code");
    expect(report.windowSince).toBeNull();
    expect(report.sessions).toBe(2);
    expect(report.assistantTurns).toBe(4);
    expect(report.parseHealth).toEqual({ files: 2, linesParsed: 7, linesSkipped: 1 });

    const used = report.skills.find((s) => s.name === "used-skill")!;
    expect(used.invocations).toBe(2); // tool_use + namespaced command-name via fallback
    expect(used.explicitInvocations).toBe(1);
    expect(used.status).toBe("active");
    expect(used.lastUsed).toBe("2026-07-01T10:02:00Z");

    const zombie = report.skills.find((s) => s.name === "zombie-skill")!;
    expect(zombie.invocations).toBe(1);
    expect(zombie.status).toBe("zombie"); // fixture last use is >90 days old
    expect(zombie.dead).toBe(false);

    expect(report.deadSkills).toEqual(["dead-skill"]);
    expect(report.zombieSkills).toEqual(["zombie-skill"]);
    expect(report.contextTaxPerPrompt).toBeGreaterThan(0);
    expect(report.unmatchedInvocations).toEqual({});
    expect(report.ambiguousInvocations).toEqual({});
  });

  it("codex: attributes usage and flags dead skills", async () => {
    const adapter = createCodexAdapter(codexFixtures);
    const skills = discoverSkills(codexSkillRoots);
    const { events, health } = await adapter.loadEvents();
    const report = buildReport(skills, events, adapter.name, health);

    expect(report.agent).toBe("codex");
    const used = report.skills.find((s) => s.name === "codex-used")!;
    expect(used.invocations).toBeGreaterThanOrEqual(1);
    expect(used.status).not.toBe("dead");
    expect(report.deadSkills).toEqual(["codex-dead"]);
  });

  it("matches fully-qualified names before falling back", () => {
    const mk = (name: string, qualifiedName?: string): InstalledSkill => ({
      name,
      qualifiedName,
      description: "d",
      scope: "plugin",
      path: `/x/${qualifiedName ?? name}`,
      injectionTokens: 10,
      bodyTokens: 100,
    });
    const skills = [mk("dup", "plugin-a:dup"), mk("dup", "plugin-b:dup")];
    const events = [
      { sessionId: "s", timestamp: "2026-07-01T00:00:00Z", role: "user" as const, skillInvocation: { name: "plugin-a:dup", source: "explicit" as const } },
      { sessionId: "s", timestamp: "2026-07-01T00:01:00Z", role: "user" as const, skillInvocation: { name: "dup", source: "explicit" as const } },
    ];
    const report = buildReport(skills, events, "claude-code");

    // qualified invocation attributed to plugin-a only
    const a = report.skills.find((s) => s.qualifiedName === "plugin-a:dup")!;
    const b = report.skills.find((s) => s.qualifiedName === "plugin-b:dup")!;
    expect(a.invocations).toBe(1);
    expect(b.invocations).toBe(0);
    // bare "dup" is ambiguous → attributed to none, reported
    expect(report.ambiguousInvocations).toEqual({ dup: ["plugin-a:dup", "plugin-b:dup"] });
  });

  it("--since filters events out of the window", async () => {
    const adapter = createClaudeCodeAdapter(claudeFixtures);
    const skills = discoverSkills(claudeSkillRoots);
    const { events, health } = await adapter.loadEvents();
    // Window starting after all fixture activity: everything is dead
    const report = buildReport(skills, events, adapter.name, health, new Date("2026-08-01"));
    expect(report.windowSince).toBe("2026-08-01T00:00:00.000Z");
    expect(report.sessions).toBe(0);
    expect(report.deadSkills.sort()).toEqual(["dead-skill", "used-skill", "zombie-skill"]);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-07-14T00:00:00Z");
  it("parses relative windows", () => {
    expect(parseSince("30d", now)!.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    expect(parseSince("2w", now)!.toISOString()).toBe("2026-06-30T00:00:00.000Z");
    expect(parseSince("6m", now)!.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
  it("parses ISO dates", () => {
    expect(parseSince("2026-01-01")!.getUTCFullYear()).toBe(2026);
  });
  it("rejects junk", () => {
    expect(parseSince("yesterday-ish")).toBeNull();
  });
});

describe("cli arg parsing", () => {
  it("parses commands and flags", () => {
    expect(parseArgs(["dead", "--json"])).toMatchObject({ command: "dead", json: true });
    expect(parseArgs(["--agent", "codex", "--since", "30d"])).toMatchObject({
      agent: "codex",
      since: "30d",
    });
    expect(parseArgs(["doctor", "--claude-dir", "/x"])).toMatchObject({
      command: "doctor",
      claudeDir: "/x",
    });
    expect(parseArgs(["-h"])).toMatchObject({ help: true });
  });
});

describe("terminal wordmark", () => {
  it("renders the exact ANSI Shadow DEADSKILLS banner", () => {
    const expected = [
      "██████╗ ███████╗ █████╗ ██████╗ ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗",
      "██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝",
      "██║  ██║█████╗  ███████║██║  ██║███████╗█████╔╝ ██║██║     ██║     ███████╗",
      "██║  ██║██╔══╝  ██╔══██║██║  ██║╚════██║██╔═██╗ ██║██║     ██║     ╚════██║",
      "██████╔╝███████╗██║  ██║██████╔╝███████║██║  ██╗██║███████╗███████╗███████║",
      "╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝",
      "find the agent skills you never use",
    ].join("\n");

    expect(formatWordmark()).toBe(expected);
    expect(expected.split("\n").every((line) => line.length <= 80)).toBe(true);
  });
});

describe("report formatting", () => {
  it.each([
    [49, "49"],
    [999, "999"],
    [1500, "1.5K"],
    [24099, "24K"],
    [786845, "787K"],
    [999600, "1M"],
    [3525588, "3.5M"],
    [7958512, "8M"],
  ])("humanTokens %d → %s", (input, expected) => {
    expect(humanTokens(input)).toBe(expected);
  });

  it("renders a rule header, separators, humanized tokens, and tamed unmatched list", async () => {
    const adapter = createClaudeCodeAdapter(claudeFixtures);
    const skills = discoverSkills(claudeSkillRoots);
    const { events, health } = await adapter.loadEvents();
    const report = buildReport(skills, events, adapter.name, health);
    report.sessions = 1234;
    report.assistantTurns = 34296;
    report.skills.find((s) => s.status === "active")!.estimatedTotalTokens = 3525588;
    report.unmatchedInvocations = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`cmd-${i}`, i + 1])
    );

    const out = formatReport(report);
    // dim rule header instead of the old "deadskills · agent" line
    expect(out).toContain("── claude-code ─");
    expect(out).not.toContain("deadskills ·");
    // thousands separators
    expect(out).toContain("1,234 sessions · 34,296 turns analyzed");
    // humanized token column
    expect(out).toContain("~3.5M tok");
    expect(out).not.toContain("3525588");
    // unmatched: honest label, sorted descending, top 8, remainder summarized
    expect(out).toContain("Unmatched invocations (may include built-in commands):");
    expect(out).toContain("cmd-9 (10×), cmd-8 (9×)");
    expect(out).toContain("… and 2 more (run with --json for full list)");
    expect(out).not.toContain("cmd-1 (2×)");
  });
});

describe("built CLI output", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build", "--silent"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  });

  function runCli(...args: string[]): string {
    return execFileSync(
      process.execPath,
      [
        builtCli,
        ...args,
        "--claude-dir",
        claudeFixtures,
        "--codex-dir",
        join(fixturesRoot, "fixtures", "missing-codex"),
      ],
      { cwd: projectRoot, encoding: "utf8" }
    );
  }

  it.each([
    { label: "default", args: [] },
    { label: "dead", args: ["dead"] },
    { label: "doctor", args: ["doctor"] },
  ])(
    "prints the wordmark exactly once for $label invocation",
    ({ args }) => {
      const output = runCli(...args);
      expect(output.split(formatWordmark())).toHaveLength(2);
    }
  );

  it("keeps JSON output banner-free and machine-parseable", () => {
    const output = runCli("--json");
    expect(output).not.toContain(formatWordmark());
    expect(JSON.parse(output)).toMatchObject([{ agent: "claude-code" }]);
  });

  it("keeps help banner-free", () => {
    const output = execFileSync(process.execPath, [builtCli, "--help"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    expect(output).toContain("Usage");
    expect(output).not.toContain(formatWordmark());
  });
});
