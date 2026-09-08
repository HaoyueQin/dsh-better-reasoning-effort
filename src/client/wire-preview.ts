/**
 * Default-wire risk: what pi-ai sends when a call names no effort.
 *
 * Three openai-completions thinking formats have no omit path: with no
 * effort selected they emit an off-equivalent even when the ladder offers no
 * `off` level (read from pi-ai 0.85 `dist/api/openai-completions.js`, kept in
 * sync by `scripts/wire-repro.mjs`). The generic `openai` format instead
 * sends nothing, so it is safe. This predicate names the risk for one
 * declared ladder so the editor can warn where the failure would otherwise
 * look inexplicable (issue #2: "off 已删，测试页照样 1210").
 *
 * Pure data logic, no DOM: esbuild inlines it into the browser bundle.
 *
 * @module dsh-better-reasoning-effort/client/wire-preview
 */

import type { ReasoningEfforts } from '../knowledge.js'

/** How a Default call fails on a forced-thinking ladder, by wire format. */
export type DefaultWireRisk =
  /** `thinking: {type: disabled}` -- rejected with 1210-class errors. */
  | 'thinking-disabled'
  /** `enable_thinking: false` -- rejected only where the upstream requires thinking on. */
  | 'enable-thinking-false'

/**
 * The Default-wire risk of one declared ladder under one thinking format.
 * `false` (non-reasoning), absent declarations, ladders carrying `off`, and
 * formats with an omit path (generic `openai`, unknown) all answer
 * undefined: Default is safe there.
 */
export function defaultWireRisk(
  declared: ReasoningEfforts | false | undefined,
  thinkingFormat: string | undefined,
): DefaultWireRisk | undefined {
  if (declared === undefined || declared === false) return undefined
  if ('off' in declared) return undefined
  if (thinkingFormat === 'zai' || thinkingFormat === 'deepseek') return 'thinking-disabled'
  if (thinkingFormat === 'qwen') return 'enable-thinking-false'
  return undefined
}
