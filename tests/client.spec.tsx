/**
 * Client apply() integration tests: the wiring layer above the injector —
 * locale dictionary registration, stylesheet lifecycle, observer-driven
 * mounting, pushed invalidations (settings/document-updated, connection/reset),
 * and fiber disposal. Runs against jsdom with a hand-built Models page.
 *
 * Every test disposes the fiber in `finally`: a MutationObserver outliving
 * its test would keep re-rendering stale joins over later tests' fresh ones.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PI_AI_NS, PLUGIN_ID, STORE_NS } from '../src/constants.js'
import { en, zh } from '../src/client/locales.js'
import type { RemoteApi, SettingsJoin } from '../src/client/types.js'

/** A settings join shaped like the real wire view. */
function makeJoin(providers: Record<string, unknown>): SettingsJoin {
  return {
    namespace: {
      ns: PI_AI_NS,
      schema: {},
      value: { providers },
      user: {},
      revision: 1,
      applies: 'live',
      secrets: [],
    },
    writable: true,
  }
}

const JOIN_FIXTURE: Record<string, unknown> = {
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
function fakeApi(describe: () => Promise<SettingsJoin>): RemoteApi & { describeSpy: ReturnType<typeof vi.fn> } {
  const describeSpy = vi.fn(async (): Promise<SettingsJoin> => describe())
  return {
    describeSpy,
    settings: {
      describe: async () => {
        const join = await describeSpy()
        return {
          result: {
            ok: true,
            value: { writable: join.writable, hasDocument: true, namespaces: join.namespace === undefined ? [] : [join.namespace] },
          },
        }
      },
      mutate: vi.fn(async () => ({ rpcId: 'fake', result: { ok: true, value: undefined } })),
    },
  } as unknown as RemoteApi & { describeSpy: ReturnType<typeof vi.fn> }
}

/** Minimal cordis client context face capturing what apply() touches. */
function makeCtx(api: RemoteApi) {
  const disposers: Array<() => void> = []
  const remoteHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const localHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const localeRegister = vi.fn()
  const t = (key: string): string => (en as Record<string, string>)[key] ?? key
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
    locale: { register: localeRegister, bind: () => t },
    get(name: string): unknown {
      return name === 'connection' ? { api } : undefined
    },
    remote: {
      $on: (event: string, cb: (payload: unknown) => void) => track(remoteHandlers, event, cb),
    },
    on: (event: string, cb: (payload: unknown) => void) => track(localHandlers, event, cb),
  }
  return {
    ctx,
    localeRegister,
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

type Ctx = Parameters<typeof import('../src/client/index.js').apply>[0]

/** Build an approximation of the official models page section (two rows). */
function buildModelsDom(): HTMLElement {
  const section = document.createElement('div')
  section.className = 'section'
  section.innerHTML = `
    <div class="editor">
      <span class="editorTitle">Aliyun</span>
      <div class="modelEntry">
        <div class="modelRow">
          <input aria-label="Model ID" value="qwen-max" />
          <button aria-label="Capacities 1"></button>
        </div>
        <div class="modelAdvanced" style="display:block">
          <label><span>Context window</span><input /></label>
        </div>
      </div>
      <div class="modelEntry">
        <div class="modelRow">
          <input aria-label="Model ID" value="qwen-turbo" />
          <button aria-label="Capacities 2"></button>
        </div>
        <div class="modelAdvanced" style="display:block">
          <label><span>Context window</span><input /></label>
        </div>
      </div>
    </div>`
  document.body.appendChild(section)
  return section
}

/** Poll until the condition holds or the budget expires. */
async function waitFor(condition: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not reached')
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

function checkboxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.bre-effort-editor input[type="checkbox"]'))
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('client apply()', () => {
  it('registers dictionaries and styles, mounts editors, and cleans up on dispose', async () => {
    let join = makeJoin(structuredClone(JOIN_FIXTURE))
    const api = fakeApi(() => Promise.resolve(join))
    const h = makeCtx(api)
    try {
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)

      // Dictionaries registered under the plugin store namespace.
      expect(h.localeRegister).toHaveBeenCalledWith(STORE_NS, { zh, en })
      // Stylesheet installed under the plugin's styles marker.
      await waitFor(() => document.head.querySelector(`style[data-plugin-styles="${PLUGIN_ID}"]`) !== null)

      // The observer's first scan mounts one editor per model row.
      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)

      h.disposeAll()
      // Fiber disposal removes the stylesheet and unmounts every React root.
      expect(document.head.querySelector(`style[data-plugin-styles="${PLUGIN_ID}"]`)).toBeNull()
      expect(document.querySelectorAll('.bre-effort-editor')).toHaveLength(0)
    } finally {
      h.disposeAll()
    }
  })

  it('re-describes and refreshes editors on a pushed pi-ai document update', async () => {
    const providers: Record<string, unknown> = structuredClone(JOIN_FIXTURE)
    let join = makeJoin(providers)
    const api = fakeApi(() => Promise.resolve(join))
    const h = makeCtx(api)
    try {
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)
      const initialDescribes = api.describeSpy.mock.calls.length

      // An unrelated namespace changes nothing.
      h.emitRemote('settings/document-updated', 'some-other-ns')
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(api.describeSpy.mock.calls.length).toBe(initialDescribes)

      // The saved declaration moves under the rows; the push clears the folded
      // snapshot and the next scan swaps fresh props into the mounted editor.
      ;(providers.aliyun as { models: Array<Record<string, unknown>> }).models[0]!['reasoningEfforts'] = { high: 'high' }
      join = makeJoin(providers)
      h.emitRemote('settings/document-updated', PI_AI_NS)
      await waitFor(() => checkboxes().length >= 7 && checkboxes()[4]!.checked === true)
    } finally {
      h.disposeAll()
    }
  })

  it('refreshes on connection/reset too', async () => {
    const providers: Record<string, unknown> = structuredClone(JOIN_FIXTURE)
    let join = makeJoin(providers)
    const api = fakeApi(() => Promise.resolve(join))
    const h = makeCtx(api)
    try {
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)
      const initialDescribes = api.describeSpy.mock.calls.length

      ;(providers.aliyun as { models: Array<Record<string, unknown>> }).models[0]!['reasoningEfforts'] = false
      join = makeJoin(providers)
      h.emitLocal('connection/reset')
      await waitFor(() => {
        // The disabled banner appears once the editor re-renders over the
        // false declaration.
        const notes = Array.from(document.querySelectorAll('.bre-effort-note'))
        return notes.some(note => note.textContent?.includes('(false)'))
      })
      expect(api.describeSpy.mock.calls.length).toBeGreaterThan(initialDescribes)
    } finally {
      h.disposeAll()
    }
  })
})
