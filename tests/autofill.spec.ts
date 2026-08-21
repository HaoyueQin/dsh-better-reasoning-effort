/**
 * Autofill patch builder tests (host half).
 */

import { describe, expect, it } from 'vitest'
import { buildAutofillPatch } from '../src/index.js'

describe('buildAutofillPatch', () => {
  const providers = {
    aliyun: {
      displayName: 'Aliyun',
      api: 'openai-completions',
      models: [
        { id: 'qwen-max', name: 'Qwen Max' },
        { id: 'qwen-turbo', name: 'Qwen Turbo', reasoningEfforts: false },
      ],
    },
    deepseek: {
      baseURL: 'https://api.deepseek.com',
      models: [{ id: 'deepseek-chat' }],
    },
    empty: { models: [] },
  }

  it('fills only undeclared models', () => {
    const patch = buildAutofillPatch(providers)
    expect(patch).toBeDefined()
    const aliyun = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).aliyun
    expect(aliyun.models[0].reasoningEfforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
    // The explicitly-disabled model is untouched.
    expect(aliyun.models[1].reasoningEfforts).toBe(false)
    const deepseek = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).deepseek
    expect(deepseek.models[0].reasoningEfforts).toEqual({ off: null, high: 'high', max: 'max' })
    // Routes with no models produce no patch entry.
    expect((patch!.providers as Record<string, unknown>).empty).toBeUndefined()
  })

  it('preserves unrelated model fields', () => {
    const patch = buildAutofillPatch({
      route: { models: [{ id: 'qwen-max', name: 'Qwen Max', contextWindow: 131072 }] },
    })
    const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).route.models
    expect(models[0]['contextWindow']).toBe(131072)
    expect(models[0]['name']).toBe('Qwen Max')
  })

  it('adds a compat block for openai-completions suggestions', () => {
    const patch = buildAutofillPatch({
      route: { api: 'openai-completions', models: [{ id: 'mystery' }] },
    })
    const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).route.models
    expect(models[0]['compat']).toEqual({ thinkingFormat: 'openai', supportsReasoningEffort: true })
  })

  it('withholds compat on protocols whose gate does not take it', () => {
    for (const api of ['openai-responses', 'anthropic-messages']) {
      const patch = buildAutofillPatch({
        route: { api, models: [{ id: 'mystery' }, { id: 'claude-3-5-sonnet' }] },
      })
      const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).route.models
      expect(models[0]['compat']).toBeUndefined()
      expect(models[1]['compat']).toBeUndefined()
    }
  })

  it('returns undefined when nothing needs filling', () => {
    const allDeclared = {
      route: { models: [{ id: 'a', reasoningEfforts: { high: 'high' } }] },
    }
    expect(buildAutofillPatch(allDeclared)).toBeUndefined()
  })

  it('respects the route filter', () => {
    const patch = buildAutofillPatch(providers, route => route === 'deepseek')
    expect((patch!.providers as Record<string, unknown>).aliyun).toBeUndefined()
    expect((patch!.providers as Record<string, unknown>).deepseek).toBeDefined()
  })

  it('ignores models without an id', () => {
    const patch = buildAutofillPatch({ route: { models: [{ name: 'no id' }] } })
    expect(patch).toBeUndefined()
  })
})
