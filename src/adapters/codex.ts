import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
import { normalizeSkillName } from "./claude-code.js";

/**
 * Adapter for OpenAI Codex CLI local transcripts.
 *
 * Data layout (undocumented, observed as of mid-2026 — treat as drifting):
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl
 *
 * Each line: { timestamp, type, payload }. Types we rely on (fail soft):
 *   type: "response_item", payload: { type: "message", role, content }
 *   type: "response_item", payload: { type: "function_call", name, arguments }
 *   type: "event_msg",     payload: { type: "token_count", info: { ... } }
 *   type: "session_meta",  payload: { id, cwd, ... }
 *
 * Skills: ~/.codex/skills/<name>/SKILL.md (personal), .codex/skills (project).
 *
 * Skill invocation detection (heuristic — validate against real rollouts):
 *   1. function_call/tool named "skill"-ish with a skill argument
 *   2. any reference to a path ".../skills/<name>/SKILL.md" in function_call
 *      arguments (Codex reads the SKILL.md when a skill activates)
 *   3. "$skill-name" mentions in user messages
 */

const SKILL_PATH_RE = /skills\/([A-Za-z0-9_-]+)\/SKILL\.md/;
const DOLLAR_MENTION_RE = /(?:^|\s)\$([a-z0-9][a-z0-9_-]{2,})/;

export function createCodexAdapter(codexDir?: string): AgentAdapter {
  const root = codexDir ?? join(homedir(), ".codex");
  const sessionsDir = join(root, "sessions");

  return {
    name: "codex",
    detect: () => existsSync(sessionsDir),
    skillRoots(projectDir?: string): SkillRoot[] {
      return [
        { dir: join(root, "skills"), scope: "personal" },
        { dir: join(projectDir ?? process.cwd(), ".codex", "skills"), scope: "project" },
        { dir: join(projectDir ?? process.cwd(), ".agents", "skills"), scope: "project" },
      ];
    },
    async loadEvents(): Promise<LoadResult> {
      const events: SessionEvent[] = [];
      const health = newHealth();
      for (const file of walkJsonl(sessionsDir)) {
        let raw: string;
        try {
          raw = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        health.files++;
        const sessionId = file.replace(/^.*rollout-/, "").replace(/\.jsonl$/, "");
        let project: string | undefined;
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          const parsed = parseCodexLine(line, sessionId, project);
          if (parsed === null) {
            recordSkip(health, line);
            continue;
          }
          health.linesParsed++;
          if (parsed.meta?.cwd) project = parsed.meta.cwd;
          if (parsed.event) events.push(parsed.event);
        }
      }
      return { events, health };
    },
  };
}

interface CodexParsed {
  event?: SessionEvent;
  meta?: { cwd?: string };
}

/** Parse one rollout line. Exported for tests. null = unparseable (counts as skipped). */
export function parseCodexLine(
  line: string,
  sessionId: string,
  project?: string
): CodexParsed | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const payload = obj.payload ?? {};

  if (obj.type === "session_meta") {
    return { meta: { cwd: typeof payload.cwd === "string" ? payload.cwd : undefined } };
  }

  if (obj.type === "response_item") {
    if (payload.type === "message") {
      const role: SessionEvent["role"] =
        payload.role === "assistant" ? "assistant" : payload.role === "user" ? "user" : "system";
      const event: SessionEvent = {
        sessionId,
        timestamp: obj.timestamp,
        role,
        project,
      };
      const text = extractText(payload.content);
      const mention = DOLLAR_MENTION_RE.exec(text);
      const skillPath = SKILL_PATH_RE.exec(text);
      if (skillPath) {
        event.skillInvocation = { name: normalizeSkillName(skillPath[1]), source: "auto" };
      } else if (role === "user" && mention) {
        event.skillInvocation = { name: normalizeSkillName(mention[1]), source: "explicit" };
      }
      return { event };
    }
    if (payload.type === "function_call") {
      const event: SessionEvent = {
        sessionId,
        timestamp: obj.timestamp,
        role: "tool",
        project,
      };
      const args = typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments ?? "");
      const skillPath = SKILL_PATH_RE.exec(args);
      if (skillPath) {
        event.skillInvocation = { name: normalizeSkillName(skillPath[1]), source: "auto" };
      } else if (typeof payload.name === "string" && /skill/i.test(payload.name)) {
        const name = tryParseSkillArg(args);
        if (name) event.skillInvocation = { name: normalizeSkillName(name), source: "auto" };
      }
      return { event };
    }
    // Other response_item payloads (function_call_output, reasoning...) are valid lines we don't need.
    return {};
  }

  if (obj.type === "event_msg" || obj.type === "turn_context") {
    return {}; // recognized, not needed for v1
  }

  // Unknown top-level type: recognized as JSON but unknown shape — count as parsed, keep quiet.
  return {};
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === "string" ? c : (c?.text ?? "")))
      .join(" ");
  }
  return "";
}

function tryParseSkillArg(args: string): string | null {
  try {
    const parsed = JSON.parse(args);
    const v = parsed?.skill ?? parsed?.name ?? parsed?.skill_name;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Recursively collect .jsonl files under dir (sessions are nested YYYY/MM/DD). */
function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) out.push(...walkJsonl(full));
    else if (entry.endsWith(".jsonl")) out.push(full);
  }
  return out;
}
