/**
 * Host apply() integration tests against a fake settings service shaped like
 * the REAL SettingsProvider (describe() returns an ARRAY of descriptors —
 * the regression guard for the wire-envelope mixup that used to make every
 * autofill throw), plus the boot-retry schedule for a not-yet-registered
 * pi-ai namespace.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HostCtx = Parameters<typeof import('../src/index.js').apply>[0]

/** A settings service with the real provider's face (narrowed to what apply uses). */
function fakeSettings(providers: Record<string, unknown> | undefined) {
  let revision = 3
  let current = providers
  const updates: Array<{ patch: object; expectedRevision: number | undefined }> = []
  return {
    get(ns: string): unknown {
      return ns === 'llm-pi-ai' && current !== undefined ? { providers: current } : undefined
    },
    describe(): Array<{ ns: string; revision: number }> {
      // Registered namespaces only: before llm-pi-ai registers, the list is empty.
      return current === undefined ? [] : [{ ns: 'llm-pi-ai', revision }]
    },
    async update(ns: string, patch: object, expectedRevision?: number): Promise<void> {
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new Error(`settings namespace "${String(ns)}" changed since it was read (expected ${expectedRevision}, now ${revision})`)
      }
      updates.push({ patch, expectedRevision })
      revision += 1
    },
    updates,
    register(namespace: string, next?: Record<string, unknown>): void {
      void namespace
      if (next !== undefined) current = next
    },
  }
}

/** Minimal cordis context face capturing what apply() touches. */
function fakeHost(settings: ReturnType<typeof fakeSettings>): {
  ctx: HostCtx
  emitUpdated: (ns: unknown) => void
} {
  const listeners: Array<(ns: unknown) => void> = []
  const ctx = {
    inject(deps: string[], cb: (injected: { settings: ReturnType<typeof fakeSettings> }) => void): void {
      if (deps.includes('settings')) cb({ settings })
    },
    effect(setup: () => () => void, _name?: string): void {
      setup()
    },
    on(event: string, cb: (ns: unknown) => void): void {
      if (event === 'settings/updated') listeners.push(cb)
    },
  } as unknown as HostCtx
  return { ctx, emitUpdated: (ns) => { for (const listener of listeners) listener(ns) } }
}

const PROVIDERS = {
  aliyun: {
    displayName: 'Aliyun',
    api: 'openai-completions',
    models: [{ id: 'qwen-max', name: 'Qwen Max' }],
  },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('apply() autofill', () => {
  it('writes the fill through the real service shape, with the optimistic lock', async () => {
    const settings = fakeSettings(PROVIDERS)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    const routes = (settings.updates[0]!.patch as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers
    expect(routes.aliyun.models[0]!['reasoningEfforts']).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
    // The lock carried the revision read at describe() time.
    expect(settings.updates[0]!.expectedRevision).toBe(3)
  })

  it('does nothing when every model already declares efforts', async () => {
    const declared = {
      aliyun: { api: 'openai-completions', models: [{ id: 'qwen-max', reasoningEfforts: false }] },
    }
    const settings = fakeSettings(declared)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(0)
  })

  it('refills after a settings/updated commit for the pi-ai namespace', async () => {
    const settings = fakeSettings({ aliyun: { api: 'openai-completions', models: [] } })
    const { ctx, emitUpdated } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(0)
    // A user edit lands, adding an undeclared model.
    settings.register('llm-pi-ai', PROVIDERS)
    emitUpdated('llm-pi-ai')
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    // Other namespaces never trigger a fill.
    emitUpdated('some-other-ns')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(1)
  })

  it('survives a conflicting write without throwing', async () => {
    const settings = fakeSettings(PROVIDERS)
    // Force the optimistic lock to refuse.
    settings.updates.length = 0
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Bump the revision between describe and update by wrapping update.
    const originalUpdate = settings.update.bind(settings)
    let described = false
    Object.defineProperty(settings, 'update', {
      value: async (ns: string, patch: object, expectedRevision?: number) => {
        if (!described && expectedRevision !== undefined) {
          described = true
          throw new Error(`settings namespace "llm-pi-ai" changed since it was read (expected ${expectedRevision}, now 99)`)
        }
        return originalUpdate(ns, patch, expectedRevision)
      },
    })
    apply(ctx)
    await vi.waitFor(() => { expect(errorSpy).toHaveBeenCalled() })
    expect(errorSpy.mock.calls[0]![0]).toContain('changed since it was read')
  })

  it('retries the boot fill on a bounded schedule while llm-pi-ai is unregistered', async () => {
    vi.useFakeTimers()
    const settings = fakeSettings(undefined)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    // The namespace is still missing after the first pass and several retries.
    await vi.advanceTimersByTimeAsync(2500)
    expect(settings.updates).toHaveLength(0)
    // llm-pi-ai registers; the next scheduled retry fills.
    settings.register('llm-pi-ai', PROVIDERS)
    await vi.advanceTimersByTimeAsync(1500)
    expect(settings.updates).toHaveLength(1)
    // The schedule is bounded: no further writes fire.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(settings.updates).toHaveLength(1)
  })
})
