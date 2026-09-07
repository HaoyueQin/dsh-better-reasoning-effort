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
    expect(aliyun.models[0].reasoningEfforts).toEqual({ off: null, high: 'high' })
    // The explicitly-disabled model is untouched.
    expect(aliyun.models[1].reasoningEfforts).toBe(false)
    const deepseek = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).deepseek
    expect(deepseek.models[0].reasoningEfforts).toEqual({ off: 'none', high: 'high', max: 'max' })
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

  it('backfills supportsDeveloperRole:false on declared relay models (issue #2)', () => {
    // The one versioned exception to never-touch-declared: rows whose
    // compat lacks the role pin on a self-hosted relay get exactly that
    // field merged in -- the declaration itself is untouched.
    const patch = buildAutofillPatch({
      suiyue: {
        api: 'openai-completions',
        baseURL: 'https://api.suiyue.site/v1',
        models: [{
          id: 'glm-5.3-flash',
          input: ['text'],
          reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
          compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
        }],
      },
    })
    const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).suiyue.models
    expect(models[0]['reasoningEfforts']).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(models[0]['compat']).toEqual({ thinkingFormat: 'zai', supportsReasoningEffort: true, supportsDeveloperRole: false })
  })

  it('backfill respects explicit values, bare rows, markers, and official hosts', () => {
    // Explicit true stays true; false rows, unset markers, and official
    // bases are never touched -- together they yield no patch at all.
    const quiet = buildAutofillPatch({
      suiyue: {
        api: 'openai-completions',
        baseURL: 'https://api.suiyue.site/v1',
        models: [
          { id: 'a', input: ['text'], reasoningEfforts: { high: 'high' }, compat: { thinkingFormat: 'zai', supportsDeveloperRole: true } },
          { id: 'b', input: ['text'], reasoningEfforts: false },
          { id: 'c', reasoningEffortsUnset: true },
        ],
      },
    })
    expect(quiet).toBeUndefined()
    const official = buildAutofillPatch({
      zhipu: {
        api: 'openai-completions',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        models: [{
          id: 'glm-5.3-flash',
          input: ['text'],
          reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
          compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
        }],
      },
    })
    expect(official).toBeUndefined()
  })

  it('returns undefined when nothing needs filling', () => {
    const allDeclared = {
      route: { models: [{ id: 'a', reasoningEfforts: { high: 'high' } }] },
    }
    expect(buildAutofillPatch(allDeclared)).toBeUndefined()
  })

  it('skips models the user deliberately unset (durable marker)', () => {
    // The editor writes `reasoningEffortsUnset: true` when the user clears
    // the declaration; auto-fill must read that absence as a decision, not a
    // gap — otherwise every "unset" is refilled one event later.
    const unset = { route: { models: [{ id: 'a', reasoningEffortsUnset: true }] } }
    expect(buildAutofillPatch(unset)).toBeUndefined()
    // A model that still declares is unaffected by the marker's existence.
    const mixed = {
      route: {
        models: [
          { id: 'a', reasoningEffortsUnset: true },
          { id: 'b' },
        ],
      },
    }
    const patch = buildAutofillPatch(mixed)
    const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).route.models
    expect(models[0].reasoningEfforts).toBeUndefined()
    expect(models[1].reasoningEfforts).toBeDefined()
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

  it('leaves routes with malformed model rows untouched', () => {
    // The patch rebuilds the models array verbatim; a route carrying a
    // row this builder cannot represent must be skipped, never silently
    // stripped.
    const malformed = { route: { models: [{ id: 'a' }, 'not-an-object'] } }
    expect(buildAutofillPatch(malformed)).toBeUndefined()
    // A healthy sibling route still fills while the malformed one waits.
    const mixed = {
      bad: { models: [{ id: 'x' }, 42] },
      good: { models: [{ id: 'qwen-max' }] },
    }
    const patch = buildAutofillPatch(mixed)
    expect(patch).toBeDefined()
    const routes = patch!.providers as Record<string, unknown>
    expect(routes.bad).toBeUndefined()
    expect(routes.good).toBeDefined()
  })
})
