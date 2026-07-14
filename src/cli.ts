import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectedAdapters } from "./adapters/index.js";
import { buildReport, parseSince, type Report } from "./analysis/report.js";
import { discoverSkills } from "./discovery/skills.js";
import { formatDead, formatDoctor, formatReport, formatWordmark } from "./output/format.js";

const HELP = `
  💀 deadskills — find the agent skills you never use

  Usage
    $ deadskills            Full usage report for every detected agent
    $ deadskills dead       Only the unused-skills list
    $ deadskills doctor     Parse health — is deadskills reading your transcripts correctly?

  Options
    --json            Canonical JSON report array (schema/report.schema.json)
    --since <when>    Only count usage since e.g. 30d, 8w, 6m, or 2026-01-01
    --agent <name>    Only this agent (claude-code | codex)
    --claude-dir <p>  Override Claude data dir (default: ~/.claude)
    --codex-dir <p>   Override Codex data dir (default: ~/.codex)
    --project <p>     Project dir for project-scoped skills (default: cwd)
    --help            This help

  Supported agents: Claude Code, Codex — both auto-detected.
  100% local. Your transcripts never leave your machine.
`;

interface Args {
  command?: string;
  json: boolean;
  agent?: string;
  since?: string;
  claudeDir?: string;
  codexDir?: string;
  project?: string;
  help: boolean;
}

/** Tiny hand-rolled arg parser. Exported for tests. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--agent") args.agent = argv[++i];
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--codex-dir") args.codexDir = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (!a.startsWith("-") && !args.command) args.command = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  let since: Date | undefined;
  if (args.since) {
    const parsed = parseSince(args.since);
    if (!parsed) {
      console.error(`Cannot parse --since "${args.since}" (try 30d, 8w, 6m, or an ISO date).`);
      process.exit(1);
    }
    since = parsed;
  }

  let adapters = detectedAdapters({ claudeDir: args.claudeDir, codexDir: args.codexDir });
  if (args.agent) adapters = adapters.filter((a) => a.name === args.agent);

  if (adapters.length === 0) {
    console.error(
      args.agent
        ? `Agent "${args.agent}" not detected on this machine.`
        : "No supported agent data found (~/.claude/projects or ~/.codex/sessions)."
    );
    process.exit(1);
  }

  const reports: Array<{ report: Report; skippedSamples: string[] }> = [];
  for (const adapter of adapters) {
    const skills = discoverSkills(adapter.skillRoots(args.project));
    const { events, health } = await adapter.loadEvents();
    reports.push({
      report: buildReport(skills, events, adapter.name, health, since),
      skippedSamples: health.skippedSamples,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(reports.map((r) => r.report), null, 2));
    return;
  }

  console.log(formatWordmark());

  for (const { report, skippedSamples } of reports) {
    switch (args.command) {
      case "dead":
        console.log(formatDead(report));
        break;
      case "doctor":
        console.log(formatDoctor(report, skippedSamples));
        break;
      default:
        console.log(formatReport(report));
    }
  }
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    const base = invoked.split("/").pop();
    return base === "cli.js" || base === "deadskills";
  }
}

// Only run when executed as a CLI, not when imported (e.g. by tests).
if (isCliEntrypoint()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
