/**
 * Knowledge-base matching and wire-protocol inference tests.
 */

import { describe, expect, it } from 'vitest'
import {
  GENERIC_OPENAI_EFFORTS,
  KNOWLEDGE_BASE,
  inferProtocol,
  matchKnowledgeBase,
  suggestEfforts,
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

  it('matches the dialect on the registrable domain, not the URL text', () => {
    // An aggregator path naming a vendor must stay generic: only the host's
    // registrable domain speaks for the endpoint.
    expect(inferProtocol({ baseURL: 'https://gw.example.com/deepseek/v1' })).toBe('openai-completions')
    expect(inferProtocol({ baseURL: 'https://deepseek.fake-gateway.com/v1' })).toBe('openai-completions')
    expect(inferProtocol({ baseURL: 'https://api.deepseek.com/v1' })).toBe('deepseek')
  })

  it('defaults unknown endpoints to the OpenAI-compatible protocol', () => {
    expect(inferProtocol({ baseURL: 'https://gateway.example.com' })).toBe('openai-completions')
    // pi-ai has no gemini protocol; Gemini gateways speak openai-completions.
    expect(inferProtocol({ baseURL: 'https://generativelanguage.googleapis.com' })).toBe('openai-completions')
    expect(inferProtocol({})).toBe('openai-completions')
    // A malformed URL degrades to the generic ladder instead of throwing.
    expect(inferProtocol({ baseURL: 'not-a-url' })).toBe('openai-completions')
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

  it('fuses the endpoint signal by confidence (L1 over L2 over L4)', () => {
    // L1 explicit "does not reason" outranks even a knowledge-base hit.
    const disabled = suggestEfforts('deepseek-chat', { api: 'openai-completions' }, {
      reasoning: false,
      source: 'supports_reasoning',
    })
    expect(disabled.efforts).toBe(false)
    expect(disabled.confidence).toBe('high')
    expect(disabled.source).toBe('endpoint:supports_reasoning')

    // L2 knowledge base keeps its wire values; the endpoint only reinforces.
    const confirmed = suggestEfforts('qwen-max', {}, { reasoning: true, source: 'can_reason' })
    expect(confirmed.efforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
    expect(confirmed.matched).toBe(true)
    expect(confirmed.confidence).toBe('high')
    expect(confirmed.endpoint).toEqual({ reasoning: true, source: 'can_reason' })

    // Endpoint confirms reasoning but nothing names the levels: medium.
    const inferred = suggestEfforts('mystery-model', {}, { reasoning: true, source: 'reasoning' })
    expect(inferred.matched).toBe(false)
    expect(inferred.confidence).toBe('medium')
    expect(inferred.efforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })

    // Unknown signal changes nothing and stays low without the knowledge base.
    const unknown = suggestEfforts('mystery-model', { api: 'openai-completions' }, {
      reasoning: 'unknown',
      source: null,
    })
    expect(unknown.confidence).toBe('low')
    expect(unknown.endpoint).toEqual({ reasoning: 'unknown', source: null })

    // Omitting the probe entirely keeps the pre-probe behavior and shape.
    const unprobed = suggestEfforts('qwen-max', {})
    expect(unprobed.confidence).toBe('high')
    expect(unprobed.endpoint).toBeUndefined()
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
