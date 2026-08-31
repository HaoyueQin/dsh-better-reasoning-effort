/**
 * Client write-seam (ops) tests: suggestion resolution and per-model writes
 * over a fake settings Remote.
 */

import { describe, expect, it, vi } from 'vitest'
import type { RpcId, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { createEditorApi, effortsOf, inputOf, providersOf } from '../src/client/ops.js'

/** Wrap a result in an RpcResponse with a branded fake rpcId. */
const fakeRpc = <T>(result: RpcResponse<T>['result']): RpcResponse<T> => ({
  rpcId: 'fake' as unknown as RpcId,
  result,
})
import { modelsOf } from '../src/shared.js'
import type { RemoteApi, SettingsNamespaceView } from '../src/client/types.js'

/** A minimal settings Remote that records mutate calls. */
function fakeApi(initial: unknown): {
  api: RemoteApi
  mutates: { ns: string; ops: { op: string; path: string[]; value?: unknown }[] }[]
  namespace(): SettingsNamespaceView | undefined
} {
  // The alpha.2 SettingsNamespaceView pinned value/user to JsonValue while the
  // rc.2 type left them unknown; fixtures are plain JSON shapes, so the view
  // asserts once instead of per-field.
  const namespace = {
    ns: 'llm-pi-ai',
    schema: {},
    value: initial,
    user: initial,
    revision: 7,
    applies: 'live',
    secrets: [],
  } as unknown as SettingsNamespaceView
  const mutates: { ns: string; ops: { op: string; path: string[]; value?: unknown }[] }[] = []
  const api: RemoteApi = {
    settings: {
      async describe() {
        return fakeRpc({ ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace] } })
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
        return fakeRpc({ ok: true, value: namespace })
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
  const ns = {
    ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision: 1, applies: 'live' as const, secrets: [],
  } as unknown as SettingsNamespaceView

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
      expect(reply.suggestion.efforts).toEqual({ off: 'none', low: 'low', high: 'high', max: 'max' })
    }
  })

  it('skips the endpoint probe for a route the document does not hold', async () => {
    // The host probe resolves routes from settings: asking for a create
    // card's typed route would always 400, so the client must not spend
    // the round trip.
    const { api } = fakeApi({ providers: {} })
    const fetchSpy = vi.fn(async () => { throw new Error('probe must not run') })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const editor = createEditorApi(api)
      const reply = await editor.suggest('acme-gateway', 'mystery', undefined, { api: 'openai-completions' })
      expect(reply.ok).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
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
    expect(sink).toHaveBeenCalledWith('acme', 'deepseek-v4-flash-free', { high: 'high' }, undefined, undefined)
    // The suggestion's compat rides the same seam.
    const compat = { thinkingFormat: 'deepseek' as const, supportsReasoningEffort: true }
    staging.stageEfforts('acme', 'deepseek-v4-flash-free', { high: 'high' }, compat)
    expect(sink).toHaveBeenLastCalledWith('acme', 'deepseek-v4-flash-free', { high: 'high' }, compat, undefined)
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

  it('refuses to rewrite a route whose model list carries a malformed row', async () => {
    const malformed = {
      providers: {
        aliyun: {
          displayName: 'Aliyun',
          api: 'openai-completions',
          models: [{ id: 'qwen-max' }, 'broken'],
        },
      },
    }
    const { api, mutates } = fakeApi(malformed)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: false, error: 'invalid-models' })
    expect(mutates).toHaveLength(0)
  })

  it('fails cleanly when the model does not exist', async () => {
    const { api } = fakeApi(initialValue)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('aliyun', 'ghost', { high: 'high' })
    expect(reply).toEqual({ ok: false, error: 'model-not-found' })
  })

  // Both wire codes mean the same refusal: 'settings-conflict' on the rc
  // line, 'settings/conflict' since 0.1.2-alpha.2 (the TypertRemoteFailure ->
  // RemoteError re-coding). The retry must trigger on either.
  it.each(['settings-conflict', 'settings/conflict'])(
    'retries once on a %s using the fresh revision',
    async (conflictCode) => {
      let revision = 7
      let conflictsLeft = 1
      const mutates: Array<{ expectedRevision?: number }> = []
      const api: RemoteApi = {
        settings: {
          async describe() {
            return fakeRpc({ ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision, applies: 'live' as const, secrets: [] }] } })
          },
          async mutate(request) {
            mutates.push(request)
            if (conflictsLeft > 0) {
              conflictsLeft -= 1
              revision += 1 // a concurrent writer moved the namespace
              return fakeRpc({
                ok: false,
                error: {
                  // The rc.2 RpcErrorCode union names only the hyphenated value;
                  // the alpha.2 value is legal at runtime on that kernel line.
                  code: conflictCode as 'settings-conflict',
                  message: 'settings namespace "llm-pi-ai" changed since it was read',
                  details: { ns: 'llm-pi-ai', expected: revision - 1, actual: revision },
                },
              })
            }
            return fakeRpc({ ok: true, value: undefined as unknown as SettingsNamespaceView })
          },
        },
      }
      const editor = createEditorApi(api)
      const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
      expect(reply).toEqual({ ok: true })
      expect(mutates).toHaveLength(2)
      // The retry carried the FRESH revision, not the stale one.
      expect(mutates[1]!.expectedRevision).toBe(8)
    },
  )

  it('surfaces non-conflict write errors without retrying', async () => {
    const api: RemoteApi = {
      settings: {
        async describe() {
          return fakeRpc({ ok: true, value: { writable: true, hasDocument: true, namespaces: [{ ns: 'llm-pi-ai', schema: {}, value: initialValue, user: initialValue, revision: 7, applies: 'live' as const, secrets: [] }] } })
        },
        async mutate() {
          return fakeRpc({
            ok: false,
            error: {
              code: 'settings-rejected',
              message: 'model "qwen-max" sets compat "thinkingFormat", but its api is "openai-responses"',
              details: { ns: 'llm-pi-ai' },
            },
          })
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

  describe('modality writes', () => {
    it('writes modalities in the same mutate and clears an earlier marker', async () => {
      const seeded = {
        providers: {
          aliyun: {
            displayName: 'Aliyun',
            api: 'openai-completions',
            models: [{ id: 'qwen-max', inputUnset: true }],
          },
        },
      }
      const { api, mutates } = fakeApi(seeded)
      const editor = createEditorApi(api)
      const reply = await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' }, undefined, ['text', 'image'])
      expect(reply).toEqual({ ok: true })
      const models = mutates[0].ops[0].value as Array<Record<string, unknown>>
      expect(models[0].input).toEqual(['text', 'image'])
      expect(models[0].inputUnset).toBeUndefined()
    })

    it('null unsets the modality declaration durably', async () => {
      const seeded = {
        providers: {
          aliyun: {
            displayName: 'Aliyun',
            api: 'openai-completions',
            models: [{ id: 'qwen-max', input: ['text', 'image'] }],
          },
        },
      }
      const { api, mutates } = fakeApi(seeded)
      const editor = createEditorApi(api)
      await editor.writeEfforts('aliyun', 'qwen-max', undefined, undefined, null)
      const models = mutates[0].ops[0].value as Array<Record<string, unknown>>
      expect(models[0].input).toBeUndefined()
      expect(models[0].inputUnset).toBe(true)
    })

    it('an omitted intent leaves the stored declaration untouched', async () => {
      const seeded = {
        providers: {
          aliyun: {
            displayName: 'Aliyun',
            api: 'openai-completions',
            models: [{ id: 'qwen-max', input: ['text', 'image'], reasoningEfforts: { high: 'high' } }],
          },
        },
      }
      const { api, mutates } = fakeApi(seeded)
      const editor = createEditorApi(api)
      // Only the effort ladder is re-declared; no input intent travels.
      await editor.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
      const models = mutates[0].ops[0].value as Array<Record<string, unknown>>
      expect(models[0].input).toEqual(['text', 'image'])
      expect(models[0].reasoningEfforts).toEqual({ high: 'high' })
    })

    it("'keep' narrows modalities without touching a never-declared ladder", async () => {
      const seeded = {
        providers: {
          aliyun: {
            displayName: 'Aliyun',
            api: 'openai-completions',
            models: [{ id: 'qwen-max' }],
          },
        },
      }
      const { api, mutates } = fakeApi(seeded)
      const editor = createEditorApi(api)
      // The modality-only apply: the ladder must stay exactly as-was -- no
      // declaration written AND no durable unset marker stamped.
      const reply = await editor.writeEfforts('aliyun', 'qwen-max', 'keep', undefined, ['text'])
      expect(reply).toEqual({ ok: true })
      const models = mutates[0].ops[0].value as Array<Record<string, unknown>>
      expect(models[0].reasoningEfforts).toBeUndefined()
      expect(models[0].reasoningEffortsUnset).toBeUndefined()
      expect(models[0].input).toEqual(['text'])
    })

    it("'keep' with no modality intent is a pure no-op on both parts", async () => {
      const seeded = {
        providers: {
          aliyun: {
            displayName: 'Aliyun',
            api: 'openai-completions',
            models: [{ id: 'qwen-max', reasoningEfforts: false, input: ['text', 'image'] }],
          },
        },
      }
      const { api, mutates } = fakeApi(seeded)
      const editor = createEditorApi(api)
      await editor.writeEfforts('aliyun', 'qwen-max', 'keep')
      const models = mutates[0].ops[0].value as Array<Record<string, unknown>>
      expect(models[0].reasoningEfforts).toBe(false)
      expect(models[0].input).toEqual(['text', 'image'])
    })

    it('inputOf maps the resolved-layer empty array to undefined (inherit)', async () => {
      // The settings descriptor hands the client the RESOLVED layer, where
      // schemastery materializes absent arrays as [] -- llm-pi-ai's own
      // declaredInput reads that as "no answer here". The client must agree,
      // or every undeclared model renders as a phantom text-only declaration.
      expect(inputOf([{ id: 'x', input: [] }], 'x')).toBeUndefined()
      expect(inputOf([{ id: 'x' }], 'x')).toBeUndefined()
      expect(inputOf([{ id: 'x', input: 'garbage' }], 'x')).toBeUndefined()
      expect(inputOf([{ id: 'x', input: ['text'] }], 'x')).toEqual(['text'])
      expect(inputOf([{ id: 'x', input: ['image', 'text'] }], 'x')).toEqual(['image', 'text'])
    })
  })
})
