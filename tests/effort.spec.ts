/**
 * Draft/intent mapping tests of the effort editor's pure logic.
 */

import { describe, expect, it } from 'vitest'
import { buildIntent, draftFrom, LEVEL_ORDER, sameEfforts } from '../src/client/effort.js'

describe('draftFrom', () => {
  it('maps an unset declaration to every level off', () => {
    const draft = draftFrom(undefined)
    expect(LEVEL_ORDER.every(level => draft[level].on === false)).toBe(true)
    expect(LEVEL_ORDER.every(level => draft[level].wire === '')).toBe(true)
  })

  it('maps a false declaration to only the off level armed', () => {
    const draft = draftFrom(false)
    expect(draft.off.on).toBe(true)
    expect(LEVEL_ORDER.filter(level => level !== 'off').every(level => draft[level].on === false)).toBe(true)
  })

  it('maps a dict, keeping null spellings as empty wires', () => {
    const draft = draftFrom({ off: null, high: 'high' })
    expect(draft.off.on).toBe(true)
    expect(draft.off.wire).toBe('')
    expect(draft.high.on).toBe(true)
    expect(draft.high.wire).toBe('high')
    expect(draft.low.on).toBe(false)
  })
})

describe('buildIntent', () => {
  it('returns undefined when no level is armed (unset the declaration)', () => {
    expect(buildIntent(draftFrom(undefined))).toBeUndefined()
  })

  it('returns false when only off is armed (disable reasoning)', () => {
    const draft = draftFrom(undefined)
    draft.off.on = true
    expect(buildIntent(draft)).toBe(false)
  })

  it('builds a dict from armed thinking levels, with off:null when off is armed', () => {
    const draft = draftFrom(undefined)
    draft.off.on = true
    draft.high.on = true
    draft.high.wire = 'ultra'
    expect(buildIntent(draft)).toEqual({ off: null, high: 'ultra' })
  })

  it('defaults an armed thinking level without a spelling to its own name', () => {
    const draft = draftFrom(undefined)
    draft.medium.on = true
    expect(buildIntent(draft)).toEqual({ medium: 'medium' })
  })

  it('round-trips a dict through draft and back', () => {
    const efforts = { off: null, low: 'low', max: 'max' }
    expect(buildIntent(draftFrom(efforts))).toEqual(efforts)
  })
})

describe('sameEfforts', () => {
  it('compares semantically, independent of key order', () => {
    expect(sameEfforts({ off: null, high: 'high' }, { high: 'high', off: null })).toBe(true)
    expect(sameEfforts({ off: null, high: 'high' }, { off: null, high: 'ultra' })).toBe(false)
  })

  it('treats undefined and false as distinct', () => {
    expect(sameEfforts(undefined, undefined)).toBe(true)
    expect(sameEfforts(false, false)).toBe(true)
    expect(sameEfforts(undefined, false)).toBe(false)
  })
})
