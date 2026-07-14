import { createClaudeCodeAdapter } from "./claude-code.js";
import { createCodexAdapter } from "./codex.js";
import type { AgentAdapter } from "./types.js";

export interface AdapterOverrides {
  claudeDir?: string;
  codexDir?: string;
}

/** All known adapters. New agents: add one line here + one file in this dir. */
export function allAdapters(overrides: AdapterOverrides = {}): AgentAdapter[] {
  return [
    createClaudeCodeAdapter(overrides.claudeDir),
    createCodexAdapter(overrides.codexDir),
  ];
}

export function detectedAdapters(overrides: AdapterOverrides = {}): AgentAdapter[] {
  return allAdapters(overrides).filter((a) => a.detect());
}
