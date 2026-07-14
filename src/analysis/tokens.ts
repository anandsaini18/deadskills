/**
 * Rough token estimate: ~4 chars per token for English/markdown.
 * Deliberately an approximation — deadskills reports are directional
 * ("delete these 12 dead skills"), not billing-grade.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
