/**
 * Vocabulary grid tests: every knowledge-base entry must survive pi-ai's
 * schema AND its resolution gates for EVERY real wire protocol.
 *
 * These constants are pinned from @deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.8
 * (re-verified unchanged at 0.1.1-rc.1):
 *   - THINKING_FORMAT_GATE  (llm-pi-ai/src/catalog.ts)  — nameable formats
 *   - COMPLETIONS_COMPAT_GATE / RESPONSES_COMPAT_GATE / ANTHROPIC_COMPAT_GATE
 *     (llm-pi-ai/src/catalog.ts)                          — per-protocol offers
 *   - resolveModelReasoning rules (llm-pi-ai/src/catalog.ts) — efforts shape
 *
 * If a pi-ai upgrade drifts these sets, the harness fails loudly at compile
 * time in ITS repo — and these grids fail HERE before a bad suggestion ever
 * reaches a user's settings.yaml. Update the pins together with the upgrade.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INPUT_MODALITIES,
  KNOWLEDGE_BASE,
  PROTOCOL_INFERENCE,
  suggestEfforts,
  type ReasoningEfforts,
} from '../src/knowledge.js'

/**
 * The core adapter's request-modality vocabulary, extracted MECHANICALLY from
 * the installed @deepseek-ai/dsh-llm-pi-ai artifact (pinned as a
 * devDependency). The upstream constant is module-private in the published
 * lib, so this pin reads the artifact instead of hardcoding the vocabulary:
 * any dependency upgrade that moves the set fails THIS test before a drifted
 * declaration reaches a user's settings.yaml.
 */
function coreModalities(): string[] {
  const source = readFileSync(
    'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
    'utf8',
  )
  const match = source.match(/const MODALITIES = Object\.keys\(\{([\s\S]*?)\}\)/)
  if (match === null) {
    throw new Error(
      'could not extract MODALITY_GATE keys from @deepseek-ai/dsh-llm-pi-ai/lib/index.js -- '
      + 'the generated shape changed; update this extractor together with the upgrade',
    )
  }
  return [...match[1].matchAll(/([a-z]+):\s*true/g)].map(m => m[1]!)
}

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
        const efforts = suggestion.efforts
        expect(efforts, `${entry.id} x ${api}`).toBeDefined()
        // Knowledge-base entries always carry a dict here; the `false` arm
        // of the union only exists for explicit endpoint refusals.
        assertEffortsShape(efforts as ReasoningEfforts)
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

  it('declares only pi-ai request modalities, always including text', () => {
    // Mechanically pinned against the INSTALLED core adapter (see
    // coreModalities): this is the drift gate made executable.
    expect([...INPUT_MODALITIES]).toEqual(coreModalities())
    for (const entry of KNOWLEDGE_BASE) {
      if (entry.input === undefined) continue
      expect(entry.input.length, entry.id).toBeGreaterThan(0)
      expect(entry.input, entry.id).toContain('text')
      for (const modality of entry.input) {
        expect([...INPUT_MODALITIES], entry.id + ': "' + modality + '"').toContain(modality)
      }
    }
  })

  it('never suggests a modality outside the vocabulary', () => {
    for (const entry of KNOWLEDGE_BASE) {
      const suggestion = suggestEfforts(entry.patterns[0]!, {})
      for (const modality of suggestion.input ?? []) {
        expect([...INPUT_MODALITIES], entry.id + ': "' + modality + '"').toContain(modality)
      }
    }
  })
})
