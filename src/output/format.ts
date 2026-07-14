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
  lines.push(
    c.bold(`💀 deadskills · ${report.agent}`) +
      c.dim(` · ${report.sessions} sessions · ${report.assistantTurns} turns analyzed${window}`)
  );
  lines.push(
    `Context tax: ${c.bold(c.yellow(`~${report.contextTaxPerPrompt} tokens`))}` +
      c.dim(` added to every prompt by ${report.skills.length} installed skills`)
  );
  lines.push("");

  for (const s of active) {
    lines.push(
      `  ${c.cyan(pad(s.name, 30))} ${bar(s.invocations, max)} ${String(s.invocations).padStart(4)}×` +
        c.dim(`  ~${s.estimatedTotalTokens} tok`)
    );
  }

  if (zombies.length > 0) {
    lines.push("");
    lines.push(c.bold(c.yellow(`🧟 Zombie skills (${zombies.length}) — used before, silent for 90+ days:`)));
    for (const s of zombies) {
      lines.push(
        `  ${c.yellow(pad(s.name, 30))} ${c.dim(`last used ${s.lastUsed?.slice(0, 10) ?? "?"} · ${s.invocations}× all-time`)}`
      );
    }
  }

  if (dead.length > 0) {
    lines.push("");
    lines.push(c.bold(c.red(`💀 Dead skills (${dead.length}) — installed, never invoked:`)));
    for (const s of dead) {
      lines.push(
        `  ${c.red(pad(s.name, 30))} ${c.dim(`${s.scope} · costs ~${s.injectionTokens} tok/prompt for nothing`)}`
      );
    }
  }

  const unmatched = Object.entries(report.unmatchedInvocations);
  if (unmatched.length > 0) {
    lines.push("");
    lines.push(
      c.dim(`Invoked but not found locally: ${unmatched.map(([n, ct]) => `${n} (${ct}×)`).join(", ")}`)
    );
  }

  const ambiguous = Object.entries(report.ambiguousInvocations);
  if (ambiguous.length > 0) {
    lines.push("");
    lines.push(
      c.yellow(
        `⚠ Ambiguous invocations (not attributed): ${ambiguous
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
        `⚠ Parsed ${Math.round((linesParsed / total) * 100)}% of transcript lines — ` +
          `numbers may undercount. Run \`deadskills doctor\`.`
      )
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function formatDead(report: Report): string {
  if (report.deadSkills.length === 0) {
    return `[${report.agent}] No dead skills — everything installed has been used. 🎉`;
  }
  const lines = [
    c.bold(`💀 [${report.agent}] ${report.deadSkills.length} dead skills (installed, never invoked):`),
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
    c.bold(`🩺 ${report.agent}`),
    `  files: ${files}  lines parsed: ${linesParsed}  skipped: ${linesSkipped}  (${pct}% parsed)`,
  ];
  if (skippedSamples.length > 0) {
    lines.push(c.dim("  sample skipped lines (format drift? open an issue with these):"));
    for (const s of skippedSamples) lines.push(c.dim(`    ${s}`));
  }
  return lines.join("\n");
}
