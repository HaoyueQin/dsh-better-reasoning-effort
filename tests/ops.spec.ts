/**
 * Client write-seam (ops) tests: suggestion resolution and per-model writes
 * over a fake settings Remote.
 */

import { describe, expect, it, vi } from 'vitest'
import { createEditorApi, effortsOf, providersOf } from '../src/client/ops.js'
import { modelsOf } from '../src/shared.js'
import type { RemoteApi, SettingsNamespaceView } from '../src/client/types.js'

/** A minimal settings Remote that records mutate calls. */
function fakeApi(initial: unknown): {
  api: RemoteApi
  mutates: { ns: string; ops: { op: string; path: string[]; value?: unknown }[] }[]
  namespace(): SettingsNamespaceView | undefined
} {
  const namespace: SettingsNamespaceView = {
    ns: 'llm-pi-ai',
    schema: {},
    value: initial,
    user: initial,
    revision: 7,
    applies: 'live',
    secrets: [],
  }
  const mutates: { ns: string; ops: { op: string; path: string[]; value?: unknown }[] }[] = []
  const api: RemoteApi = {
    settings: {
      async describe() {
        return { rpcId: 'fake', result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace] } } }
      },
      async mutate(request) {
        mutates.push(request)
        // Mutate the fake value so the next read sees the write.
        const providers = (namespace.value as { providers: Record<string, Record<string, unknown>> }).providers
        for (const op of request.ops) {
          if (op.op !== 'set') continue
          const [_, route, key] = op.path
          providers[route][key] = op.value
        }
        return { rpcId: 'fake', result: { ok: true, value: namespace } }
      },
    },
  }
  return { api, mutates, namespace: () => namespace }
}

const initialValue = {
  providers: {
    aliyun: {
      displayName: 'Aliyun',
      api: 'openai-completions',
      models: [
        { id: 'qwen-max', name: 'Qwen Max' },
        { id: 'qwen-turbo' },
      ],
    },
  },
}

describe('providersOf / modelsOf / effortsOf', () => {
  const ns = { ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision: 1, applies: 'live' as const, secrets: [] } satisfies SettingsNamespaceView

  it('reads providers and models as records', () => {
    const providers = providersOf(ns)
    expect(Object.keys(providers)).toEqual(['aliyun'])
    expect(modelsOf(providers, 'aliyun')).toHaveLength(2)
    expect(modelsOf(providers, 'missing')).toEqual([])
  })

  it('reads efforts, including false', () => {
    const withFalse = {
      ...ns,
      value: { providers: { r: { models: [{ id: 'a', reasoningEfforts: false }] } } },
    }
    const providers = providersOf(withFalse)
    expect(effortsOf(modelsOf(providers, 'r'), 'a')).toBe(false)
    expect(effortsOf(modelsOf(providers, 'r'), 'b')).toBeUndefined()
  })
})

describe('createEditorApi', () => {
  it('suggests from the knowledge base for a known model', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.suggest('aliyun', 'qwen-max', 'Qwen Max')
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.suggestion.matched).toBe(true)
      expect(reply.suggestion.source).toBe('qwen')
    }
  })

  it('infers for an unknown model on an openai route', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.suggest('aliyun', 'mystery')
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.suggestion.matched).toBe(false)
      expect(reply.suggestion.efforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
    }
  })

  it('feeds staged facts to inference for a route the document does not hold', async () => {
    // The create card's typed protocol/endpoint stand in for the stored
    // profile: a known family even gets its compat block, gated as usual.
    const { api } = fakeApi({ providers: {} })
    const editor = createEditorApi(api)
    const reply = await editor.suggest('acme-gateway', 'deepseek-v4-flash-free', undefined, {
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.suggestion.matched).toBe(true)
      expect(reply.suggestion.source).toBe('deepseek-v4')
      expect(reply.suggestion.efforts).toEqual({ off: 'off', low: 'low', high: 'high', max: 'max' })
    }
  })

  it('prefers the stored profile over staged facts when both exist', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    // A stale create-card fact must not shadow what the document says for a
    // saved route.
    const reply = await editor.suggest('aliyun', 'qwen-max', undefined, { api: 'anthropic-messages' })
    expect(reply.ok).toBe(true)
    if (reply.ok) expect(reply.suggestion.source).toBe('qwen')
  })

  it('stages through the injected sink and tolerates no sink', async () => {
    const { api } = fakeApi(initialValue)
    const sink = vi.fn()
    const staging = createEditorApi(api, undefined, sink)
    staging.stageEfforts('acme', 'deepseek-v4-flash-free', { high: 'high' })
    expect(sink).toHaveBeenCalledWith('acme', 'deepseek-v4-flash-free', { high: 'high' }, undefined)
    // The suggestion's compat rides the same seam.
    const compat = { thinkingFormat: 'deepseek' as const, supportsReasoningEffort: true }
    staging.stageEfforts('acme', 'deepseek-v4-flash-free', { high: 'high' }, compat)
    expect(sink).toHaveBeenLastCalledWith('acme', 'deepseek-v4-flash-free', { high: 'high' }, compat)
    // An edit-card seam (no sink) is a no-op, not a crash.
    createEditorApi(api).stageEfforts('acme', 'deepseek-v4-flash-free', { high: 'high' })
  })

  it('carries the suggestion compat so the browser path writes what the host fill writes', async () => {
    const { api } = fakeApi({ providers: {} })
    const editor = createEditorApi(api)
    const reply = await editor.suggest('acme-gateway', 'deepseek-v4-flash-free', undefined, {
      api: 'openai-completions',
      baseURL: 'https://gw.example.com/v1',
    })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.suggestion.compat).toEqual({ thinkingFormat: 'deepseek', supportsReasoningEffort: true })
    }
  })

  it('writes the supplied compat alongside the declaration', async () => {
    const { api, mutates } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const compat = { thinkingFormat: 'qwen' as const }
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { off: null, high: 'high' }, compat)
    expect(reply).toEqual({ ok: true })
    const models = mutates[0].ops[0].value as Record<string, unknown>[]
    expect(models[0].reasoningEfforts).toEqual({ off: null, high: 'high' })
    expect(models[0].compat).toEqual({ thinkingFormat: 'qwen' })
  })

  it('leaves an existing compat untouched when the write carries none', async () => {
    const preCompat = {
      providers: {
        aliyun: {
          displayName: 'Aliyun',
          api: 'openai-completions',
          models: [{ id: 'qwen-max', name: 'Qwen Max', compat: { thinkingFormat: 'qwen' } }],
        },
      },
    }
    const { api, mutates } = fakeApi(preCompat)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: true })
    const models = mutates[0].ops[0].value as Record<string, unknown>[]
    expect(models[0].compat).toEqual({ thinkingFormat: 'qwen' })
  })

  it('writes one model through settings.mutate, preserving siblings', async () => {
    const { api, mutates } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { off: null, high: 'high' })
    expect(reply).toEqual({ ok: true })
    expect(mutates).toHaveLength(1)
    const op = mutates[0].ops[0]
    expect(op.path).toEqual(['providers', 'aliyun', 'models'])
    const models = op.value as Record<string, unknown>[]
    expect(models[0].reasoningEfforts).toEqual({ off: null, high: 'high' })
    // The sibling keeps its own fields.
    expect(models[1]).toEqual({ id: 'qwen-turbo' })
    // The mutated value is visible to the next read.
    const after = await editor.suggest('aliyun', 'qwen-max')
    expect(after.ok).toBe(true)
  })

  it('writes false to disable reasoning', async () => {
    const { api, mutates } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-turbo', false)
    expect(reply).toEqual({ ok: true })
    const models = mutates[0].ops[0].value as Record<string, unknown>[]
    expect(models[1].reasoningEfforts).toBe(false)
  })

  it('unset writes the durable marker so auto-fill respects it', async () => {
    const { api, mutates } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', undefined)
    expect(reply).toEqual({ ok: true })
    const models = mutates[0].ops[0].value as Record<string, unknown>[]
    expect(models[0].reasoningEfforts).toBeUndefined()
    expect(models[0].reasoningEffortsUnset).toBe(true)
  })

  it('writing a declaration clears an earlier unset marker', async () => {
    const preUnset = {
      providers: {
        aliyun: {
          displayName: 'Aliyun',
          api: 'openai-completions',
          models: [{ id: 'qwen-max', name: 'Qwen Max', reasoningEffortsUnset: true }],
        },
      },
    }
    const { api, mutates } = fakeApi(preUnset)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: true })
    const models = mutates[0].ops[0].value as Record<string, unknown>[]
    expect(models[0].reasoningEfforts).toEqual({ high: 'high' })
    expect(models[0].reasoningEffortsUnset).toBeUndefined()
  })

  it('fails cleanly when the model does not exist', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'ghost', { high: 'high' })
    expect(reply).toEqual({ ok: false, error: 'model-not-found' })
  })

  it('retries once on a settings-conflict using the fresh revision', async () => {
    let revision = 7
    let conflictsLeft = 1
    const mutates: Array<{ expectedRevision?: number }> = []
    const api: RemoteApi = {
      settings: {
        async describe() {
          return {
            rpcId: 'fake',
            result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision, applies: 'live' as const, secrets: [] }] } },
          }
        },
        async mutate(request) {
          mutates.push(request)
          if (conflictsLeft > 0) {
            conflictsLeft -= 1
            revision += 1 // a concurrent writer moved the namespace
            return {
              rpcId: 'fake',
              result: {
                ok: false,
                error: {
                  code: 'settings-conflict',
                  message: 'settings namespace "llm-pi-ai" changed since it was read',
                  details: { ns: 'llm-pi-ai', expected: revision - 1, actual: revision },
                },
              },
            }
          }
          return { rpcId: 'fake', result: { ok: true, value: undefined } }
        },
      },
    }
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: true })
    expect(mutates).toHaveLength(2)
    // The retry carried the FRESH revision, not the stale one.
    expect(mutates[1]!.expectedRevision).toBe(8)
  })

  it('surfaces non-conflict write errors without retrying', async () => {
    const api: RemoteApi = {
      settings: {
        async describe() {
          return {
            rpcId: 'fake',
            result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision: 7, applies: 'live' as const, secrets: [] }] } },
          }
        },
        async mutate() {
          return {
            rpcId: 'fake',
            result: {
              ok: false,
              error: {
                code: 'settings-rejected',
                message: 'model "qwen-max" sets compat "thinkingFormat", but its api is "openai-responses"',
                details: { ns: 'llm-pi-ai' },
              },
            },
          }
        },
      },
    }
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: false, error: 'model "qwen-max" sets compat "thinkingFormat", but its api is "openai-responses"' })
  })

  it('upgrades confidence to medium when the endpoint probe confirms reasoning', async () => {
    const { api } = fakeApi(initialValue)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: [{ id: 'mystery', supported_features: ['reasoning'] }] }),
    })))
    try {
      const editor = createEditorApi(api)
      const reply = await editor.suggest('aliyun', 'mystery')
      expect(reply.ok).toBe(true)
      if (reply.ok) {
        expect(reply.suggestion.confidence).toBe('medium')
        expect(reply.suggestion.endpoint).toEqual({ reasoning: true, source: 'supported_features' })
        // The endpoint confirms support but names no spellings — the ladder
        // stays the conservative confirmed set.
        expect(reply.suggestion.efforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('degrades to a low-confidence protocol suggestion when the probe fails', async () => {
    const { api } = fakeApi(initialValue)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('probe route absent')
    }))
    try {
      const editor = createEditorApi(api)
      const reply = await editor.suggest('aliyun', 'mystery')
      expect(reply.ok).toBe(true)
      if (reply.ok) {
        expect(reply.suggestion.confidence).toBe('low')
        expect(reply.suggestion.endpoint).toEqual({ reasoning: 'unknown', source: null })
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
