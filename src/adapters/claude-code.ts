import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  newHealth,
  recordSkip,
  type AgentAdapter,
  type LoadResult,
  type SessionEvent,
  type SkillRoot,
} from "./types.js";

/**
 * Adapter for Claude Code local transcripts.
 *
 * Data layout (undocumented, observed as of mid-2026 — treat as drifting):
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *
 * Each line is a JSON object. Shapes we rely on (fail soft on all):
 *   { type: "user" | "assistant", sessionId, timestamp,
 *     message: { role, content: [ { type: "tool_use", name, input } | { type: "text", text } ],
 *                usage?: { input_tokens, output_tokens, cache_read_input_tokens } } }
 *
 * Skill invocations are detected via:
 *   1. tool_use blocks named "Skill" → input.skill / input.command
 *   2. <command-name>...</command-name> markers in text content
 */

const COMMAND_NAME_RE = /<command-name>\/?([^<]+)<\/command-name>/;

export function createClaudeCodeAdapter(claudeDir?: string): AgentAdapter {
  const root = claudeDir ?? join(homedir(), ".claude");
  const projectsDir = join(root, "projects");

  return {
    name: "claude-code",
    detect: () => existsSync(projectsDir),
    skillRoots(projectDir?: string): SkillRoot[] {
      const roots: SkillRoot[] = [
        { dir: join(root, "skills"), scope: "personal" },
        { dir: join(projectDir ?? process.cwd(), ".claude", "skills"), scope: "project" },
      ];
      const pluginsRoot = join(root, "plugins");
      for (const entry of safeReaddir(pluginsRoot)) {
        roots.push({ dir: join(pluginsRoot, entry, "skills"), scope: "plugin", namespace: entry });
      }
      return roots;
    },
    async loadEvents(): Promise<LoadResult> {
      const events: SessionEvent[] = [];
      const health = newHealth();
      for (const proj of safeReaddir(projectsDir)) {
        const dir = join(projectsDir, proj);
        for (const file of safeReaddir(dir).filter((f) => f.endsWith(".jsonl"))) {
          let raw: string;
          try {
            raw = readFileSync(join(dir, file), "utf8");
          } catch {
            continue;
          }
          health.files++;
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            const event = parseLine(line, proj, file);
            if (event) {
              events.push(event);
              health.linesParsed++;
            } else {
              recordSkip(health, line);
            }
          }
        }
      }
      return { events, health };
    },
  };
}

/** Parse a single transcript line. Exported for tests. Returns null on junk. */
export function parseLine(
  line: string,
  project: string,
  file: string
): SessionEvent | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const role: SessionEvent["role"] =
    obj.type === "assistant"
      ? "assistant"
      : obj.type === "user"
        ? "user"
        : obj.message?.role === "assistant"
          ? "assistant"
          : "system";

  const event: SessionEvent = {
    sessionId: obj.sessionId ?? file.replace(/\.jsonl$/, ""),
    timestamp: obj.timestamp,
    role,
    project,
  };

  const usage = obj.message?.usage;
  if (usage) {
    event.tokens = {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
    };
  }

  const content = obj.message?.content;
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    if (block?.type === "tool_use" && block.name === "Skill") {
      const name = block.input?.skill ?? block.input?.command;
      if (typeof name === "string") {
        event.skillInvocation = { name: rawSkillName(name), source: "auto" };
      }
    } else if (typeof block?.text === "string") {
      const m = COMMAND_NAME_RE.exec(block.text);
      if (m) {
        event.skillInvocation = { name: rawSkillName(m[1]), source: "explicit" };
      }
    }
  }
  if (typeof content === "string") {
    const m = COMMAND_NAME_RE.exec(content);
    if (m) {
      event.skillInvocation = { name: rawSkillName(m[1]), source: "explicit" };
    }
  }

  return event;
}

/**
 * Invocation names are kept RAW (namespace preserved) so attribution can
 * match fully-qualified names first. Only strip leading "/" and whitespace.
 */
export function rawSkillName(name: string): string {
  return name.trim().replace(/^\//, "").trim();
}

/** "plugin:skill" and "/skill" both resolve to bare skill names for fallback matching. */
export function normalizeSkillName(name: string): string {
  const parts = rawSkillName(name).split(":");
  return parts[parts.length - 1].trim();
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
}
