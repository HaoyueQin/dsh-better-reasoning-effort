/**
 * Knowledge-base matching and wire-protocol inference tests.
 */

import { describe, expect, it } from 'vitest'
import {
  GENERIC_OPENAI_EFFORTS,
  KNOWLEDGE_BASE,
  inferModalitiesFromName,
  inferProtocol,
  matchKnowledgeBase,
  suggestEfforts,
} from '../src/knowledge.js'

describe('matchKnowledgeBase', () => {
  it('matches DeepSeek models by id pattern', () => {
    expect(matchKnowledgeBase('deepseek-chat')?.id).toBe('deepseek-v3')
    expect(matchKnowledgeBase('deepseek-v3.2')?.id).toBe('deepseek-v3')
  })

  it('matches the V4 family, including spellings the catalog never lists', () => {
    // The official catalog ships v4-flash / v4-pro / v4-flash-vision-exp;
    // third-party gateways also serve free/discount spellings off the same
    // stem, which the shared pattern keys.
    expect(matchKnowledgeBase('deepseek-v4-flash')?.id).toBe('deepseek-v4')
    expect(matchKnowledgeBase('deepseek-v4-flash-free')?.id).toBe('deepseek-v4')
    expect(matchKnowledgeBase('deepseek-v4-pro')?.id).toBe('deepseek-v4')
    // The vision experiment keys its own (strictly longer) entry, so the
    // base stem never claims images for it -- and vice versa.
    expect(matchKnowledgeBase('deepseek-v4-flash-vision-exp')?.id).toBe('deepseek-v4-vision')
    const entry = KNOWLEDGE_BASE.find(candidate => candidate.id === 'deepseek-v4')
    // The off spelling is a non-null placeholder: it arms the deepseek
    // format's thinking:disabled branch (pi-ai sends nothing when null,
    // which would leave DeepSeek's default thinking on) -- and spells
    // 'none' so the same map is a legal reasoning.effort value on the
    // Responses API.
    expect(entry?.efforts).toEqual({ off: 'none', low: 'low', high: 'high', max: 'max' })
  })

  it('matches OpenAI reasoning models by generation', () => {
    expect(matchKnowledgeBase('o3-mini')?.id).toBe('openai-o')
    expect(matchKnowledgeBase('gpt-5.2')?.id).toBe('openai-gpt-5-2')
    expect(matchKnowledgeBase('gpt-5.6')?.id).toBe('openai-gpt-5-6')
    expect(matchKnowledgeBase('gpt-5.5')?.id).toBe('openai-gpt-5-5')
    expect(matchKnowledgeBase('claude-opus-4.7')?.id).toBe('anthropic-claude-opus-4-high')
    expect(matchKnowledgeBase('claude-sonnet-4.6')?.id).toBe('anthropic-claude-4-6')
    expect(matchKnowledgeBase('gpt-5.1-codex')?.id).toBe('openai-gpt-5-1-codex')
    expect(matchKnowledgeBase('gpt-5-mini')?.id).toBe('openai-gpt-5')
  })

  it('matches R1 by its API name (deepseek-reasoner)', () => {
    expect(matchKnowledgeBase('deepseek-reasoner')?.id).toBe('deepseek-r1')
  })

  it('matches Chinese families by substring', () => {
    expect(matchKnowledgeBase('qwen-max')?.id).toBe('qwen')
    expect(matchKnowledgeBase('glm-4-plus')?.id).toBe('glm')
    expect(matchKnowledgeBase('kimi-k2')?.id).toBe('kimi')
    expect(matchKnowledgeBase('doubao-seed-1.6')?.id).toBe('doubao')
  })

  it('matches the 2026-09 additions by their strictly longer patterns', () => {
    // Each new entry keys a pattern strictly longer than the family stem it
    // refines, so the family entry never overrides it (longest-boundary-hit
    // wins regardless of entry order).
    expect(matchKnowledgeBase('glm-5.3-flash')?.id).toBe('glm-5-3-flash')
    expect(matchKnowledgeBase('glm-5.3')?.id).toBe('glm-5-3')
    expect(matchKnowledgeBase('qwen3.8-27b')?.id).toBe('qwen-3-8-27b')
    // The org-qualified spelling (Qwen/Qwen3.8-Flash-Next) must still land
    // on the flash-next entry, not the family or flash stems.
    expect(matchKnowledgeBase('Qwen/Qwen3.8-Flash-Next')?.id).toBe('qwen-3-8-flash-next')
    expect(matchKnowledgeBase('qwen3.8-flash')?.id).toBe('qwen-3-8')
    expect(matchKnowledgeBase('qwen3.8-max')?.id).toBe('qwen-3-8')
    expect(matchKnowledgeBase('hy4-preview')?.id).toBe('hunyuan-hy4')
    expect(matchKnowledgeBase('hy-4-preview')?.id).toBe('hunyuan-hy4')
    expect(matchKnowledgeBase('hy3')?.id).toBe('hunyuan-hy3')
  })

  it('returns undefined for unknown models', () => {
    expect(matchKnowledgeBase('some-random-model')).toBeUndefined()
  })

  it('matches the 2026 families this update added', () => {
    expect(matchKnowledgeBase('gemini-3.7-flash')?.id).toBe('google-gemini')
    expect(matchKnowledgeBase('gemini-2.5-pro')?.id).toBe('google-gemini')
    // grok-4.7 does not exist upstream (404, re-checked 2026-08-24) and
    // was removed from the entry patterns.
    expect(matchKnowledgeBase('grok-4.6')?.id).toBe('xai-grok-high')
    expect(matchKnowledgeBase('grok-4.5')?.id).toBe('xai-grok-4-5')
    expect(matchKnowledgeBase('grok-4.3')?.id).toBe('xai-grok-4-3')
    expect(matchKnowledgeBase('claude-fable-5')?.id).toBe('anthropic-claude-5')
    expect(matchKnowledgeBase('claude-opus-5')?.id).toBe('anthropic-claude-5')
    expect(matchKnowledgeBase('claude-sonnet-4.5')?.id).toBe('anthropic-claude')
    expect(matchKnowledgeBase('glm-5.3')?.id).toBe('glm-5-3')
    expect(matchKnowledgeBase('glm-5.2')?.id).toBe('glm-5-2')
    expect(matchKnowledgeBase('kimi-k3')?.id).toBe('kimi-k3')
    // kimi-k2.6 belongs to the vision-capable K2.5+ generation.
    expect(matchKnowledgeBase('kimi-k2.6')?.id).toBe('kimi-k2-vision')
    expect(matchKnowledgeBase('kimi-k2-thinking')?.id).toBe('kimi')
    expect(matchKnowledgeBase('hy3-preview')?.id).toBe('hunyuan-hy3')
    // The 3.6/3.7 vision generation keys its own entry.
    expect(matchKnowledgeBase('step-3.7-flash')?.id).toBe('step-3-7')
    expect(matchKnowledgeBase('step-3.5-flash')?.id).toBe('step-3-5')
    expect(matchKnowledgeBase('magistral-medium-1.2')?.id).toBe('mistral-magistral')
    expect(matchKnowledgeBase('mistral-medium-3.5')?.id).toBe('mistral-medium-3')
    // MiniMax-M3: official README declares a thinking parameter with
    // enabled/adaptive/disabled -- no effort ladder, but a REAL toggle that
    // the deepseek-shaped declaration expresses honestly.
    expect(matchKnowledgeBase('MiniMax-M3')?.id).toBe('minimax-m3')
    expect(matchKnowledgeBase('gpt-5.4-pro')?.id).toBe('openai-gpt-5-4')
    expect(matchKnowledgeBase('gpt-5.3-codex')?.id).toBe('openai-gpt-5-3')
    expect(matchKnowledgeBase('gpt-5.2-chat')?.id).toBe('openai-chat')
    expect(matchKnowledgeBase('gpt-chat-latest')?.id).toBe('openai-chat')
    expect(matchKnowledgeBase('gpt-oss-120b')?.id).toBe('openai-gpt-oss')
    expect(matchKnowledgeBase('kimi-k2.7-code')?.id).toBe('kimi-k27-code')
    expect(matchKnowledgeBase('kimi-k2.5')?.id).toBe('kimi-k2-vision')
  })

  it('keeps verified 2026-08 corrections and additions', () => {
    // gpt-5.2-codex: official page names low/medium/high/xhigh only -- no
    // none -- so it must NOT inherit the plain gpt-5.2 entry's off.
    const codex = matchKnowledgeBase('gpt-5.2-codex')
    expect(codex?.id).toBe('openai-gpt-5-2-codex')
    expect(codex?.efforts).toEqual({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(codex?.efforts).not.toHaveProperty('off')
    // The plain 5.2 keeps its none.
    expect(matchKnowledgeBase('gpt-5.2')?.id).toBe('openai-gpt-5-2')
    // gpt-4.1 (and every variant) is text+image, non-reasoning -- the old
    // "nano text-only" reading was wrong.
    const g41 = matchKnowledgeBase('gpt-4.1')
    expect(g41?.id).toBe('openai-gpt-4-1')
    expect(g41?.efforts).toBe(false)
    expect(g41?.input).toEqual(['text', 'image'])
    expect(matchKnowledgeBase('gpt-4.1-nano')?.id).toBe('openai-gpt-4-1')
    // gpt-4-turbo takes images; the preview snapshot stays text-only.
    expect(matchKnowledgeBase('gpt-4-turbo')?.id).toBe('openai-gpt-4-turbo')
    expect(matchKnowledgeBase('gpt-4-turbo-preview')?.id).toBe('openai-gpt-4-turbo-preview')
    expect(matchKnowledgeBase('gpt-4-turbo-preview')?.input).toEqual(['text'])
    // chat snapshots carry images per official model pages.
    expect(matchKnowledgeBase('gpt-5.2-chat-latest')?.id).toBe('openai-chat')
    expect(matchKnowledgeBase('gpt-5.2-chat-latest')?.input).toEqual(['text', 'image'])
    // claude: mythos-preview lacks xhigh; opus-4-5 tops at high; the rest of
    // the 3.x/4.5 line declares no effort control.
    expect(matchKnowledgeBase('claude-mythos-preview')?.id).toBe('anthropic-claude-mythos-preview')
    expect(matchKnowledgeBase('claude-mythos-preview')?.efforts).not.toHaveProperty('xhigh')
    expect(matchKnowledgeBase('claude-opus-4-5')?.id).toBe('anthropic-claude-opus-4-5')
    expect(matchKnowledgeBase('claude-sonnet-4-5')?.id).toBe('anthropic-claude')
    expect(matchKnowledgeBase('claude-sonnet-4-5')?.efforts).toBe(false)
    expect(matchKnowledgeBase('claude-sonnet-5')?.id).toBe('anthropic-claude-5')
    // grok-4.3 documents none/low/medium/high/xhigh per the official models
    // page JSON (xhigh joined after the 2026-08 pass; defaultEffort is low).
    expect(matchKnowledgeBase('grok-4.3')?.efforts).toEqual({ off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(matchKnowledgeBase('grok-4.3')?.defaultEffort).toBe('low')
    // qwen3.8-max is multimodal per Alibaba's catalog; mistral-small-2603
    // (Mistral Small 4) is the reasoning_effort model; GLM-4.5V is a vision
    // line member; hy3's 256K is on the official README.
    expect(matchKnowledgeBase('qwen3.8-max')?.id).toBe('qwen-3-8')
    expect(matchKnowledgeBase('qwen3.8-max')?.input).toEqual(['text', 'image'])
    expect(matchKnowledgeBase('mistral-small-2603')?.id).toBe('mistral-medium-3')
    expect(matchKnowledgeBase('mistral-medium-3-5')?.id).toBe('mistral-medium-3')
    expect(matchKnowledgeBase('mistral-medium-3.1')?.id).toBeUndefined()
    expect(matchKnowledgeBase('glm-4.5v')?.id).toBe('glm-vision')
    expect(matchKnowledgeBase('hy3-preview')?.id).toBe('hunyuan-hy3')
    expect(KNOWLEDGE_BASE.find(c => c.id === 'hunyuan-hy3')?.contextWindow).toBe(262_144)
    // Baidu ERNIE: no reasoning_effort on the official surface.
    expect(matchKnowledgeBase('ernie-5.0-thinking-preview')?.id).toBe('baidu-ernie')
    expect(matchKnowledgeBase('ernie-4.5-turbo')?.efforts).toBe(false)
    // Moonshot V1 vision variants declare images (the generic 'moonshot'
    // pattern stays text-only for the plain V1 generation line).
    expect(matchKnowledgeBase('moonshot-v1-128k-vision-preview')?.id).toBe('kimi-moonshot-v1-vision')
    expect(matchKnowledgeBase('moonshot-v1-128k-vision-preview')?.input).toEqual(['text', 'image'])
    expect(matchKnowledgeBase('moonshot-v1-128k')?.id).toBe('kimi')
    // abstract 5.1-codex spin-offs split from the plain 5.1 entry.
    expect(matchKnowledgeBase('gpt-5.1-codex')?.id).toBe('openai-gpt-5-1-codex')
    expect(matchKnowledgeBase('gpt-5.1-codex-max')?.id).toBe('openai-gpt-5-1-codex')
    expect(matchKnowledgeBase('gpt-5.1-codex-mini')?.id).toBe('openai-gpt-5-1-codex')
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
    // 'deepseek.ai' resolves to a Vercel-hosted site (76.76.21.21), not
    // DeepSeek infrastructure -- nothing warrants the native dialect.
    expect(inferProtocol({ baseURL: 'https://deepseek.ai/v1' })).toBe('openai-completions')
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
    expect(suggestion.efforts).toEqual({ off: 'none', high: 'high', max: 'max' })
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

  it('pins forceAdaptiveThinking on anthropic-messages routes for adaptive families only', () => {
    // Adaptive-thinking models declared on the anthropic-messages protocol
    // get the compat that makes pi-ai dispatch efforts as output_config.effort.
    const claude5 = suggestEfforts('claude-sonnet-5', { api: 'anthropic-messages' })
    expect(claude5.compat).toEqual({ forceAdaptiveThinking: true })
    // The same entry on openai-completions keeps its openai-shaped compat.
    const viaOpenai = suggestEfforts('claude-sonnet-5', { api: 'openai-completions' })
    expect(viaOpenai.compat).toEqual({ supportsReasoningEffort: true })
    // Extended-thinking-only families (no effort ladder entry) get nothing.
    const opus45 = suggestEfforts('claude-opus-4-5', { api: 'anthropic-messages' })
    expect(opus45.compat).toBeUndefined()
    // Non-ladder families carry no anthropicAdaptive and stay compat-free.
    const classic = suggestEfforts('claude-3-5-sonnet', { api: 'anthropic-messages' })
    expect(classic.compat).toBeUndefined()
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
    expect(confirmed.efforts).toEqual({ off: null, high: 'high' })
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
    expect(suggestion.efforts).toEqual({ off: 'none', low: 'low', high: 'high', max: 'max' })
  })

  it('does not write a compat block for a route with no explicit protocol clues', () => {
    const suggestion = suggestEfforts('mystery-model', {})
    expect(suggestion.efforts).toEqual(GENERIC_OPENAI_EFFORTS)
    expect(suggestion.compat).toBeUndefined()
  })
})

describe('knowledge base hygiene', () => {
  it('never declares the same normalized pattern twice across entries', () => {
    const seen = new Map<string, string>()
    for (const entry of KNOWLEDGE_BASE) {
      for (const pattern of entry.patterns) {
        const key = normalizePattern(pattern)
        const prior = seen.get(key)
        expect(prior, `pattern "${pattern}" owned by both "${prior}" and "${entry.id}"`).toBeUndefined()
        seen.set(key, entry.id)
      }
    }
  })

  it('declares off only with a valid wire spelling (null or non-empty string)', () => {
    for (const entry of KNOWLEDGE_BASE) {
      if (entry.efforts === false) continue
      const off = entry.efforts.off
      if (off === undefined) continue
      if (off === null) continue
      expect(typeof off, `${entry.id} off spelling must be a string`).toBe('string')
      expect((off as string).length, `${entry.id} off spelling must not be empty`).toBeGreaterThan(0)
    }
  })

  it('wires anthropicAdaptive only on families that declare a real ladder', () => {
    for (const entry of KNOWLEDGE_BASE) {
      if (entry.anthropicAdaptive !== true) continue
      expect(entry.efforts, `${entry.id} declares adaptive thinking without an effort ladder`).not.toBe(false)
    }
  })
})

function normalizePattern(pattern: string): string {
  return pattern.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

describe('modality + capacity fusion', () => {
  const silent = { reasoning: 'unknown' as const, source: null }

  it('carries knowledge-base modalities and reference capacities', () => {
    const s = suggestEfforts('deepseek-v4-flash', {})
    expect(s.input).toEqual(['text'])
    expect(s.inputSource).toBe('knowledge')
    expect(s.contextWindow).toBe(1048576)
    expect(s.maxTokens).toBe(384000)
    expect(s.confidence).toBe('high')
  })

  it('keys the vision experiment to image input', () => {
    expect(suggestEfforts('deepseek-v4-flash-vision-exp', {}).input).toEqual(['text', 'image'])
  })

  it('an endpoint disclosure outranks the knowledge base and drops unmappable members', () => {
    const s = suggestEfforts('deepseek-v4-flash', {}, { ...silent, input: ['text', 'image', 'pdf'] })
    expect(s.input).toEqual(['text', 'image'])
    expect(s.inputSource).toBe('endpoint')
  })

  it('an explicit text-only listing strips an image claim', () => {
    const s = suggestEfforts('deepseek-v4-flash-vision-exp', {}, { ...silent, input: ['text'] })
    expect(s.input).toEqual(['text'])
    expect(s.inputSource).toBe('endpoint')
  })

  it('a disclosure outside the core vocabulary is silence, not text-only', () => {
    const s = suggestEfforts('mystery-model', {}, { ...silent, input: ['audio'] })
    expect(s.input).toBeUndefined()
    expect(s.inputSource).toBeUndefined()
  })

  it('a disclosed context length replaces the reference value', () => {
    const s = suggestEfforts('deepseek-v4-flash', {}, { ...silent, contextLength: 65536 })
    expect(s.contextWindow).toBe(65536)
    expect(s.maxTokens).toBe(384000)
  })

  it('keeps modality parts when the endpoint refuses reasoning', () => {
    const s = suggestEfforts('deepseek-v4-flash', {}, { reasoning: false, source: 'supports_reasoning' })
    expect(s.efforts).toBe(false)
    expect(s.input).toEqual(['text'])
    expect(s.inputSource).toBe('knowledge')
  })

  it('unknown ids fall back to the name heuristic at low confidence', () => {
    const s = suggestEfforts('mystery-vl-7b', {})
    expect(s.input).toEqual(['text', 'image'])
    expect(s.inputSource).toBe('heuristic')
    expect(s.confidence).toBe('low')
    // Capacities are knowledge-base-only: heuristics never invent numbers.
    expect(s.contextWindow).toBeUndefined()
    expect(s.maxTokens).toBeUndefined()
  })

  it('heuristic tokens respect word boundaries', () => {
    expect(inferModalitiesFromName('svelte-latest')).toBeUndefined()
    expect(inferModalitiesFromName('eval-pro')).toBeUndefined()
    expect(inferModalitiesFromName('qwen2.5-vl-72b')).toEqual(['text', 'image'])
  })
})
