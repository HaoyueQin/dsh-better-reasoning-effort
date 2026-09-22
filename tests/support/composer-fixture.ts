/**
 * Shared client-apply fixtures: the settings-join / remote / directory /
 * context doubles used by client.spec.tsx and composer-menu.spec.tsx.
 *
 * Deliberately NOT a spec file: importing a spec would re-register its
 * describe/it blocks in the importer, double-counting them and sharing
 * module state across files.
 */

import { vi } from 'vitest'
import { PI_AI_NS } from '../../src/constants.js'
import { en, zh } from '../../src/client/locales.js'
import type { ModelDirectoryLike, ModelDirectoryStateLike, RemoteApi, SettingsJoin } from '../../src/client/types.js'

/** A settings join shaped like the real wire view. */
export function makeJoin(providers: Record<string, unknown>, userProviders?: Record<string, unknown>): SettingsJoin {
  return {
    // The SettingsNamespaceView pins value/user to JsonValue; the fixtures
    // are plain JSON shapes, so the view asserts once instead of per-field.
    namespace: {
      autoGenerate: true,
      ns: PI_AI_NS,
      schema: {},
      value: { providers },
      // The write baseline is the RAW user layer, so a fixture that exercises
      // the running auto-fill (or any write) mirrors the document into it.
      user: userProviders === undefined ? {} : { providers: userProviders },
      revision: 1,
      applies: 'live',
      secrets: [],
    } as unknown as SettingsJoin['namespace'],
    writable: true,
  }
}

export const JOIN_FIXTURE: Record<string, unknown> = {
  aliyun: {
    displayName: 'Aliyun',
    api: 'openai-completions',
    models: [
      { id: 'qwen-max', name: 'Qwen Max' },
      { id: 'qwen-turbo' },
    ],
  },
}

/** A Remote face whose describe answer is owned by the test. */
export function fakeApi(describe: () => Promise<SettingsJoin>): RemoteApi & { describeSpy: ReturnType<typeof vi.fn> } {
  const describeSpy = vi.fn(async (): Promise<SettingsJoin> => describe())
  return {
    describeSpy,
    settings: {
      describe: async () => {
        const join = await describeSpy()
        return {
          ok: true,
          value: { writable: join.writable, hasDocument: true, namespaces: join.namespace === undefined ? [] : [join.namespace] },
        }
      },
      mutate: vi.fn(async () => ({ ok: true, value: undefined })),
    },
  } as unknown as RemoteApi & { describeSpy: ReturnType<typeof vi.fn> }
}

/** A directory fixture: the current model advertises five effort levels. */
export function directoryFixture(): ModelDirectoryLike & { update: (next: ModelDirectoryStateLike) => void } {
  let state: ModelDirectoryStateLike = {
    current: { provider: 'aliyun', model: 'qwen-max', reasoningEffort: 'medium' },
    routable: true,
    groups: [{
      id: 'aliyun',
      name: 'Aliyun',
      models: [{
        id: 'qwen-max',
        name: 'Qwen Max',
        reasoning: {
          defaultEffort: 'medium',
          efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
        },
      }],
    }],
    failures: [],
    status: 'ready',
    error: null,
  }
  const listeners = new Set<() => void>()
  return ({
    store: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: (next: ModelDirectoryStateLike) => { state = next },
      update: (fn: (draft: ModelDirectoryStateLike) => void) => { fn(state) },
    },
    load: vi.fn(async () => state),
    select: vi.fn(async (selection: { provider: string; model: string; reasoningEffort?: string }) => {
      state = {
        ...state,
        current: { provider: selection.provider, model: selection.model, ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort } },
      }
      for (const listener of [...listeners]) listener()
    }),
    update: (next: ModelDirectoryStateLike) => {
      state = next
      for (const listener of [...listeners]) listener()
    },
  }) as unknown as ModelDirectoryLike & { update: (next: ModelDirectoryStateLike) => void }
}

/** Minimal cordis client context face capturing what apply() touches. */
export function makeCtx(api: RemoteApi, opts?: {
  services?: Record<string, unknown>
  /** Give the fake locale service the shell's LocaleFace pair. */
  localeFace?: boolean
  /** When false, the 'settings.models' namespace is unregistered (bind echoes keys). */
  hostDict?: boolean
}) {
  const disposers: Array<() => void> = []
  const remoteHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const localHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const localeRegister = vi.fn()
  const slotCalls = {
    injected: [] as string[],
    registered: [] as Array<Record<string, unknown>>,
  }
  const t = (key: string): string => (en as Record<string, string>)[key] ?? key
  // The ui-settings-models dictionary values hostLabels() resolves through
  // (verified against the host sources; customRoute is 'Provider
  // ID' in BOTH host languages).
  const hostModelsEn: Record<string, string> = {
    modelAdvanced: 'Capacities',
    modelId: 'Model ID',
    modelName: 'Display name',
    customRoute: 'Provider ID',
    baseUrl: 'Base URL',
    customApi: 'API protocol',
  }
  const hostModelsZh: Record<string, string> = {
    modelAdvanced: '容量',
    modelId: '模型 ID',
    modelName: '显示名称',
    customRoute: 'Provider ID',
    baseUrl: 'API 地址',
    customApi: 'API 协议',
  }
  let active: 'en' | 'zh' = 'en'
  let localeRevision = 0
  const localeListeners = new Set<() => void>()
  const faceBind = (ns: string): ((key: string) => string) => {
    if (ns !== 'settings.models') {
      return key => ((active === 'zh' ? zh : en) as Record<string, string>)[key] ?? key
    }
    // An unregistered namespace makes the host's translate() echo the key.
    if (opts?.hostDict === false) return key => key
    return key => (active === 'zh' ? hostModelsZh : hostModelsEn)[key] ?? key
  }
  const track = (
    map: Map<string, Set<(payload: unknown) => void>>,
    event: string,
    cb: (payload: unknown) => void,
  ): (() => void) => {
    if (!map.has(event)) map.set(event, new Set())
    map.get(event)!.add(cb)
    return () => { map.get(event)?.delete(cb) }
  }
  const ctx = {
    effect(setup: () => unknown): void {
      const disposer = setup()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
    },
    locale: {
      register: localeRegister,
      bind: opts?.localeFace === true ? faceBind : (() => t) as unknown as typeof faceBind,
      ...(opts?.localeFace === true
        ? {
            getSnapshot: (): { revision: number } => ({ revision: localeRevision }),
            subscribe(fn: () => void): () => void {
              localeListeners.add(fn)
              return () => { localeListeners.delete(fn) }
            },
          }
        : {}),
    },
    get(name: string): unknown {
      return opts?.services?.[name]
    },
    remote: {
      settings: api.settings,
      $on: (event: string, cb: (payload: unknown) => void) => track(remoteHandlers, event, cb),
    },
    slots: {
      inject(name: string, registrar: () => unknown): void {
        slotCalls.injected.push(name)
        registrar()
      },
      register(options: Record<string, unknown>): () => void {
        slotCalls.registered.push(options)
        return () => {}
      },
    },
    on: (event: string, cb: (payload: unknown) => void) => track(localHandlers, event, cb),
  }
  return {
    ctx,
    localeRegister,
    slotCalls,
    switchLocale(next: 'en' | 'zh'): void {
      active = next
      localeRevision += 1
      for (const fn of [...localeListeners]) fn()
    },
    emitRemote(event: string, payload?: unknown): void {
      for (const cb of [...(remoteHandlers.get(event) ?? [])]) cb(payload)
    },
    emitLocal(event: string, payload?: unknown): void {
      for (const cb of [...(localHandlers.get(event) ?? [])]) cb(payload)
    },
    disposeAll(): void {
      for (const disposer of disposers.splice(0)) disposer()
    },
  }
}

/** Poll until the condition holds or the budget expires. */
export async function waitFor(condition: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not reached')
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

