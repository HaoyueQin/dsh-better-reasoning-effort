/**
 * Default-wire risk predicate tests (issue #2).
 *
 * Each case mirrors a `scripts/wire-repro.mjs` capture: the predicate must
 * flag exactly the (format, ladder) pairs whose Default bytes an upstream
 * rejects, and stay silent everywhere else.
 */

import { describe, expect, it } from 'vitest'
import { defaultWireRisk } from '../src/client/wire-preview.js'

describe('defaultWireRisk', () => {
  it('flags forced-thinking zai/deepseek ladders (thinking:disabled)', () => {
    // glm-5.3-flash shape: no off key -- Default emits the disabled object.
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, 'zai')).toBe('thinking-disabled')
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, 'deepseek')).toBe('thinking-disabled')
  })

  it('flags forced-thinking qwen ladders (enable_thinking:false)', () => {
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, 'qwen')).toBe('enable-thinking-false')
  })

  it('stays silent for off-capable, bare, and non-reasoning declarations', () => {
    expect(defaultWireRisk({ off: null, high: 'high' }, 'qwen')).toBeUndefined()
    expect(defaultWireRisk({ off: 'none', high: 'high' }, 'zai')).toBeUndefined()
    expect(defaultWireRisk(undefined, 'zai')).toBeUndefined()
    expect(defaultWireRisk(false, 'zai')).toBeUndefined()
  })

  it('stays silent for formats with an omit path', () => {
    // Generic openai sends nothing on Default; unknown formats defer to
    // pi-ai detection, which only special-cases deepseek/zai hosts.
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, 'openai')).toBeUndefined()
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, undefined)).toBeUndefined()
    expect(defaultWireRisk({ low: 'low', high: 'high', max: 'max' }, 'together')).toBeUndefined()
  })
})