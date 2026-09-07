/**
 * Dual-kernel (0.1.2-rc.1 + 0.1.3) compat tests: new-schema keys, merge writes,
 * downgrade retry, and the provider-level memory tier.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  isSelfHostedEndpoint,
  migrateBudgetAlias,
  sanitizeCompatForProtocol,
  stripNewCompatKeys,
  suggestEfforts,
} from '../src/knowledge.js'
import { buildAutofillPatch } from '../src/index.js'
import { compatOf, createEditorApi } from '../src/client/ops.js'
import { noteProviderLevel, providerLevel, rememberEffort, wireEffortMemory } from '../src/client/effort-memory.js'
import { setSliderEnabled } from '../src/client/slider-pref.js'
import type { RemoteApi, SettingsNamespaceView } from '../src/client/types.js'

describe('isSelfHostedEndpoint', () => {
  it('flags loopback, private LAN, .local and IPv6 literals', () => {
    expect(isSelfHostedEndpoint('http://localhost:8000/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://192.168.1.10:8000/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://10.0.0.5/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://172.20.0.2:8000/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://gpu-box.local/v1')).toBe(true)
    expect(isSelfHostedEndpoint('http://[::1]:8000/v1')).toBe(true)
  })
  it('leaves public endpoints alone', () => {
    expect(isSelfHostedEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isSelfHostedEndpoint('https://api.deepseek.com')).toBe(false)
    expect(isSelfHostedEndpoint(undefined)).toBe(false)
    expect(isSelfHostedEndpoint('not a url')).toBe(false)
  })
})

describe('suggestEfforts budget autofill', () => {
  it('adds thinking_token_budget on self-hosted openai-completions', () => {
    const s = suggestEfforts('qwen-max', { api: 'openai-completions', baseURL: 'http://localhost:8000/v1' })
    expect(s.compat).toMatchObject({ thinkingFormat: 'qwen', thinkingTokenBudgetField: 'thinking_token_budget' })
  })
  it('omits the budget field on public endpoints', () => {
    const s = suggestEfforts('qwen-max', { api: 'openai-completions', baseURL: 'https://api.openai.com/v1' })
    expect(s.compat?.thinkingTokenBudgetField).toBeUndefined()
  })
  it('never emits vllmPriority or supportsMaxOutputTokens from inference', () => {
    const s = suggestEfforts('mystery-model-zzz', { api: 'openai-completions', baseURL: 'http://localhost:8000/v1' })
    expect(s.compat?.vllmPriority).toBeUndefined()
    expect(s.compat?.supportsMaxOutputTokens).toBeUndefined()
  })
})

describe('sanitizeCompatForProtocol', () => {
  it('keeps only forceAdaptiveThinking on anthropic-messages', () => {
    expect(sanitizeCompatForProtocol({ thinkingFormat: 'openai', forceAdaptiveThinking: true }, 'anthropic-messages'))
      .toEqual({ forceAdaptiveThinking: true })
  })
  it('keeps only supportsMaxOutputTokens on openai-responses', () => {
    expect(sanitizeCompatForProtocol({ thinkingFormat: 'openai', supportsMaxOutputTokens: false }, 'openai-responses'))
      .toEqual({ supportsMaxOutputTokens: false })
  })
  it('drops withheld catalog keys everywhere', () => {
    const dirty = { thinkingFormat: 'openai', supportsMidConvoEffort: true } as unknown as Parameters<typeof sanitizeCompatForProtocol>[0]
    expect(sanitizeCompatForProtocol(dirty, 'openai-completions')).toEqual({ thinkingFormat: 'openai' })
  })
})

describe('migrateBudgetAlias / stripNewCompatKeys', () => {
  it('migrates the legacy alias to the explicit 0.1.3 field', () => {
    expect(migrateBudgetAlias({ supportsThinkingTokenBudget: true }))
      .toEqual({ supportsThinkingTokenBudget: true, thinkingTokenBudgetField: 'thinking_token_budget' })
    expect(migrateBudgetAlias({ thinkingTokenBudgetField: 'thinking_budget' }))
      .toEqual({ thinkingTokenBudgetField: 'thinking_budget' })
  })
  it('strips only the three 0.1.3-only keys', () => {
    expect(stripNewCompatKeys({
      thinkingFormat: 'openai',
      thinkingTokenBudgetField: 'thinking_token_budget',
      vllmPriority: 1,
      supportsMaxOutputTokens: true,
    })).toEqual({ thinkingFormat: 'openai' })
  })
})

describe('buildAutofillPatch compat merge', () => {
  it('merges suggestions over stored compat instead of overwriting', () => {
    const patch = buildAutofillPatch({
      route: {
        api: 'openai-completions',
        baseURL: 'http://localhost:8000/v1',
        models: [{ id: 'qwen-max', compat: { vllmPriority: 2 } }],
      },
    })
    const models = (patch!.providers as Record<string, { models: Record<string, unknown>[] }>).route.models
    expect(models[0]['compat']).toMatchObject({ vllmPriority: 2, thinkingFormat: 'qwen', thinkingTokenBudgetField: 'thinking_token_budget' })
  })
})

describe('compatOf', () => {
  it('reads the stored block as a copy', () => {
    const models = [{ id: 'a', compat: { thinkingFormat: 'openai', vllmPriority: 3 } }]
    expect(compatOf(models, 'a')).toEqual({ thinkingFormat: 'openai', vllmPriority: 3 })
    expect(compatOf(models, 'missing')).toBeUndefined()
  })
})

describe('writeEfforts dual-kernel', () => {
  function fakeApi(initial: unknown, failFirstCompatWrite: boolean): { api: RemoteApi; writeCount: () => number } {
    const namespace = {
      ns: 'llm-pi-ai', schema: {}, value: initial, user: initial, revision: 7, applies: 'live', secrets: [],
    } as unknown as SettingsNamespaceView
    let writes = 0
    const api: RemoteApi = {
      settings: {
        async describe() {
          return { ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace] } }
        },
        async mutate(_ns, ops, _rev) {
          writes += 1
          const value = (ops[0] as { value: Record<string, unknown>[] }).value
          const compat = value[0]['compat'] as Record<string, unknown> | undefined
          if (failFirstCompatWrite && writes === 1 && compat !== undefined && 'thinkingTokenBudgetField' in compat) {
            return { ok: false, error: { code: 'settings/rejected', message: 'compat.thinkingTokenBudgetField is not known by this kernel' } }
          }
          namespace.value = { providers: { r: { models: value } } } as unknown as typeof namespace.value
          return { ok: true, value: namespace }
        },
      },
    }
    return { api, writeCount: () => writes }
  }
  it('merges compat over stored keys on write', async () => {
    const initial = { providers: { r: { api: 'openai-completions', models: [{ id: 'a', reasoningEfforts: { high: 'high' }, compat: { vllmPriority: 5 } }] } } }
    const { api } = fakeApi(initial, false)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('r', 'a', { high: 'high' }, { thinkingFormat: 'openai' }, undefined)
    expect(reply).toEqual({ ok: true })
  })
  it('strips 0.1.3-only keys and retries after a compat rejection', async () => {
    const initial = { providers: { r: { api: 'openai-completions', models: [{ id: 'a' }] } } }
    const { api, writeCount } = fakeApi(initial, true)
    const editor = createEditorApi(api)
    const reply = await editor.writeEfforts('r', 'a', { high: 'high' }, { thinkingFormat: 'openai', thinkingTokenBudgetField: 'thinking_token_budget' }, undefined)
    expect(reply).toEqual({ ok: true })
    expect(writeCount()).toBe(2)
  })
})

describe('effort-memory provider tier', () => {
  const LEVELS = (...ids: string[]) => ids.map(id => ({ id, name: id }))
  type Selection = Parameters<Parameters<typeof wireEffortMemory>[0]['select']>[0]
  function fakeDir() {
    const snapshot = {
      current: { provider: 'openai', model: 'other' } as { provider: string; model: string; reasoningEffort?: string },
      routable: true,
      groups: [{ id: 'openai', name: 'O', models: [{ id: 'gpt-5.6', reasoning: { efforts: LEVELS('low', 'medium', 'high') } }] }],
    }
    const submitted: Selection[] = []
    const directory = {
      store: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      select: async (s: Selection): Promise<unknown> => { submitted.push(s); return undefined },
    } as unknown as Parameters<typeof wireEffortMemory>[0]
    const restore = wireEffortMemory(directory)
    return { directory, submitted, snapshot, restore }
  }
  beforeEach(() => { window.localStorage.clear(); setSliderEnabled(true) })
  it('round-trips provider sightings and degrades malformed documents', () => {
    expect(providerLevel('openai', 'gpt-5.6')).toBeUndefined()
    noteProviderLevel('openai', 'gpt-5.6', 'high')
    expect(providerLevel('openai', 'gpt-5.6')).toBe('high')
    noteProviderLevel('openai', 'gpt-5.6', '   ')
    expect(providerLevel('openai', 'gpt-5.6')).toBe('high')
  })
  it('uses a matching provider sighting before the vendor default', async () => {
    noteProviderLevel('openai', 'gpt-5.6', 'high')
    const { directory, submitted, restore } = fakeDir()
    try {
      await directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high' }])
    } finally {
      restore()
    }
  })
  it('ignores a sighting outside the advertised ladder', async () => {
    noteProviderLevel('openai', 'gpt-5.6', 'ultra')
    const { directory, submitted, snapshot, restore } = fakeDir()
    try {
      snapshot.current = { provider: 'openai', model: 'other' }
      await directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' }])
    } finally {
      restore()
    }
  })
  it('prefers remembered levels over provider sightings', async () => {
    rememberEffort('openai', 'gpt-5.6', 'low')
    noteProviderLevel('openai', 'gpt-5.6', 'high')
    const { directory, submitted, snapshot, restore } = fakeDir()
    try {
      snapshot.current = { provider: 'openai', model: 'other' }
      await directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'low' }])
    } finally {
      restore()
    }
  })
})
