/**
 * Canonical event model. Every agent adapter converts its native
 * transcript format into a stream of SessionEvents.
 *
 * Adding support for a new agent (Cursor, OpenCode, Gemini CLI...) means
 * writing ONE file that implements `AgentAdapter` — see claude-code.ts
 * and codex.ts for reference implementations.
 */

export interface SessionEvent {
  sessionId: string;
  timestamp?: string;
  role: "user" | "assistant" | "tool" | "system";
  /** Present when this event invoked a skill. */
  skillInvocation?: {
    name: string;
    source: "auto" | "explicit";
  };
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
  };
  /** Project directory the session belongs to, if known. */
  project?: string;
}

/** Honest accounting of what we could and couldn't parse. Silent undercounting is a bug. */
export interface ParseHealth {
  files: number;
  linesParsed: number;
  linesSkipped: number;
  /** First few skipped lines (truncated) for `deadskills doctor`. */
  skippedSamples: string[];
}

export interface LoadResult {
  events: SessionEvent[];
  health: ParseHealth;
}

export interface SkillRoot {
  dir: string;
  scope: string; // "personal" | "project" | "plugin"
  /** Namespace for qualified names, e.g. plugin name → "plugin:skill". */
  namespace?: string;
}

export interface AgentAdapter {
  /** Machine name, e.g. "claude-code", "codex". */
  name: string;
  /** Returns true if this agent's data directory exists on this machine. */
  detect(): boolean;
  /** Parse all sessions. Must fail soft: skip unreadable lines/files, record them in health. */
  loadEvents(): Promise<LoadResult>;
  /** Directories where this agent's skills are installed. */
  skillRoots(projectDir?: string): SkillRoot[];
}

export const MAX_SKIPPED_SAMPLES = 5;
export const SAMPLE_TRUNCATE = 200;

export function newHealth(): ParseHealth {
  return { files: 0, linesParsed: 0, linesSkipped: 0, skippedSamples: [] };
}

export function recordSkip(health: ParseHealth, line: string): void {
  health.linesSkipped++;
  if (health.skippedSamples.length < MAX_SKIPPED_SAMPLES) {
    health.skippedSamples.push(line.slice(0, SAMPLE_TRUNCATE));
  }
}
