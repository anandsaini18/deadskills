import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "../analysis/tokens.js";
import type { SkillRoot } from "../adapters/types.js";

export interface InstalledSkill {
  name: string;
  description: string;
  /** "personal" | "project" | "plugin" */
  scope: string;
  path: string;
  /** Estimated tokens the name+description costs in EVERY prompt. */
  injectionTokens: number;
  /** Estimated tokens of the full SKILL.md body, paid on each invocation. */
  bodyTokens: number;
}

/**
 * Discover installed skills under the given roots (each agent adapter
 * supplies its own roots via `skillRoots()`). Layout is the shared
 * Agent Skills convention: <root>/<skill-name>/SKILL.md
 */
export function discoverSkills(roots: SkillRoot[]): InstalledSkill[] {
  const skills: InstalledSkill[] = [];
  const seen = new Set<string>();
  for (const { dir, scope } of roots) {
    if (!existsSync(dir)) continue;
    for (const entry of safeReaddir(dir)) {
      const skillMd = join(dir, entry, "SKILL.md");
      if (!existsSync(skillMd) || seen.has(skillMd)) continue;
      seen.add(skillMd);
      const skill = parseSkillMd(skillMd, scope);
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

/** Parse SKILL.md frontmatter. Exported for tests. */
export function parseSkillMd(path: string, scope: string): InstalledSkill | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
  const frontmatter = fm?.[1] ?? "";
  const name = matchField(frontmatter, "name");
  const description = matchField(frontmatter, "description");
  if (!name) return null;
  return {
    name,
    description: description ?? "",
    scope,
    path,
    injectionTokens: estimateTokens(`${name} ${description ?? ""}`),
    bodyTokens: estimateTokens(raw),
  };
}

function matchField(frontmatter: string, field: string): string | null {
  const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
  const m = re.exec(frontmatter);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
}
