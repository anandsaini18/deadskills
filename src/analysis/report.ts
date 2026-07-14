import { normalizeSkillName } from "../adapters/claude-code.js";
import type { ParseHealth, SessionEvent } from "../adapters/types.js";
import type { InstalledSkill } from "../discovery/skills.js";

/** A skill is a zombie if it was used, but not in the last N days. */
export const ZOMBIE_DAYS = 90;

export type SkillStatus = "active" | "zombie" | "dead";

export interface SkillUsage {
  name: string;
  qualifiedName?: string;
  description: string;
  scope: string;
  invocations: number;
  /** Of which explicitly invoked (/command, $mention) vs auto-triggered. */
  explicitInvocations: number;
  lastUsed: string | null;
  status: SkillStatus;
  /** Tokens this skill's name+description adds to every prompt. */
  injectionTokens: number;
  /** Estimated cost upper bound: injection × assistant turns + body × invocations. */
  estimatedTotalTokens: number;
  dead: boolean;
}

export interface Report {
  schemaVersion: 1;
  generatedAt: string;
  agent: string;
  /** ISO date events were filtered from, or null for all-time. */
  windowSince: string | null;
  sessions: number;
  assistantTurns: number;
  skills: SkillUsage[];
  deadSkills: string[];
  /** Used before, but silent for ZOMBIE_DAYS+ days. */
  zombieSkills: string[];
  /** Tokens ALL installed skill descriptions add to each prompt. */
  contextTaxPerPrompt: number;
  /** Invoked skill names that don't match any installed skill (uninstalled/renamed). */
  unmatchedInvocations: Record<string, number>;
  /** Invocation names matching MULTIPLE installed skills — attributed to none, listed here. */
  ambiguousInvocations: Record<string, string[]>;
  /** Parse accounting — if linesSkipped is high, numbers below undercount. */
  parseHealth: {
    files: number;
    linesParsed: number;
    linesSkipped: number;
  };
}

interface Tally {
  count: number;
  explicit: number;
  lastUsed: string | null;
}

export function buildReport(
  skills: InstalledSkill[],
  events: SessionEvent[],
  agent: string,
  health?: ParseHealth,
  since?: Date
): Report {
  if (since) {
    const cutoff = since.toISOString();
    events = events.filter((ev) => !ev.timestamp || ev.timestamp >= cutoff);
  }

  // Attribution: resolve each invocation to an installed skill.
  // 1. exact match on qualifiedName or name (fully-qualified first)
  // 2. fallback: normalized (namespace-stripped) match — only if unambiguous
  const byExact = new Map<string, InstalledSkill>();
  const byNormalized = new Map<string, InstalledSkill[]>();
  const nameCounts = new Map<string, number>();
  for (const skill of skills) {
    nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
  }
  for (const skill of skills) {
    if (skill.qualifiedName) byExact.set(skill.qualifiedName, skill);
    // A bare name is only an exact match when it's unique across installed skills;
    // shared bare names must go through the ambiguity check below.
    if (nameCounts.get(skill.name) === 1 && !byExact.has(skill.name)) {
      byExact.set(skill.name, skill);
    }
    const norm = normalizeSkillName(skill.name);
    byNormalized.set(norm, [...(byNormalized.get(norm) ?? []), skill]);
  }

  const tallies = new Map<InstalledSkill, Tally>();
  const unmatched: Record<string, number> = {};
  const ambiguous: Record<string, string[]> = {};
  const sessions = new Set<string>();
  let assistantTurns = 0;

  for (const ev of events) {
    sessions.add(ev.sessionId);
    if (ev.role === "assistant") assistantTurns++;
    const inv = ev.skillInvocation;
    if (!inv) continue;

    let skill = byExact.get(inv.name);
    if (!skill) {
      const candidates = byNormalized.get(normalizeSkillName(inv.name)) ?? [];
      if (candidates.length === 1) {
        skill = candidates[0];
      } else if (candidates.length > 1) {
        ambiguous[inv.name] = candidates.map((s) => s.qualifiedName ?? s.name);
        continue;
      }
    }
    if (!skill) {
      unmatched[inv.name] = (unmatched[inv.name] ?? 0) + 1;
      continue;
    }

    const tally = tallies.get(skill) ?? { count: 0, explicit: 0, lastUsed: null };
    tally.count++;
    if (inv.source === "explicit") tally.explicit++;
    if (ev.timestamp && (!tally.lastUsed || ev.timestamp > tally.lastUsed)) {
      tally.lastUsed = ev.timestamp;
    }
    tallies.set(skill, tally);
  }

  const zombieCutoff = new Date(Date.now() - ZOMBIE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const usages: SkillUsage[] = skills.map((skill) => {
    const tally = tallies.get(skill);
    const invocations = tally?.count ?? 0;
    const lastUsed = tally?.lastUsed ?? null;
    const status: SkillStatus =
      invocations === 0 ? "dead" : lastUsed && lastUsed < zombieCutoff ? "zombie" : "active";
    return {
      name: skill.name,
      qualifiedName: skill.qualifiedName,
      description: skill.description,
      scope: skill.scope,
      invocations,
      explicitInvocations: tally?.explicit ?? 0,
      lastUsed,
      status,
      injectionTokens: skill.injectionTokens,
      estimatedTotalTokens:
        skill.injectionTokens * assistantTurns + skill.bodyTokens * invocations,
      dead: status === "dead",
    };
  });

  usages.sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    agent,
    windowSince: since ? since.toISOString() : null,
    sessions: sessions.size,
    assistantTurns,
    skills: usages,
    deadSkills: usages.filter((u) => u.status === "dead").map((u) => u.name),
    zombieSkills: usages.filter((u) => u.status === "zombie").map((u) => u.name),
    contextTaxPerPrompt: usages.reduce((sum, u) => sum + u.injectionTokens, 0),
    unmatchedInvocations: unmatched,
    ambiguousInvocations: ambiguous,
    parseHealth: {
      files: health?.files ?? 0,
      linesParsed: health?.linesParsed ?? 0,
      linesSkipped: health?.linesSkipped ?? 0,
    },
  };
}

/**
 * Parse a --since value: "30d", "8w", "6m" or an ISO date "2026-01-01".
 * Returns null for unparseable input.
 */
export function parseSince(value: string, now = new Date()): Date | null {
  const rel = /^(\d+)([dwm])$/.exec(value.trim());
  if (rel) {
    const n = Number(rel[1]);
    const days = rel[2] === "d" ? n : rel[2] === "w" ? n * 7 : n * 30;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }
  const abs = new Date(value);
  return Number.isNaN(abs.getTime()) ? null : abs;
}
