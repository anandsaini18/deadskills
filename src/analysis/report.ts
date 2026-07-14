import { normalizeSkillName } from "../adapters/claude-code.js";
import type { ParseHealth, SessionEvent } from "../adapters/types.js";
import type { InstalledSkill } from "../discovery/skills.js";

export interface SkillUsage {
  name: string;
  description: string;
  scope: string;
  invocations: number;
  lastUsed: string | null;
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
  sessions: number;
  assistantTurns: number;
  skills: SkillUsage[];
  deadSkills: string[];
  /** Tokens ALL installed skill descriptions add to each prompt. */
  contextTaxPerPrompt: number;
  /** Invoked skill names that don't match any installed skill (uninstalled/renamed). */
  unmatchedInvocations: Record<string, number>;
  /** Parse accounting — if linesSkipped is high, numbers below undercount. */
  parseHealth: {
    files: number;
    linesParsed: number;
    linesSkipped: number;
  };
}

export function buildReport(
  skills: InstalledSkill[],
  events: SessionEvent[],
  agent: string,
  health?: ParseHealth
): Report {
  const bySkill = new Map<string, { count: number; lastUsed: string | null }>();
  const sessions = new Set<string>();
  let assistantTurns = 0;

  for (const ev of events) {
    sessions.add(ev.sessionId);
    if (ev.role === "assistant") assistantTurns++;
    if (ev.skillInvocation) {
      const key = ev.skillInvocation.name;
      const cur = bySkill.get(key) ?? { count: 0, lastUsed: null };
      cur.count++;
      if (ev.timestamp && (!cur.lastUsed || ev.timestamp > cur.lastUsed)) {
        cur.lastUsed = ev.timestamp;
      }
      bySkill.set(key, cur);
    }
  }

  const matched = new Set<string>();
  const usages: SkillUsage[] = skills.map((skill) => {
    const key = normalizeSkillName(skill.name);
    const usage = bySkill.get(key);
    if (usage) matched.add(key);
    const invocations = usage?.count ?? 0;
    return {
      name: skill.name,
      description: skill.description,
      scope: skill.scope,
      invocations,
      lastUsed: usage?.lastUsed ?? null,
      injectionTokens: skill.injectionTokens,
      estimatedTotalTokens:
        skill.injectionTokens * assistantTurns + skill.bodyTokens * invocations,
      dead: invocations === 0,
    };
  });

  usages.sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name));

  const unmatchedInvocations: Record<string, number> = {};
  for (const [name, { count }] of bySkill) {
    if (!matched.has(name)) unmatchedInvocations[name] = count;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    agent,
    sessions: sessions.size,
    assistantTurns,
    skills: usages,
    deadSkills: usages.filter((u) => u.dead).map((u) => u.name),
    contextTaxPerPrompt: usages.reduce((sum, u) => sum + u.injectionTokens, 0),
    unmatchedInvocations,
    parseHealth: {
      files: health?.files ?? 0,
      linesParsed: health?.linesParsed ?? 0,
      linesSkipped: health?.linesSkipped ?? 0,
    },
  };
}
