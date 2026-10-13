/**
 * Default-guard decision: which effort-less calls may take the vendor
 * default instead of the wire's off-equivalent (issue #2).
 *
 * Pi-ai always emits a thinking parameter for reasoning models, so an
 * effort-less call to a forced-thinking ladder (no `off` key) becomes
 * `thinking: {type: disabled}` / `enable_thinking: false` -- a guaranteed
 * 400 on upstreams that cannot switch thinking off. Rewriting exactly that
 * class into the ladder's vendor default produces bytes identical to the
 * user picking the level by hand, a request class that already works.
 *
 * Pure data logic (no harness imports): the host half feeds it the declared
 * ladder, the knowledge-base vendor default, and the route default, and
 * injects the returned level -- or nothing when it answers undefined.
 *
 * @module dsh-better-reasoning-effort/guard
 */

import type { ReasoningEfforts, ThinkingLevel } from './knowledge.js'

/** Inputs to the guard decision, all optional except the declaration. */
export interface GuardInput {
  /** The model's declared ladder (`false` = non-reasoning). */
  declared: ReasoningEfforts | false | undefined
  /** The knowledge-base vendor default for the family, when one is known. */
  vendorDefault?: ThinkingLevel
  /** The route profile's configured reasoning default, when one is set. */
  profileDefault?: string
  /** The call's explicit effort, when the caller named one. */
  requested?: string
}

/**
 * The level to inject for an effort-less call, or undefined to pass through.
 * Refusals are silent and total: explicit selections, off-capable ladders,
 * undeclared/non-reasoning models, an explicit route default, and vendor
 * defaults outside the ladder all pass through untouched.
 */
export function resolveGuardEffort(input: GuardInput): string | undefined {
  if (input.requested !== undefined) return undefined
  const declared = input.declared
  if (declared === undefined || declared === false) return undefined
  if ('off' in declared) return undefined
  if (input.profileDefault !== undefined) return undefined
  const fallback = input.vendorDefault
  if (fallback === undefined || !(fallback in declared)) return undefined
  return fallback
}
