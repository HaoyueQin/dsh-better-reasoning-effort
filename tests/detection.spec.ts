/**
 * Endpoint signal detection tests: the multi-format listing conventions and
 * the tri-state discipline (no signal ≠ explicitly unsupported).
 */

import { describe, expect, it } from 'vitest'
import { analyzeListingEntry, detectModelSignal, findListingEntry } from '../src/detection.js'

describe('analyzeListingEntry', () => {
  it('reads supported_features arrays', () => {
    expect(analyzeListingEntry({ supported_features: ['chat', 'reasoning'] })).toEqual({
      reasoning: true,
      source: 'supported_features',
    })
  })

  it('reads supported_parameters arrays (OpenRouter style)', () => {
    for (const key of ['reasoning', 'include_reasoning', 'reasoning_effort']) {
      expect(analyzeListingEntry({ supported_parameters: ['tools', key] })).toEqual({
        reasoning: true,
        source: 'supported_parameters',
      })
    }
  })

  it('reads boolean flags in every convention', () => {
    expect(analyzeListingEntry({ supports_reasoning: false })).toEqual({ reasoning: false, source: 'supports_reasoning' })
    expect(analyzeListingEntry({ supportsReasoning: true })).toEqual({ reasoning: true, source: 'supportsReasoning' })
    expect(analyzeListingEntry({ can_reason: true })).toEqual({ reasoning: true, source: 'can_reason' })
    expect(analyzeListingEntry({ reasoning: false })).toEqual({ reasoning: false, source: 'reasoning' })
  })

  it('reads top-level effort fields', () => {
    expect(analyzeListingEntry({ reasoning_effort: 'high' })).toEqual({ reasoning: true, source: 'reasoning_effort' })
    expect(analyzeListingEntry({ supports_reasoning_effort: true })).toEqual({
      reasoning: true,
      source: 'reasoning_effort',
    })
    // A null placeholder says nothing — tri-state discipline keeps it unknown.
    expect(analyzeListingEntry({ reasoning_effort: null })).toEqual({ reasoning: 'unknown', source: null })
    // So does an empty-string filler some gateways emit.
    expect(analyzeListingEntry({ reasoning_effort: '' })).toEqual({ reasoning: 'unknown', source: null })
  })

  it('keeps "no signal" distinct from "explicitly unsupported"', () => {
    // A bare OpenAI listing never said anything.
    expect(analyzeListingEntry({ id: 'm', object: 'model', owned_by: 'x' })).toEqual({
      reasoning: 'unknown',
      source: null,
    })
    // An explicit false is a real answer.
    expect(analyzeListingEntry({ supports_reasoning: false }).reasoning).toBe(false)
  })

  it('answers unknown for non-record entries', () => {
    expect(analyzeListingEntry(undefined)).toEqual({ reasoning: 'unknown', source: null })
    expect(analyzeListingEntry('nope')).toEqual({ reasoning: 'unknown', source: null })
  })
})

describe('detectModelSignal', () => {
  const listing = [
    { id: 'plain', object: 'model' },
    { id: 'thinker', supported_parameters: ['reasoning'] },
  ]

  it('finds the entry by id and analyzes it', () => {
    const { found, signal } = detectModelSignal(listing, 'thinker')
    expect(found).toBe(true)
    expect(signal.reasoning).toBe(true)
  })

  it('reports found=false with an unknown signal for absent models', () => {
    const { found, signal } = detectModelSignal(listing, 'ghost')
    expect(found).toBe(false)
    expect(signal.reasoning).toBe('unknown')
  })

  it('tolerates malformed listings', () => {
    expect(findListingEntry(undefined, 'x')).toBeUndefined()
    expect(findListingEntry({ nope: true }, 'x')).toBeUndefined()
    expect(detectModelSignal('junk', 'x').found).toBe(false)
  })
})

describe('modality + capacity disclosures', () => {
  it('reads OpenRouter architecture.input_modalities and context_length', () => {
    const s = analyzeListingEntry({
      id: 'x',
      architecture: { input_modalities: ['Text', 'Image'] },
      context_length: 131072,
    })
    expect(s.input).toEqual(['text', 'image'])
    expect(s.contextLength).toBe(131072)
  })

  it('reads top-level input_modalities and models.dev-style nesting', () => {
    expect(analyzeListingEntry({ input_modalities: ['text'] }).input).toEqual(['text'])
    expect(analyzeListingEntry({ modalities: { input: ['image', 'text'] } }).input).toEqual(['image', 'text'])
  })

  it('maps vision feature flags in every convention', () => {
    expect(analyzeListingEntry({ supported_features: ['vision'] }).input).toEqual(['image'])
    expect(analyzeListingEntry({ capabilities: ['completion', 'vision'] }).input).toEqual(['image'])
    // An explicit refusal ANSWERED: it maps to the text floor (every
    // supported protocol carries text), so fusion can strip an image claim
    // instead of mistaking the refusal for silence.
    expect(analyzeListingEntry({ supports_vision: false }).input).toEqual(['text'])
    expect(analyzeListingEntry({ supportsVision: false }).input).toEqual(['text'])
    expect(analyzeListingEntry({ input_modalities: [] }).input).toEqual(['text'])
    expect(analyzeListingEntry({ supportsVision: true }).input).toEqual(['image'])
  })

  it('reads the nested top_provider.context_length too', () => {
    expect(analyzeListingEntry({ top_provider: { context_length: 200000 } }).contextLength).toBe(200000)
  })

  it('silence stays absent -- never an implicit text-only', () => {
    const s = analyzeListingEntry({ id: 'x', object: 'model' })
    expect(s.input).toBeUndefined()
    expect(s.contextLength).toBeUndefined()
  })
})
