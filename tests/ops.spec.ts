/**
 * Client write-seam (ops) tests: suggestion resolution and per-model writes
 * over a fake settings Remote.
 */

import { describe, expect, it } from 'vitest'
import { createEditorApi, effortsOf, modelsOf, providersOf } from '../src/client/ops.js'
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
      api: 'openai',
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

  it('fails cleanly when the model does not exist', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'ghost', { high: 'high' })
    expect(reply).toEqual({ ok: false, error: 'model-not-found' })
  })
})
