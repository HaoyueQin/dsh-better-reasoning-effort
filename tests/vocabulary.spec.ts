/**
 * Vocabulary grid tests: every knowledge-base entry must survive pi-ai's
 * schema AND its resolution gates for EVERY real wire protocol.
 *
 * These constants are pinned from @deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.8:
 *   - THINKING_FORMAT_GATE  (llm-pi-ai/src/catalog.ts)  — nameable formats
 *   - COMPLETIONS_COMPAT_GATE / RESPONSES_COMPAT_GATE / ANTHROPIC_COMPAT_GATE
 *     (llm-pi-ai/src/catalog.ts)                          — per-protocol offers
 *   - resolveModelReasoning rules (llm-pi-ai/src/catalog.ts) — efforts shape
 *
 * If a pi-ai upgrade drifts these sets, the harness fails loudly at compile
 * time in ITS repo — and these grids fail HERE before a bad suggestion ever
 * reaches a user's settings.yaml. Update the pins together with the upgrade.
 */

import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_BASE,
  PROTOCOL_INFERENCE,
  suggestEfforts,
  type ReasoningEfforts,
} from '../src/knowledge.js'

/** pi-ai's nameable reasoning-dispatch formats (THINKING_FORMAT_GATE keys). */
const PI_AI_THINKING_FORMATS = [
  'openai',
  'deepseek',
  'openrouter',
  'together',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const

/** The only protocols a route's `api` may name (provider.ts PROTOCOLS). */
const PI_AI_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const

/** Fields each protocol's compat gate OFFERS to a model-level switch. */
const COMPAT_GATES: Readonly<Record<(typeof PI_AI_PROTOCOLS)[number], readonly string[]>> = {
  'openai-completions': [
    'supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming',
    'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult',
    'requiresThinkingAsText', 'thinkingFormat', 'chatTemplateKwargs', 'supportsStrictMode',
    'cacheControlFormat', 'supportsLongCacheRetention',
  ],
  'openai-responses': [
    'supportsDeveloperRole', 'supportsStrictMode', 'supportsLongCacheRetention',
  ],
  'anthropic-messages': [
    'supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools',
    'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools',
  ],
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Assert one efforts dict against pi-ai's resolveModelReasoning rules. */
function assertEffortsShape(efforts: ReasoningEfforts): void {
  const entries = Object.entries(efforts)
  expect(entries.length, 'empty reasoningEfforts declares nothing and is refused').toBeGreaterThan(0)
  let nonOff = 0
  for (const [level, wire] of entries) {
    expect(THINKING_LEVELS as readonly string[]).toContain(level)
    if (wire === null) {
      expect(level, 'only "off" may leave the wire value empty').toBe('off')
    } else {
      expect(typeof wire).toBe('string')
      expect(wire.length, 'wire spellings must not be empty strings').toBeGreaterThan(0)
    }
    if (level !== 'off') nonOff += 1
  }
  expect(nonOff, 'reasoningEfforts must offer at least one level beyond "off"').toBeGreaterThan(0)
}

describe('knowledge base vocabulary grid', () => {
  it('names only pi-ai thinkingFormats', () => {
    for (const entry of KNOWLEDGE_BASE) {
      const format = entry.compat?.thinkingFormat
      if (format !== undefined) {
        expect(PI_AI_THINKING_FORMATS, `entry ${entry.id} names format "${format}"`).toContain(format)
      }
    }
  })

  it('keeps every efforts dict inside pi-ai resolution rules', () => {
    for (const entry of KNOWLEDGE_BASE) {
      assertEffortsShape(entry.efforts)
    }
  })

  it('uses only compat fields some protocol gate offers', () => {
    const everyOfferedField = new Set(Object.values(COMPAT_GATES).flat())
    for (const entry of KNOWLEDGE_BASE) {
      for (const field of Object.keys(entry.compat ?? {})) {
        expect(everyOfferedField.has(field), `entry ${entry.id} sets unknown compat field "${field}"`).toBe(true)
      }
    }
  })

  it('survives the full entry x protocol suggestion grid', () => {
    for (const entry of KNOWLEDGE_BASE) {
      // A representative id that hits this entry (first pattern suffices —
      // matching internals are covered by knowledge.spec.ts).
      const probe = entry.patterns[0]!
      for (const api of PI_AI_PROTOCOLS) {
        const suggestion = suggestEfforts(probe, { api })
        expect(suggestion.efforts, `${entry.id} x ${api}`).toBeDefined()
        assertEffortsShape(suggestion.efforts!)
        for (const field of Object.keys(suggestion.compat ?? {})) {
          expect(
            COMPAT_GATES[api],
            `${entry.id} x ${api}: compat field "${field}" is refused by the protocol gate`,
          ).toContain(field)
        }
      }
    }
  })

  it('keeps protocol-inference ladders inside pi-ai resolution rules too', () => {
    for (const [key, efforts] of Object.entries(PROTOCOL_INFERENCE)) {
      // Every key must be either a real protocol or the deepseek URL dialect.
      expect([...PI_AI_PROTOCOLS, 'deepseek'], `inference key "${key}"`).toContain(key)
      assertEffortsShape(efforts)
    }
  })
})
