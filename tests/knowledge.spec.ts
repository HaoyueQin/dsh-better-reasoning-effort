/**
 * Knowledge-base matching and wire-protocol inference tests.
 */

import { describe, expect, it } from 'vitest'
import {
  GENERIC_OPENAI_EFFORTS,
  KNOWLEDGE_BASE,
  inferProtocol,
  isValidEfforts,
  matchKnowledgeBase,
  suggestEfforts,
  THINKING_LEVELS,
} from '../src/knowledge.js'

describe('matchKnowledgeBase', () => {
  it('matches DeepSeek models by id pattern', () => {
    expect(matchKnowledgeBase('deepseek-chat')?.id).toBe('deepseek-v3')
    expect(matchKnowledgeBase('deepseek-v3.2')?.id).toBe('deepseek-v3')
  })

  it('matches R1 by its API name (deepseek-reasoner)', () => {
    expect(matchKnowledgeBase('deepseek-reasoner')?.id).toBe('deepseek-r1')
  })

  it('matches OpenAI reasoning models', () => {
    expect(matchKnowledgeBase('o3-mini')?.id).toBe('openai-o')
    expect(matchKnowledgeBase('gpt-5.2')?.id).toBe('openai-o')
  })

  it('matches Chinese families by substring', () => {
    expect(matchKnowledgeBase('qwen-max')?.id).toBe('qwen')
    expect(matchKnowledgeBase('glm-4-plus')?.id).toBe('glm')
    expect(matchKnowledgeBase('kimi-k2')?.id).toBe('kimi')
    expect(matchKnowledgeBase('doubao-seed-1.6')?.id).toBe('doubao')
  })

  it('returns undefined for unknown models', () => {
    expect(matchKnowledgeBase('some-random-model')).toBeUndefined()
  })
})

describe('inferProtocol', () => {
  it('prefers the configured api over the url', () => {
    expect(inferProtocol({ api: 'openai-responses', baseURL: 'https://api.openai.com' })).toBe('openai-responses')
  })

  it('falls back to the base URL', () => {
    expect(inferProtocol({ baseURL: 'https://api.deepseek.com' })).toBe('deepseek')
    expect(inferProtocol({ baseURL: 'https://api.anthropic.com' })).toBe('anthropic-messages')
  })

  it('defaults unknown endpoints to the OpenAI-compatible protocol', () => {
    expect(inferProtocol({ baseURL: 'https://gateway.example.com' })).toBe('openai-completions')
    // pi-ai has no gemini protocol; Gemini gateways speak openai-completions.
    expect(inferProtocol({ baseURL: 'https://generativelanguage.googleapis.com' })).toBe('openai-completions')
    expect(inferProtocol({})).toBe('openai-completions')
  })
})

describe('suggestEfforts', () => {
  it('returns the knowledge entry for a known model', () => {
    const suggestion = suggestEfforts('deepseek-chat', {})
    expect(suggestion.matched).toBe(true)
    expect(suggestion.entryId).toBe('deepseek-v3')
    expect(suggestion.efforts).toEqual({ off: null, high: 'high', max: 'max' })
    // No compat without a route protocol: compat is gated per protocol.
    expect(suggestion.compat).toBeUndefined()
  })

  it('gates knowledge-entry compat to the openai-completions protocol', () => {
    const completions = suggestEfforts('deepseek-chat', { api: 'openai-completions' })
    expect(completions.compat).toEqual({ thinkingFormat: 'deepseek', supportsReasoningEffort: true })
    // pi-ai's responses gate offers neither field — a model-level compat
    // there would be refused by assertServiceable at the write.
    const responses = suggestEfforts('deepseek-chat', { api: 'openai-responses' })
    expect(responses.compat).toBeUndefined()
    const anthropic = suggestEfforts('claude-3-5-sonnet', { api: 'anthropic-messages' })
    expect(anthropic.matched).toBe(true)
    expect(anthropic.compat).toBeUndefined()
  })

  it('never suggests a thinkingFormat outside pi-ai vocabulary', () => {
    for (const entry of KNOWLEDGE_BASE) {
      expect(entry.compat?.thinkingFormat).not.toBe('anthropic')
    }
  })

  it('matches by display name as well as id', () => {
    expect(matchKnowledgeBase('gateway-custom', 'DeepSeek V3')?.id).toBe('deepseek-v3')
  })

  it('matches short family tokens only on word boundaries', () => {
    expect(matchKnowledgeBase('o1-mini')?.id).toBe('openai-o')
    expect(matchKnowledgeBase('gpt-o1')?.id).toBe('openai-o')
    expect(matchKnowledgeBase('ko1-pro')).toBeUndefined()
    expect(matchKnowledgeBase('doubao-seed-1-6')?.id).toBe('doubao')
    expect(matchKnowledgeBase('seedling')).toBeUndefined()
  })

  it('infers OpenAI levels for an unknown model on an openai-completions route', () => {
    const suggestion = suggestEfforts('mystery-model', { api: 'openai-completions' })
    expect(suggestion.matched).toBe(false)
    expect(suggestion.efforts).toEqual(GENERIC_OPENAI_EFFORTS)
    expect(suggestion.compat?.thinkingFormat).toBe('openai')
  })

  it('infers deepseek levels on a deepseek route', () => {
    const suggestion = suggestEfforts('mystery-model', { baseURL: 'https://api.deepseek.com' })
    expect(suggestion.efforts).toEqual({ off: null, high: 'high', max: 'max' })
  })

  it('does not write a compat block for a route with no explicit protocol clues', () => {
    const suggestion = suggestEfforts('mystery-model', {})
    expect(suggestion.efforts).toEqual(GENERIC_OPENAI_EFFORTS)
    expect(suggestion.compat).toBeUndefined()
  })
})

describe('isValidEfforts', () => {
  it('accepts a valid dict', () => {
    expect(isValidEfforts({ off: null, high: 'high' })).toBe(true)
  })

  it('rejects non-off levels with null wire', () => {
    expect(isValidEfforts({ high: null })).toBe(false)
  })

  it('rejects empty dicts and unknown levels', () => {
    expect(isValidEfforts({})).toBe(false)
    expect(isValidEfforts({ turbo: 'turbo' })).toBe(false)
  })

  it('accepts false and undefined as inherit/disabled markers', () => {
    expect(isValidEfforts(false)).toBe(true)
    expect(isValidEfforts(undefined)).toBe(true)
  })
})
