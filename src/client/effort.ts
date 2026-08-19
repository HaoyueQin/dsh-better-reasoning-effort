/**
 * Pure draft logic of the thinking-effort editor: mapping a stored declaration
 * to the editor's checkbox draft and back, plus semantic comparison. Kept out
 * of the component so the intent rules are unit-testable without React.
 *
 * @module dsh-better-reasoning-effort/client/effort
 */

import { THINKING_LEVELS, type ReasoningEfforts, type ThinkingLevel } from '../knowledge.js'

/** The escalation order, newest-first-freeze, matching the schema's ladder. */
export const LEVEL_ORDER: readonly ThinkingLevel[] = [...THINKING_LEVELS]

/** Draft state of one level's wire value. */
export type DraftLevels = Record<ThinkingLevel, { on: boolean; wire: string }>

/** What the editor can write: unset (no declaration), disabled (false), or a dict. */
export type EffortIntent = ReasoningEfforts | false | undefined

/**
 * The draft of one declaration. A `false` declaration (reasoning disabled)
 * shows as the off level armed — saving it writes `false`; an unset
 * declaration shows as every level off — saving it unsets the field.
 */
export function draftFrom(efforts: EffortIntent): DraftLevels {
  const draft = {} as DraftLevels
  for (const level of LEVEL_ORDER) {
    if (efforts === undefined) {
      draft[level] = { on: false, wire: '' }
      continue
    }
    if (efforts === false) {
      draft[level] = level === 'off' ? { on: true, wire: '' } : { on: false, wire: '' }
      continue
    }
    const wire = efforts[level]
    draft[level] = {
      on: wire !== undefined,
      wire: wire === null ? '' : typeof wire === 'string' ? wire : '',
    }
  }
  return draft
}

/**
 * Resolve a draft to the value to write:
 *  - no level armed          → `undefined` (unset the declaration);
 *  - only `off` armed        → `false` (reasoning disabled);
 *  - at least one thinking level → the dict (with `off: null` when armed).
 */
export function buildIntent(draft: DraftLevels): EffortIntent {
  let off = false
  let thinking = false
  const out: ReasoningEfforts = {}
  for (const level of LEVEL_ORDER) {
    const cell = draft[level]
    if (!cell.on) continue
    if (level === 'off') {
      off = true
      continue
    }
    thinking = true
    // A level switched on without a spelling defaults to its own name — the
    // convention every OpenAI-compatible endpoint follows.
    const wire = cell.wire.trim()
    out[level] = wire.length === 0 ? level : wire
  }
  if (thinking) {
    if (off) out.off = null
    return out
  }
  return off ? false : undefined
}

/** Semantic equality of two intents, independent of object key order. */
export function sameEfforts(a: EffortIntent, b: EffortIntent): boolean {
  if (a === b) return true
  if (a === false || a === undefined || b === false || b === undefined) return false
  const aKeys = LEVEL_ORDER.filter(level => a[level] !== undefined)
  const bKeys = LEVEL_ORDER.filter(level => b[level] !== undefined)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(level => a[level] === b[level])
}
