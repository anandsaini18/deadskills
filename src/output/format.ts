import type { Report } from "../analysis/report.js";

/**
 * Plain ANSI terminal output. Zero dependencies on purpose:
 * a tool that audits context bloat should not ship a UI framework.
 */

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

const BAR_WIDTH = 24;
const RULE_WIDTH = 60;
const UNMATCHED_SHOWN = 8;

/** 34296 → "34,296". */
function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Humanize token counts: 3525588 → "3.5M", 24099 → "24K". Exported for tests. */
export function humanTokens(n: number): string {
  const fmt = (v: number) => String(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
  if (n >= 999_500) return `${fmt(n / 1_000_000)}M`;
  if (n >= 1_000) return `${fmt(n / 1_000)}K`;
  return String(n);
}

/** Dim horizontal rule carrying the agent name — the per-agent section header. */
function agentRule(agent: string): string {
  const fill = Math.max(3, RULE_WIDTH - agent.length - 4);
  return c.dim("── ") + c.bold(agent) + " " + c.dim("─".repeat(fill));
}

// figlet "ANSI Shadow", pre-rendered: zero runtime deps is a hard rule.
// Split in two so "DEAD" and "SKILLS" can be colored independently.
const WORDMARK_DEAD = [
  "██████╗ ███████╗ █████╗ ██████╗ ",
  "██╔══██╗██╔════╝██╔══██╗██╔══██╗",
  "██║  ██║█████╗  ███████║██║  ██║",
  "██║  ██║██╔══╝  ██╔══██║██║  ██║",
  "██████╔╝███████╗██║  ██║██████╔╝",
  "╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ",
];

const WORDMARK_SKILLS = [
  "███████╗██╗  ██╗██╗██╗     ██╗     ███████╗",
  "██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝",
  "███████╗█████╔╝ ██║██║     ██║     ███████╗",
  "╚════██║██╔═██╗ ██║██║     ██║     ╚════██║",
  "███████║██║  ██╗██║███████╗███████╗███████║",
  "╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝",
];

export function formatWordmark(): string {
  const rows = WORDMARK_DEAD.map(
    (left, i) => c.bold(c.red(left)) + c.bold(c.cyan(WORDMARK_SKILLS[i]))
  );
  rows.push(c.dim("find the agent skills you never use"));
  return rows.join("\n");
}

function bar(value: number, max: number): string {
  const filled = max > 0 ? Math.round((value / max) * BAR_WIDTH) : 0;
  return c.green("█".repeat(filled)) + c.dim("░".repeat(BAR_WIDTH - filled));
}

function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width - 1) + "…" : s.padEnd(width);
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  const active = report.skills.filter((s) => s.status === "active");
  const zombies = report.skills.filter((s) => s.status === "zombie");
  const dead = report.skills.filter((s) => s.status === "dead");
  const max = Math.max(...report.skills.map((s) => s.invocations), 1);
  const window = report.windowSince
    ? ` · since ${report.windowSince.slice(0, 10)}`
    : "";

  lines.push("");
  lines.push(agentRule(report.agent));
  lines.push(
    c.dim(`${formatInt(report.sessions)} sessions · ${formatInt(report.assistantTurns)} turns analyzed${window}`)
  );
  lines.push(
    `Context tax: ${c.bold(c.yellow(`~${formatInt(report.contextTaxPerPrompt)} tokens`))}` +
      c.dim(` added to every prompt by ${report.skills.length} installed skills`)
  );
  lines.push("");

  for (const s of active) {
    lines.push(
      `  ${c.cyan(pad(s.name, 30))} ${bar(s.invocations, max)} ${String(s.invocations).padStart(4)}×` +
        c.dim(` ${`~${humanTokens(s.estimatedTotalTokens)}`.padStart(7)} tok`)
    );
  }

  if (zombies.length > 0) {
    lines.push("");
    lines.push(c.bold(c.yellow(`Zombie skills (${zombies.length}): used before, silent for 90+ days`)));
    for (const s of zombies) {
      lines.push(
        `  ${c.yellow(pad(s.name, 30))} ${c.dim(`last used ${s.lastUsed?.slice(0, 10) ?? "?"} · ${formatInt(s.invocations)}× all-time`)}`
      );
    }
  }

  if (dead.length > 0) {
    lines.push("");
    lines.push(c.bold(c.red(`Dead skills (${dead.length}): installed, never invoked`)));
    for (const s of dead) {
      lines.push(
        `  ${c.red(pad(s.name, 30))} ${c.dim(`${s.scope} · costs ~${humanTokens(s.injectionTokens)} tok/prompt for nothing`)}`
      );
    }
  }

  const unmatched = Object.entries(report.unmatchedInvocations).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  if (unmatched.length > 0) {
    lines.push("");
    lines.push(c.dim("Unmatched invocations (may include built-in commands):"));
    const shown = unmatched.slice(0, UNMATCHED_SHOWN);
    lines.push(c.dim(`  ${shown.map(([n, ct]) => `${n} (${ct}×)`).join(", ")}`));
    const hidden = unmatched.length - shown.length;
    if (hidden > 0) {
      lines.push(c.dim(`  … and ${hidden} more (run with --json for full list)`));
    }
  }

  const ambiguous = Object.entries(report.ambiguousInvocations);
  if (ambiguous.length > 0) {
    lines.push("");
    lines.push(
      c.yellow(
        `Ambiguous invocations (not attributed): ${ambiguous
          .map(([n, cands]) => `${n} → {${cands.join(", ")}}`)
          .join("; ")}`
      )
    );
  }

  const { linesParsed, linesSkipped } = report.parseHealth;
  const total = linesParsed + linesSkipped;
  if (total > 0 && linesSkipped / total > 0.05) {
    lines.push("");
    lines.push(
      c.yellow(
        `Parsed ${Math.round((linesParsed / total) * 100)}% of transcript lines. ` +
          `Numbers may undercount. Run \`deadskills doctor\`.`
      )
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function formatDead(report: Report): string {
  if (report.deadSkills.length === 0) {
    return `\n${agentRule(report.agent)}\nNo dead skills. Everything installed has been used.`;
  }
  const lines = [
    "",
    agentRule(report.agent),
    c.bold(c.red(`${report.deadSkills.length} dead skill${report.deadSkills.length === 1 ? "" : "s"} (installed, never invoked):`)),
    "",
  ];
  for (const name of report.deadSkills) lines.push(`  ${name}`);
  return lines.join("\n");
}

export function formatDoctor(
  report: Report,
  skippedSamples: string[]
): string {
  const { files, linesParsed, linesSkipped } = report.parseHealth;
  const total = linesParsed + linesSkipped;
  const pct = total > 0 ? Math.round((linesParsed / total) * 100) : 100;
  const lines = [
    "",
    agentRule(report.agent),
    `  files: ${formatInt(files)}  lines parsed: ${formatInt(linesParsed)}  skipped: ${formatInt(linesSkipped)}  (${pct}% parsed)`,
  ];
  if (skippedSamples.length > 0) {
    lines.push(c.dim("  sample skipped lines (format drift? open an issue with these):"));
    for (const s of skippedSamples) lines.push(c.dim(`    ${s}`));
  }
  return lines.join("\n");
}
