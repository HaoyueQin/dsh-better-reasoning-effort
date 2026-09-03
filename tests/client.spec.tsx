/**
 * Client apply() integration tests: the wiring layer above the injector —
 * locale dictionary registration, stylesheet lifecycle, observer-driven
 * mounting (row editors, the composer slider, the Models-page toggle),
 * pushed invalidations (settings/document-updated, connection/reset),
 * and fiber disposal. Runs against jsdom with hand-built DOM.
 *
 * Every test disposes the fiber in `finally`: a MutationObserver outliving
 * its test would keep re-rendering stale joins over later tests' fresh ones.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PI_AI_NS, PLUGIN_ID, STORE_NS } from '../src/constants.js'
import { en, zh } from '../src/client/locales.js'
import type { ModelDirectoryLike, ModelDirectoryStateLike, RemoteApi, SettingsJoin } from '../src/client/types.js'

/** A settings join shaped like the real wire view. */
function makeJoin(providers: Record<string, unknown>): SettingsJoin {
  return {
    // The alpha.2 SettingsNamespaceView pinned value/user to JsonValue while
    // the rc.2 type left them unknown; the fixtures are plain JSON shapes, so
    // the view asserts once instead of per-field.
    namespace: {
      ns: PI_AI_NS,
      schema: {},
      value: { providers },
      user: {},
      revision: 1,
      applies: 'live',
      secrets: [],
    } as unknown as SettingsJoin['namespace'],
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
          ok: true,
          value: { writable: join.writable, hasDocument: true, namespaces: join.namespace === undefined ? [] : [join.namespace] },
        }
      },
      mutate: vi.fn(async () => ({ ok: true, value: undefined })),
    },
  } as unknown as RemoteApi & { describeSpy: ReturnType<typeof vi.fn> }
}

/** A directory fixture: the current model advertises five effort levels. */
function directoryFixture(): ModelDirectoryLike & { update: (next: ModelDirectoryStateLike) => void } {
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
function makeCtx(api: RemoteApi, opts?: {
  services?: Record<string, unknown>
  /** Give the fake locale service the shell's LocaleFace pair (rc.2 on). */
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
  // (verified against the rc.2 and alpha.5 sources; customRoute is 'Provider
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

/** The official composer model seat: trigger + open menu (ModelSelect shape). */
function buildComposerMenu(): HTMLElement {
  const card = document.createElement('div')
  card.dataset['composerCard'] = ''
  card.innerHTML = `
    <div class="seatRoot">
      <button type="button" aria-haspopup="menu" aria-expanded="true">Qwen Max</button>
      <div role="menu" aria-label="Model and reasoning effort">
        <button class="cell" role="menuitem">Model</button>
        <button class="cell" role="menuitem">Effort</button>
      </div>
    </div>`
  document.body.appendChild(card)
  return card
}

/** The rc.2 models page add area (no footer slot exists there). */
function buildAddBlock(): HTMLElement {
  const section = document.createElement('div')
  section.className = 'section'
  section.innerHTML = `
    <ul class="rows"><li class="rowCard"><span class="rowName">Aliyun</span></li></ul>
    <div class="addBlock">
      <div class="addActions"><button>Add provider</button><button>Add custom provider</button></div>
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

  it('re-translates mounted copy when the shell language switches (LocaleFace path)', async () => {
    let join = makeJoin(structuredClone(JOIN_FIXTURE))
    const api = fakeApi(() => Promise.resolve(join))
    const h = makeCtx(api, { localeFace: true })
    try {
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)

      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)
      expect(document.body.textContent).toContain('Auto-adapt')

      // The shell switches to Chinese: the revision bumps and every
      // LocaleRefresh subscriber re-renders with the same stable `t`.
      h.switchLocale('zh')
      await waitFor(() => document.body.textContent?.includes('自动适配') === true)
      // The editors survived the switch (the English fallback keeps matching
      // the English DOM anchors) and now render Chinese copy.
      expect(document.querySelectorAll('.bre-effort-editor')).toHaveLength(2)
    } finally {
      h.disposeAll()
    }
  })

  it('anchors with the English fallback when the host ships no models dictionary', async () => {
    let join = makeJoin(structuredClone(JOIN_FIXTURE))
    const api = fakeApi(() => Promise.resolve(join))
    const h = makeCtx(api, { localeFace: true, hostDict: false })
    try {
      // The page renders English aria-labels while bind('settings.models')
      // echoes the key back — hostLabels() must fall back to the English
      // anchors so the editor still mounts.
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)
      expect(document.body.textContent).toContain('Auto-adapt')
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
        // The no-effort-control banner appears once the editor re-renders
        // over the false declaration.
        const notes = Array.from(document.querySelectorAll('.bre-effort-note'))
        return notes.some(note => note.textContent?.includes('No reasoning-effort control'))
      })
      expect(api.describeSpy.mock.calls.length).toBeGreaterThan(initialDescribes)
    } finally {
      h.disposeAll()
    }
  })

  it('keeps the per-row editors on the row DOM bypass under the footer-slot kernel', async () => {
    // The rc.1 Models page ships the sanctioned settings.models.footer slot:
    // the plugin takes it (the slider toggle's seat) — but the per-row
    // editors still mount through the DOM bypass, never under a provider card.
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api)
    try {
      buildModelsDom()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)

      // The footer slot registration happens at apply.
      expect(h.slotCalls.injected).toContain('settings.models.footer')
      expect(h.slotCalls.registered[0]).toMatchObject({ name: 'settings.models.footer', id: PLUGIN_ID + '-slider-toggle' })

      // …but the per-row editors still mount through the DOM bypass.
      await waitFor(() => document.querySelectorAll('.bre-effort-editor').length === 2)
      expect(h.slotCalls.registered.some(entry => entry['name'] === 'settings.models.provider-card')).toBe(false)
    } finally {
      h.disposeAll()
    }
  })

  it('mounts the composer slider into the official model menu and unmounts it on close', async () => {
    const directory = directoryFixture()
    const originalSelect = directory.select
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api, {
      services: {
        sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
        modelDirectories: { directoryFor: () => directory },
      },
    })
    try {
      const card = buildComposerMenu()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)

      // The effort-memory wiretap wraps the shared directory's select as soon
      // as the slider's first scan resolves it.
      await waitFor(() => directory.select !== originalSelect)

      // The slider mounts at the TOP of the official menu, wedged before the
      // official cells — the official trigger itself is never replaced.
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = document.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      expect(wrapper.parentElement?.firstChild).toBe(wrapper)
      expect(document.querySelector('[data-composer-card] button[aria-haspopup="menu"]')).not.toBeNull()
      // The wrapper is created synchronously; the React commit inside it is
      // scheduled, so wait for the range input to land.
      await waitFor(() => wrapper.querySelector('input[type="range"]') !== null)
      const range = wrapper.querySelector<HTMLInputElement>('input[type="range"]')!
      expect(range.value).toBe('2') // medium = index 2 of the fixture's ladder

      // The popover body replicates upstream: slider area + separator + ONE
      // model row (name · current effort ›); the official root cells are
      // hidden because the slider IS the effort control.
      expect(wrapper.querySelector('.bre-menu-separator')).not.toBeNull()
      const row = wrapper.querySelector<HTMLButtonElement>('.bre-model-row')!
      expect(row.querySelector('.bre-model-row-name')?.textContent).toBe('Qwen Max')
      expect(row.querySelector('.bre-model-row-effort')?.textContent).toBe('Medium')
      const cells = Array.from(card.querySelectorAll('[role="menu"] > button[role="menuitem"]'))
      expect(cells).toHaveLength(2)
      for (const cell of cells) expect((cell as HTMLButtonElement).style.display).toBe('none')
      // The hosted menu takes the upstream .re-model-menu width.
      expect(card.querySelector('[role="menu"].bre-model-menu-host')).not.toBeNull()

      // Clicking the replicated row opens the OFFICIAL model list: it must
      // hit the official direct-child cell, NOT recurse into its own row
      // (both carry role=menuitem, so the scope is the menu's direct children).
      const officialCell = card.querySelector<HTMLButtonElement>('[role="menu"] > button[role="menuitem"]')!
      let officialClicks = 0
      officialCell.addEventListener('click', () => { officialClicks += 1 })
      row.click()
      await waitFor(() => officialClicks === 1)

      // Closing the menu (React removes it) unmounts the slider root.
      card.querySelector('[role="menu"]')!.remove()
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') === null)
      expect(directory.select).not.toBe(originalSelect)
    } finally {
      h.disposeAll()
      // Fiber disposal restores the directory's original select.
      expect(directory.select).toBe(originalSelect)
    }
  })

  it('retires the replica body while the official model list pane is open, then restores it', async () => {
    const directory = directoryFixture()
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api, {
      services: {
        sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
        modelDirectories: { directoryFor: () => directory },
      },
    })
    try {
      const card = buildComposerMenu()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = document.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      const menu = card.querySelector<HTMLElement>('[role="menu"]')!

      // The replica row is the user's click target: focus it (a real click
      // focuses the button) BEFORE drilling in.
      const row = wrapper.querySelector<HTMLButtonElement>('.bre-model-row')!
      row.focus()
      expect(document.activeElement).toBe(row)

      // Drill-in: the official pane switch replaces ITS root cells (the
      // wrapper/replica stay in the DOM), so remove only the menu's DIRECT
      // children — a descendant query would also catch the replica row,
      // which is exactly what a real pane switch never does.
      for (const cell of Array.from(menu.children)) {
        if (cell instanceof HTMLButtonElement && cell.getAttribute('role') === 'menuitem') cell.remove()
      }
      menu.insertAdjacentHTML('beforeend', '<button role="menuitemradio">item</button>')
      await waitFor(() => wrapper.style.display === 'none')
      // Focus handoff: the hidden row must not dump focus onto <body> (which
      // the official shell reads as an outside blur and closes the menu). It
      // lands on the menu itself, inside the seat root.
      expect(document.activeElement).toBe(menu)
      expect(menu.tabIndex).toBe(-1)

      // Back to root: the body returns and the (re-created) cells hide again.
      menu.querySelector('[role="menuitemradio"]')?.remove()
      menu.insertAdjacentHTML('beforeend', '<button class="cell" role="menuitem">Model</button><button class="cell" role="menuitem">Effort</button>')
      await waitFor(() => wrapper.style.display === '' && wrapper.parentElement?.firstChild === wrapper)
      const cells = Array.from(menu.children).filter(el => el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem')
      for (const cell of cells) expect((cell as HTMLButtonElement).style.display).toBe('none')
    } finally {
      h.disposeAll()
    }
  })

  it('re-inserts the slider when a React re-render displaces it', async () => {
    const directory = directoryFixture()
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api, {
      services: {
        sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
        modelDirectories: { directoryFor: () => directory },
      },
    })
    try {
      buildComposerMenu()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') !== null)
      // Simulate a pane switch: React replaces the menu's children; the
      // next scan must put the slider back on top.
      const menu = document.querySelector<HTMLElement>('[role="menu"]')!
      menu.innerHTML = '<button class="cell">Effort list</button>'
      await waitFor(() => menu.firstChild instanceof HTMLElement && (menu.firstChild as HTMLElement).dataset['breSlider'] === '1')
    } finally {
      h.disposeAll()
    }
  })

  it('toggling the slider preference off unmounts the composer slider', async () => {
    const directory = directoryFixture()
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api, {
      services: {
        sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
        modelDirectories: { directoryFor: () => directory },
      },
    })
    try {
      buildComposerMenu()
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') !== null)

      const { setSliderEnabled } = await import('../src/client/slider-pref.js')
      setSliderEnabled(false)
      await waitFor(() => document.querySelector('[data-bre-slider="1"]') === null)
      // The host menu box reverts to the official size AND the hidden official
      // cells become visible again (no empty shell while the menu stays open).
      expect(document.querySelector('[role="menu"].bre-model-menu-host')).toBeNull()
      const cells = Array.from(document.querySelectorAll('[role="menu"] > button[role="menuitem"]'))
      for (const cell of cells) expect((cell as HTMLButtonElement).style.display).toBe('')
      setSliderEnabled(true)
    } finally {
      h.disposeAll()
    }
  })

  it('does not DOM-mount the toggle once the rc.1 footer slot is active', async () => {
    const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
    const h = makeCtx(api)
    try {
      const block = buildAddBlock().querySelector<HTMLElement>('.addBlock')!
      const { apply } = await import('../src/client/index.js')
      apply(h.ctx as unknown as Ctx)
      // The slot registration happens at apply; a later scan must not mount
      // a second toggle into the DOM.
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(block.querySelector('.bre-slider-setting')).toBeNull()
    } finally {
      h.disposeAll()
    }
  })
})
