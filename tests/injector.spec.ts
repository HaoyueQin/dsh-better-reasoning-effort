/**
 * DOM bypass injector tests: anchor discovery, idempotent mounting, unmount
 * on row removal, full-document scanning (the plugin scans document.body),
 * remounts, and describe-failure recovery. Runs against jsdom with a
 * hand-built approximation of the official Models page DOM.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScanState, effectiveStagedIntents, flushOnUnload, queueWriteInto, reconcile, stageEffortsInto, type EditorMountProps, type InjectorDeps, type MountedEditor, type SettingsJoin } from '../src/client/injection/models-page-editor.js'
import { suggestEfforts, type ReasoningEfforts } from '../src/knowledge.js'
import type { RemoteApi } from '../src/client/types.js'

/** Build an approximation of the official models page section. */
function buildModelsDom(): HTMLElement {
  const section = document.createElement('div')
  section.className = 'section'
  section.innerHTML = `
    <h2>Models</h2>
    <ul class="rows">
      <li class="rowCard">
        <div class="rowHead">
          <span class="rowName">Aliyun</span>
        </div>
        <div class="editor">
          <span class="editorTitle">Aliyun</span>
          <div class="modelCatalog">
            <div class="modelEntry">
              <div class="modelRow">
                <input aria-label="Model ID" value="qwen-max" />
                <input aria-label="Display name" value="Qwen Max" />
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
          </div>
        </div>
      </li>
    </ul>
  `
  document.body.appendChild(section)
  return section
}

/**
 * The one declared route BOTH layers carry. The write baseline is the RAW user
 * layer (the official card's own rule), so a fixture whose user section is
 * empty reads as "no such model" to every write.
 */
const aliyunProviders: NonNullable<SettingsJoin['namespace']>['value'] = {
  aliyun: {
    displayName: 'Aliyun',
    api: 'openai',
    models: [
      { id: 'qwen-max', name: 'Qwen Max' },
      { id: 'qwen-turbo' },
    ],
  },
}

const join: SettingsJoin = {
  namespace: {
    ns: 'llm-pi-ai',
    schema: {},
    value: { providers: aliyunProviders },
    user: { providers: aliyunProviders },
    revision: 1,
    applies: 'live',
    secrets: [],
  },
  writable: true,
}

/**
 * Declare a route in BOTH layers of a join, the way a real save does: facts are
 * read from the resolved `value`, writes land in the raw `user` section, so a
 * fixture that moves only one of them tests nothing.
 * @param local - the join to mutate.
 * @param route - the route key to declare.
 * @param profile - the profile to store.
 */
function declareRoute(local: SettingsJoin, route: string, profile: Record<string, unknown>): void {
  for (const layer of ['value', 'user'] as const) {
    ;(local.namespace![layer] as { providers: Record<string, unknown> }).providers[route] = profile
  }
}

/** One handle reconcile received back from mount(), with its spies. */
interface FakeEditor {
  unmount: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
}

function makeDeps(overrides?: Partial<InjectorDeps>): InjectorDeps & {
  editors: FakeEditor[]
  mutate: ReturnType<typeof vi.fn>
} {
  const editors: FakeEditor[] = []
  const mount = vi.fn<(container: HTMLElement, props: EditorMountProps) => MountedEditor>((container, _props) => {
    // Mirror the real mount: the editor DOM carries the plugin marker, which
    // is what the idempotency guard checks.
    const marker = document.createElement('div')
    marker.dataset['plugin'] = 'dsh-better-reasoning-effort'
    container.appendChild(marker)
    const editor: FakeEditor = {
      unmount: vi.fn(() => { marker.remove() }),
      render: vi.fn(),
    }
    editors.push(editor)
    return editor as unknown as MountedEditor
  })
  const mutate = vi.fn(async (_ns: string, _ops: unknown[], _rev?: number) => ({ ok: true, value: undefined }))
  // The write seam describes through api.settings.describe, not through the
  // injector's describeNamespace — wire both to the same (overridable) read
  // so a test's dynamic document is what a flush sees too.
  const describeNamespace = overrides?.describeNamespace ?? (async () => join)
  const apiFace = {
    settings: {
      describe: async () => {
        const local = await describeNamespace()
        return { ok: true, value: { writable: true, hasDocument: true, namespaces: local.namespace === undefined ? [] : [local.namespace] } }
      },
      mutate,
    },
  } as unknown as RemoteApi
  return {
    api: apiFace,
    describeNamespace,
    t: (key: string) => key,
    // The English anchors, as the real hostLabels() resolves them against the
    // host's 'settings.models' dictionary while English is active (the test
    // DOM below renders the official page in English).
    labels: () => ({
      capacity: ['Capacities'],
      modelId: ['Model ID'],
      modelName: ['Display name'],
      routeId: ['Provider ID'],
      baseUrl: ['Base URL'],
      apiProtocol: ['API protocol'],
      apply: ['Apply'],
      cancel: ['Cancel'],
    }),
    mount,
    editors,
    mutate,
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  // The held-write ledgers ride sessionStorage: without this, one case's
  // queued intent would be restored into the next case's scan state.
  sessionStorage.clear()
})

/** Run reconcile then flush the describe-then-mount microtask chain. */
async function settle(reconcileFn: () => void, state: ReturnType<typeof createScanState>): Promise<void> {
  reconcileFn()
  // The describe promise resolves in a microtask; its .then mounts editors
  // in another. Two ticks cover both.
  await state.describePromise
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * Close the editing surface, then run the IDLE pass. The plugin lands what it
 * held back only once no official card is on the page: writing while one is
 * open is exactly what made the user's own save in that card fail with
 * `settings/conflict`.
 * @param deps - the injection dependencies.
 * @param state - mutable scan state.
 */
async function settleIdle(deps: InjectorDeps, state: ReturnType<typeof createScanState>): Promise<void> {
  document.body.innerHTML = ''
  reconcile(document.body, deps, state)
  // The idle pass drains the queued writes and then the pending flush, each
  // through its own describe → mutate round trip; a macrotask turn lets that
  // whole microtask chain settle.
  await new Promise(resolve => { setTimeout(resolve, 0) })
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

/** Build an approximation of the official create card, typed and draftable. */
function buildCreateDom(route = 'acme-gateway'): HTMLElement {
  const section = document.createElement('div')
  section.className = 'section'
  section.innerHTML = `
    <div class="editor">
      <div class="editorHeader"><span class="editorTitle">Custom provider</span></div>
      <div class="field"><input aria-label="Provider ID" value="${route}" /></div>
      <div class="field"><input aria-label="Base URL" value="https://gw.example.com/v1" /></div>
      <div class="field"><select aria-label="API protocol"><option selected>openai-completions</option></select></div>
      <div class="modelCatalog">
        <div class="modelEntry">
          <div class="modelRow">
            <input aria-label="Model ID" value="deepseek-v4-flash-free" />
            <button aria-label="Capacities 1"></button>
          </div>
          <div class="modelAdvanced" style="display:block">
            <label><span>Context window</span><input /></label>
            <label><span>Max tokens</span><input /></label>
          </div>
        </div>
      </div>
    </div>`
  document.body.appendChild(section)
  return section
}

describe('reconcile', () => {
  it('mounts one editor per model row with the right props', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(deps.mount).mock.calls
    const firstProps = calls[0][1] as EditorMountProps
    expect(firstProps.modelId).toBe('qwen-max')
    expect(firstProps.route).toBe('aliyun')
    expect(firstProps.efforts).toBeUndefined()
    expect(firstProps.readOnly).toBe(false)
    // Row ordinals are real indexes, not a hardcoded 0.
    expect(firstProps.index).toBe(0)
    const secondProps = calls[1][1] as EditorMountProps
    expect(secondProps.modelId).toBe('qwen-turbo')
    expect(secondProps.index).toBe(1)
  })

  it('is idempotent: a second scan does not double-mount', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
  })

  it('refreshes an existing editor when the saved declaration changes under it', async () => {
    // The official page may keep the container node and only move the
    // document under it; the editor must not keep showing a stale saved
    // declaration (its Apply button would never reset).
    const localJoin: SettingsJoin = structuredClone(join)
    const deps = makeDeps({ describeNamespace: async () => localJoin })
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
    expect(deps.editors[0]!.render).not.toHaveBeenCalled()

    const providers = (localJoin.namespace!.value as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers
    providers.aliyun.models[0]!['reasoningEfforts'] = { high: 'high' }
    // The apply()-level invalidation clears the folded snapshot; the next
    // scan re-describes and swaps the fresh props in place.
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)

    expect(deps.mount).toHaveBeenCalledTimes(2)
    expect(deps.editors[0]!.render).toHaveBeenCalledTimes(1)
    const refreshed = vi.mocked(deps.editors[0]!.render).mock.calls[0]![0] as EditorMountProps
    expect(refreshed.efforts).toEqual({ high: 'high' })
    // The untouched row is not re-rendered.
    expect(deps.editors[1]!.render).not.toHaveBeenCalled()
  })

  it('does not re-render editors whose props did not change', async () => {
    // render mutates DOM and DOM mutations schedule scans: without a no-op
    // guard the refresh would feed itself forever.
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
    for (const editor of deps.editors) expect(editor.render).not.toHaveBeenCalled()
  })

  it('unmounts editors whose rows disappeared', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(2)
    // Remove one model row entirely.
    root.querySelectorAll('.modelEntry')[1]?.remove()
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(1)
  })

  it('does not mount when the model id is still empty (mid-edit)', async () => {
    const deps = makeDeps()
    const state = createScanState()
    document.body.innerHTML = `
      <div class="section"><h2>Models</h2>
        <div class="editor"><span class="editorTitle">Aliyun</span>
          <div class="modelEntry">
            <div class="modelRow">
              <input aria-label="Model ID" value="" />
              <button aria-label="Capacities 1"></button>
            </div>
            <div class="modelAdvanced"><label><span>Context window</span><input /></label></div>
          </div>
        </div>
      </div>`
    const root = document.querySelector('.section') as HTMLElement
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).not.toHaveBeenCalled()
  })

  it('skips a row whose route cannot be resolved', async () => {
    const deps = makeDeps({
      describeNamespace: async () => ({ namespace: undefined, writable: true }),
    })
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).not.toHaveBeenCalled()
  })

  it('resolves the route from the editorRoute tag first, then the title', async () => {
    // The official edit card prints the route key as `.editorRoute` beside the
    // display-name title; the create card prints a fixed heading with no key.
    const dom = document.createElement('div')
    dom.className = 'section'
    dom.innerHTML = `
      <div class="editor">
        <div class="editorHeader">
          <span class="editorTitle">Aliyun</span>
          <span class="editorRoute">aliyun</span>
        </div>
        <div class="modelEntry">
          <div class="modelRow">
            <input aria-label="Model ID" value="qwen-max" />
            <button aria-label="Capacities 1"></button>
          </div>
          <div class="modelAdvanced"><label><span>Context window</span><input /></label></div>
        </div>
      </div>
      <div class="editor">
        <div class="editorHeader">
          <span class="editorTitle">Custom provider</span>
        </div>
        <div class="modelEntry">
          <div class="modelRow">
            <input aria-label="Model ID" value="mystery" />
            <button aria-label="Capacities 2"></button>
          </div>
          <div class="modelAdvanced"><label><span>Context window</span><input /></label></div>
        </div>
      </div>`
    document.body.appendChild(dom)
    const root = document.querySelector('.section') as HTMLElement
    const deps = makeDeps()
    const state = createScanState()
    await settle(() => reconcile(root, deps, state), state)
    // The edit card resolves to 'aliyun'; the second card (fixed heading, no
    // key, no Provider ID input) cannot resolve a route and stays unmounted.
    const props = vi.mocked(deps.mount).mock.calls.map(call => call[1] as EditorMountProps)
    expect(props).toHaveLength(1)
    expect(props[0].route).toBe('aliyun')
  })

  it('mounts a provider that never set a display name by its route-key title', async () => {
    // A nameless provider renders its ROUTE KEY as the card title AND hides
    // the .editorRoute tag (the host falls back to the key and only prints the
    // tag while the name differs), so the display-name arm alone can never
    // resolve it: the route must fall back to the title as a route key.
    const nameless: SettingsJoin = structuredClone(join)
    const providers = (nameless.namespace!.value as { providers: Record<string, unknown> }).providers
    delete providers['aliyun']
    providers['opencode-zen'] = {
      api: 'openai-responses',
      baseURL: 'https://opencode.ai/zen/v1',
      models: [{ id: 'muse-spark-1.3-contributor-free' }],
    }
    const deps = makeDeps({ describeNamespace: async () => nameless })
    const state = createScanState()
    document.body.innerHTML = `
      <div class="section">
        <div class="editor">
          <div class="editorHeader"><span class="editorTitle">opencode-zen</span></div>
          <div class="modelCatalog">
            <div class="modelEntry">
              <div class="modelRow">
                <input aria-label="Model ID" value="muse-spark-1.3-contributor-free" />
                <button aria-label="Capacities 1"></button>
              </div>
              <div class="modelAdvanced" style="display:block">
                <label><span>Context window</span><input /></label>
              </div>
            </div>
          </div>
        </div>
      </div>`
    const root = document.querySelector('.section') as HTMLElement
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(1)
    const props = vi.mocked(deps.mount).mock.calls[0]![1] as EditorMountProps
    expect(props.route).toBe('opencode-zen')
    expect(props.staged).toBe(false)
    expect(props.modelId).toBe('muse-spark-1.3-contributor-free')
    expect(props.routeDisplayName).toBe('opencode-zen')
  })

  it('still refuses a title that is neither a route key nor a display name', async () => {
    const deps = makeDeps()
    const state = createScanState()
    document.body.innerHTML = `
      <div class="section">
        <div class="editor">
          <div class="editorHeader"><span class="editorTitle">ghost</span></div>
          <div class="modelCatalog">
            <div class="modelEntry">
              <div class="modelRow">
                <input aria-label="Model ID" value="qwen-max" />
                <button aria-label="Capacities 1"></button>
              </div>
              <div class="modelAdvanced" style="display:block">
                <label><span>Context window</span><input /></label>
              </div>
            </div>
          </div>
        </div>
      </div>`
    const root = document.querySelector('.section') as HTMLElement
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).not.toHaveBeenCalled()
  })

  it('skips the describe read while no capacity rows are present', async () => {
    // Most mutations in a running app fire nowhere near the Models page;
    // the scan gate must not spend a wire read on them.
    const describe = vi.fn(async () => join)
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    document.body.innerHTML = '<div class="chat"><p>streaming…</p></div>'
    reconcile(document.body, deps, state)
    await Promise.resolve()
    await Promise.resolve()
    expect(describe).not.toHaveBeenCalled()
    expect(state.mounted.size).toBe(0)
  })

  it('unmounts editors when the models page disappears, without a wire read', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(2)
    // Navigation replaces the whole section with something else.
    document.body.innerHTML = '<div class="chat"><p>hello</p></div>'
    await settle(() => reconcile(document.body, deps, state), state)
    expect(state.mounted.size).toBe(0)
    for (const editor of deps.editors) expect(editor.unmount).toHaveBeenCalled()
  })

  it('scans a document.body root, matching the plugin\'s real panel root', async () => {
    const deps = makeDeps()
    const state = createScanState()
    buildModelsDom() // appends the section to document.body
    await settle(() => reconcile(document.body, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
  })

  it('retries the describe read after a rejection instead of staying disabled', async () => {
    let healthy = false
    const describe = vi.fn(async () => {
      if (!healthy) throw new Error('wire down')
      return join
    })
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    const root = buildModelsDom()
    reconcile(root, deps, state)
    // reconcile's own rejection handler clears the folded promise.
    await Promise.resolve()
    await Promise.resolve()
    expect(state.describePromise).toBeUndefined()
    expect(deps.mount).not.toHaveBeenCalled()
    // The next scan retries and succeeds.
    healthy = true
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(2)
  })

  it('re-describes after a pushed invalidation clears the folded snapshot', async () => {
    const describe = vi.fn(async () => join)
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(describe).toHaveBeenCalledTimes(1)
    // The apply()-level refresh (settings/document-updated, connection/reset)
    // clears the fold; the next scan must re-read, not reuse the stale join.
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('mounts again when a removed row reappears with a fresh container', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(2)
    root.querySelectorAll('.modelEntry')[0]?.remove()
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(1)
    // A fresh row with the same model id appears.
    const replacement = document.createElement('div')
    replacement.className = 'modelEntry'
    replacement.innerHTML = `
      <div class="modelRow">
        <input aria-label="Model ID" value="qwen-max" />
        <button aria-label="Capacities 1"></button>
      </div>
      <div class="modelAdvanced"><label><span>Context window</span><input /></label></div>`
    root.querySelector('.modelCatalog')?.appendChild(replacement)
    await settle(() => reconcile(root, deps, state), state)
    expect(state.mounted.size).toBe(2)
  })

  it('mounts a staged editor on the create card from its typed route id', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(1)
    const props = vi.mocked(deps.mount).mock.calls[0]![1] as EditorMountProps
    expect(props.route).toBe('acme-gateway')
    expect(props.staged).toBe(true)
    expect(props.modelId).toBe('deepseek-v4-flash-free')
    // The create card's typed facts stand in for the (absent) stored profile.
    expect(props.routeApi).toBe('openai-completions')
    expect(props.routeBaseURL).toBe('https://gw.example.com/v1')
  })

  it('leaves the create card unmounted while its route id is still blank', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildCreateDom('')
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).not.toHaveBeenCalled()
  })

  it('never mistakes a create card for an edit card over a colliding title', async () => {
    // A provider whose display name is literally "Custom provider" must not
    // capture the create card's rows (the create card is marked by its
    // Provider ID input, and wins over the display-name arm).
    const colliding: SettingsJoin = structuredClone(join)
    ;(colliding.namespace!.value as { providers: Record<string, unknown> }).providers['acme'] = {
      displayName: 'Custom provider',
      models: [{ id: 'deepseek-v4-flash-free' }],
    }
    const deps = makeDeps({ describeNamespace: async () => colliding })
    const state = createScanState()
    const root = buildCreateDom('')
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).not.toHaveBeenCalled()
  })

  it('reads a staged row\'s baseline from the pending store', async () => {
    const deps = makeDeps()
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { off: null, low: 'low', high: 'high', max: 'max' })
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    const props = vi.mocked(deps.mount).mock.calls[0]![1] as EditorMountProps
    expect(props.efforts).toEqual({ off: null, low: 'low', high: 'high', max: 'max' })
  })

  it('flushes staged declarations once the route appears in the document', async () => {
    let saved = false
    const describe = vi.fn(async (): Promise<SettingsJoin> => {
      const local = structuredClone(join)
      if (saved) {
        declareRoute(local, 'acme-gateway', {
          api: 'openai-completions',
          models: [{ id: 'deepseek-v4-flash-free' }],
        })
      }
      return local
    })
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { off: null, low: 'low', high: 'high', max: 'max' }, {
      thinkingFormat: 'deepseek',
      supportsReasoningEffort: true,
    })
    // The create card is open (route unsaved): one scan stages, nothing writes.
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()

    // The official save lands the route, but the card is still open: nothing
    // may be written while it holds the document.
    saved = true
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()

    // Closing the card is the idle pass -- now the declaration lands.
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const op = deps.mutate.mock.calls[0]![1][0]
    expect(op.path).toEqual(['providers', 'acme-gateway', 'models'])
    const flushed = op.value as Array<Record<string, unknown>>
    expect(flushed[0]!['reasoningEfforts']).toEqual({ off: null, low: 'low', high: 'high', max: 'max' })
    // The staged compat flushed beside the declaration — the same bytes the
    // host autofill writes.
    expect(flushed[0]!['compat']).toEqual({ thinkingFormat: 'deepseek', supportsReasoningEffort: true })
    // The landed declaration left the pending store.
    expect(state.pending.size).toBe(0)
  })

  it('flips a mounted staged editor to write mode once its route is saved', async () => {
    // A create card whose disclosure container survives the save transition
    // must not keep its editor in staging mode: sameProps compares `staged`
    // so the refresh swaps fresh props (and the Apply contract) in place.
    let saved = false
    const describe = vi.fn(async (): Promise<SettingsJoin> => {
      if (!saved) return join
      const local = structuredClone(join)
      declareRoute(local, 'acme-gateway', {
        displayName: 'acme-gateway',
        api: 'openai-completions',
        models: [{ id: 'deepseek-v4-flash-free' }],
      })
      return local
    })
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { high: 'high' })
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mount).toHaveBeenCalledTimes(1)
    expect((vi.mocked(deps.mount).mock.calls[0]![1] as EditorMountProps).staged).toBe(true)
    expect(deps.editors[0]!.render).not.toHaveBeenCalled()

    // The save lands under the SAME container and the card morphs into its
    // edit view (the Provider ID input is replaced by the printed route tag):
    // the next scan must re-render with staged=false even though every other
    // prop is identical.
    saved = true
    const providerField = Array.from(root.querySelectorAll('.field'))
      .find(field => field.querySelector('input[aria-label="Provider ID"]'))
    providerField?.remove()
    root.querySelector('.editorHeader')?.insertAdjacentHTML('beforeend', '<span class="editorRoute">acme-gateway</span>')
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    await Promise.resolve()
    await Promise.resolve()
    // Not remounted — refreshed in place, out of staging mode.
    expect(deps.mount).toHaveBeenCalledTimes(1)
    expect(deps.editors[0]!.render).toHaveBeenCalledTimes(1)
    const refreshed = vi.mocked(deps.editors[0]!.render).mock.calls[0]![0] as EditorMountProps
    expect(refreshed.staged).toBe(false)
    expect(refreshed.route).toBe('acme-gateway')
    // The staged declaration waits for the card to close: writing while it is
    // open is what used to break the user's own save in that very card.
    expect(deps.mutate).not.toHaveBeenCalled()
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalled()
  })

  it('keeps staged declarations staged when a flush read fails', async () => {
    // flushRoute reads the wire through the live describe seam; when that
    // read rejects (transport down), the rejection must be contained — the
    // declarations stay staged and the next scan retries.
    let calls = 0
    const describe = vi.fn(async (): Promise<SettingsJoin> => {
      calls += 1
      if (calls >= 3) throw new Error('wire down')
      if (calls === 2) {
        const local = structuredClone(join)
        declareRoute(local, 'acme-gateway', {
          api: 'openai-completions',
          models: [{ id: 'deepseek-v4-flash-free' }],
        })
        return local
      }
      return join
    })
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { high: 'high' })
    const root = buildCreateDom('acme-gateway')
    // Scan one: the route is unsaved — stages, no flush, no write.
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()
    // Scan two sees the saved route, but the card is still open so the flush
    // waits. Closing it triggers the idle pass, whose own live read rejects
    // (transport down): the rejection must be contained, and the declaration
    // stays staged for the next pass.
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.size).toBe(1)
    expect(errorSpy.mock.calls[0]![0]).toContain('idle flush failed')
    errorSpy.mockRestore()
  })

  it('drops empty pending routes instead of rescanning them forever', async () => {
    const deps = makeDeps()
    const state = createScanState()
    state.pending.set('acme-gateway', new Map())
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    await settleIdle(deps, state)
    expect(state.pending.has('acme-gateway')).toBe(false)
  })

  it('drops a staged declaration the saved profile already answers', async () => {
    // "Never silently overwrite": a model carrying a declaration (or an unset
    // marker) when its route appears keeps what the document says.
    const answered: SettingsJoin = structuredClone(join)
    declareRoute(answered, 'acme-gateway', {
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4-flash-free', reasoningEfforts: { high: 'high' } }],
    })
    const deps = makeDeps({ describeNamespace: async () => answered })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { low: 'low' })
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.size).toBe(0)
  })

  it('holds an editor Apply while the card is open and lands it on the idle pass', async () => {
    // The regression behind issue #7: a write from inside the open card rides
    // the card's own frozen revision baseline, so the user's NEXT save in that
    // card is refused with `settings/conflict` and their edit reads as lost.
    // The mounted seam therefore queues the intent and nothing commits until
    // the card is gone.
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    await settle(() => reconcile(root, deps, state), state)
    const props = vi.mocked(deps.mount).mock.calls[0]![1] as EditorMountProps

    const reply = await props.api.writeEfforts('aliyun', 'qwen-max', { high: 'high' })
    expect(reply).toEqual({ ok: true, staged: true })
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.get('aliyun')?.get('qwen-max')).toEqual({ efforts: { high: 'high' } })

    // Closing the card replays the very same intent through a holder-less seam.
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const op = deps.mutate.mock.calls[0]![1][0]
    expect(op.path).toEqual(['providers', 'aliyun', 'models'])
    const flushed = (op.value as Array<Record<string, unknown>>).find(model => model['id'] === 'qwen-max')
    expect(flushed!['reasoningEfforts']).toEqual({ high: 'high' })
    // The sibling row rode along untouched, and the queue drained.
    expect((op.value as Array<Record<string, unknown>>).find(model => model['id'] === 'qwen-turbo'))
      .toEqual({ id: 'qwen-turbo' })
    expect(state.queued.size).toBe(0)
  })
})

describe('effectiveStagedIntents (per-part flush decisions)', () => {
  it('keeps the modality part alive when the ladder was taken over mid-window', () => {
    // The realistic race: this plugin's own autofill declares the ladder on
    // the route-creation update -- the staged image toggle must survive it.
    const effective = effectiveStagedIntents(
      { efforts: 'keep', input: ['text', 'image'] },
      { id: 'x', reasoningEfforts: { high: 'high' } },
    )
    expect(effective).toEqual({ efforts: 'keep', input: ['text', 'image'] })
  })

  it('keeps the ladder part alive when modalities were deliberately unset', () => {
    const effective = effectiveStagedIntents(
      { efforts: { high: 'high' }, input: ['text'] },
      { id: 'x', inputUnset: true },
    )
    expect(effective).toEqual({ efforts: { high: 'high' } })
  })

  it('returns null when the model vanished from the saved card', () => {
    expect(effectiveStagedIntents({ efforts: 'keep', input: ['text'] }, undefined)).toBeNull()
  })

  it('returns null when every part was taken over or is a keep', () => {
    expect(
      effectiveStagedIntents(
        { efforts: 'keep', input: ['text'] },
        { id: 'x', reasoningEfforts: false, input: ['text'] },
      ),
    ).toBeNull()
  })

  it('passes a full staged declaration through untouched on a bare row', () => {
    const effective = effectiveStagedIntents(
      { efforts: { high: 'high' }, compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true }, input: ['text', 'image'] },
      { id: 'x' },
    )
    expect(effective).toEqual({
      efforts: { high: 'high' },
      compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
      input: ['text', 'image'],
    })
  })

  it('treats a declaration equal to the autofill footprint as not taken over', () => {
    // The host autofill writes the knowledge base's own suggestion in the
    // route-creation window; those bytes are this plugin's PROPOSAL, not a
    // user decision, so a staged intent must outrank them instead of being
    // withdrawn as "already answered".
    const kb: ReasoningEfforts = { off: 'none', low: 'low', high: 'high', max: 'max' }
    const effective = effectiveStagedIntents(
      { efforts: 'keep', input: ['text', 'image'] },
      { id: 'x', reasoningEfforts: { ...kb }, input: ['text'] },
      { efforts: kb, input: ['text'] },
    )
    expect(effective).toEqual({ efforts: 'keep', input: ['text', 'image'] })
  })

  it('still yields to a hand-tuned declaration that differs from the footprint', () => {
    const effective = effectiveStagedIntents(
      { efforts: { low: 'low' }, input: ['text', 'image'] },
      { id: 'x', reasoningEfforts: { high: 'high' }, input: ['text'] },
      { efforts: { off: 'none', low: 'low', high: 'high', max: 'max' }, input: ['text'] },
    )
    expect(effective).toEqual({ efforts: 'keep', input: ['text', 'image'] })
  })
})

describe('unsaved model rows on a saved route (the model-not-found flow)', () => {
  it('mounts a staged editor for a typed-but-unsaved model row on a saved route', async () => {
    // Adding a model to an EXISTING provider: the row is not in the document
    // yet, so a direct write bounces model-not-found. The editor must stage
    // instead, exactly like the create card, and the flush lands the
    // declaration once the row is saved.
    let saved = false
    const describe = vi.fn(async (): Promise<SettingsJoin> => {
      const local = structuredClone(join)
      if (saved) {
        for (const layer of ['value', 'user'] as const) {
          ;(local.namespace![layer] as { providers: { aliyun: { models: Array<Record<string, unknown>> } } })
            .providers.aliyun.models.push({ id: 'qwen-new' })
        }
      }
      return local
    })
    const deps = makeDeps({ describeNamespace: describe })
    const state = createScanState()
    const root = buildModelsDom()
    const row = [
      '<div class="modelEntry">',
      '  <div class="modelRow">',
      '    <input aria-label="Model ID" value="qwen-new" />',
      '    <input aria-label="Display name" value="Qwen New Display" />',
      '    <button aria-label="Capacities 3"></button>',
      '  </div>',
      '  <div class="modelAdvanced" style="display:block"><label><span>Context window</span><input /></label></div>',
      '</div>',
    ].join('\n')
    root.querySelector('.modelCatalog')?.insertAdjacentHTML('beforeend', row)
    await settle(() => reconcile(root, deps, state), state)
    const props = vi.mocked(deps.mount).mock.calls.map(call => call[1] as EditorMountProps)
    const unsaved = props.find(candidate => candidate.modelId === 'qwen-new')
    expect(unsaved?.staged).toBe(true)
    // The typed Display name rides along: suggestion inference (knowledge-base
    // matching + heuristics) reads it even before the row is saved.
    expect(unsaved?.modelName).toBe('Qwen New Display')

    // The user clicks Apply: the declaration stages; no settings write yet.
    stageEffortsInto(state, 'aliyun', 'qwen-new', { low: 'low' }, undefined, ['text', 'image'])
    // An intermediate scan (the user still editing the card) must NOT
    // withdraw the staging just because the row is not saved yet.
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.get('aliyun')?.has('qwen-new')).toBe(true)

    // The official save lands the row; the card is still open, so the staged
    // parts wait for the idle pass.
    saved = true
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const op = deps.mutate.mock.calls[0]![1][0]
    const flushed = (op.value as Array<Record<string, unknown>>).find(model => model['id'] === 'qwen-new')
    expect(flushed!['reasoningEfforts']).toEqual({ low: 'low' })
    expect(flushed!['input']).toEqual(['text', 'image'])
    expect(state.pending.size).toBe(0)
  })

  it("lets a staged modality choice overwrite the plugin's own autofill footprint", async () => {
    // The realistic loss behind the disappearing image toggle: the host
    // autofill fills the fresh row with the knowledge base's text-only
    // declaration within the route-creation window, and the staged image
    // choice used to be withdrawn as "already answered" a moment later.
    const suggestion = suggestEfforts('deepseek-v4-flash-free', { api: 'openai-completions' })
    expect(suggestion.input).toEqual(['text'])
    const autofilled: SettingsJoin = structuredClone(join)
    declareRoute(autofilled, 'acme-gateway', {
      api: 'openai-completions',
      models: [{
        id: 'deepseek-v4-flash-free',
        reasoningEfforts: suggestion.efforts,
        input: suggestion.input,
        compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
      }],
    })
    const deps = makeDeps({ describeNamespace: async () => autofilled })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', 'keep', undefined, ['text', 'image'])
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const op = deps.mutate.mock.calls[0]![1][0]
    const flushed = (op.value as Array<Record<string, unknown>>)[0]!
    // The staged image choice overwrote the autofill's text-only input...
    expect(flushed['input']).toEqual(['text', 'image'])
    // ...while the 'keep' ladder left the autofilled declaration untouched.
    expect(flushed['reasoningEfforts']).toEqual(suggestion.efforts)
    expect(state.pending.size).toBe(0)
  })
})

describe('ghosted staging recycling', () => {
  it('withdraws staging whose saved-route row disappeared for two consecutive scans', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildModelsDom()
    root.querySelector('.modelCatalog')?.insertAdjacentHTML('beforeend', [
      '<div class="modelEntry">',
      '  <div class="modelRow">',
      '    <input aria-label="Model ID" value="qwen-new" />',
      '    <button aria-label="Capacities 3"></button>',
      '  </div>',
      '  <div class="modelAdvanced" style="display:block"><label><span>Context window</span><input /></label></div>',
      '</div>',
    ].join('\n'))
    stageEffortsInto(state, 'aliyun', 'qwen-new', { low: 'low' }, undefined, ['text'])

    // Scan 1 -- the row is still on the page: no miss, and no flush write
    // (the settings document does not carry the row yet).
    await settle(() => reconcile(root, deps, state), state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.get('aliyun')?.has('qwen-new')).toBe(true)

    // Scan 2 -- FIRST missing scan (the row was removed from the page): the
    // grace round keeps the staging against transient re-render gaps.
    ;(root.querySelectorAll('.modelEntry')[2] as HTMLElement).remove()
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(state.pending.get('aliyun')?.has('qwen-new')).toBe(true)
    expect(deps.mutate).not.toHaveBeenCalled()

    // Scan 3 -- SECOND consecutive missing scan: the ghost is withdrawn,
    // silently and without any wire write behind it.
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    expect(state.pending.get('aliyun')).toBeUndefined()
    expect(deps.mutate).not.toHaveBeenCalled()
  })

  it('never recycles staging on routes that do not exist yet (an open create card)', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildCreateDom('acme-gateway')
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { low: 'low' }, undefined, undefined)

    // Three scans pass while the create card sits mid-edit: its route is not
    // in the document yet, so every scan "misses" it -- but only SAVED routes
    // are eligible for ghost recycling.
    for (let i = 0; i < 3; i++) {
      await settle(() => reconcile(root, deps, state), state)
      state.describePromise = undefined
    }
    expect(state.pending.get('acme-gateway')?.has('deepseek-v4-flash-free')).toBe(true)
    expect(deps.mutate).not.toHaveBeenCalled()
  })
})

describe('held-write ledgers (persistence, retry, the card fence)', () => {
  it('persists both ledgers and restores them into a same-document scan state', () => {
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'new-model', { high: 'high' })
    // The commit evidence must be persisted WITH the held write: the ledger
    // can now carry the premise it previously could not.
    state.committing.add('aliyun')
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    // A plugin-HMR cycle (same document) builds a new scan state: the intents
    // must come back, commit evidence included.
    const restored = createScanState()
    expect(restored.pending.get('acme-gateway')?.get('new-model')).toEqual({ efforts: { high: 'high' } })
    expect(restored.queued.get('aliyun')?.get('qwen-max')).toEqual({ efforts: { high: 'high' } })
    expect(restored.committing.has('aliyun')).toBe(true)
  })

  it('drops a restored held write that carries no commit evidence', () => {
    // A queued edit the user never saved dies with the card (official draft
    // semantics): restoring it without evidence would later resurrect an
    // abandoned edit behind the next Save.
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    const restored = createScanState()
    expect(restored.queued.size).toBe(0)
    expect(restored.committing.size).toBe(0)
  })

  it('discards a ledger written by a previous document (a reload)', () => {
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'new-model', { high: 'high' })
    state.committing.add('aliyun')
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    // A NEW document: the page reloaded, so both ledgers are gone -- the
    // official card's draft would be gone too.
    delete (globalThis as Record<string, unknown>)['__breLedgerDocument']
    const reloaded = createScanState()
    expect(reloaded.pending.size).toBe(0)
    expect(reloaded.queued.size).toBe(0)
  })

  it('lands a restored, committed intent on the first idle pass after an HMR', async () => {
    const seeded = createScanState()
    seeded.committing.add('aliyun')
    queueWriteInto(seeded, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    const deps = makeDeps()
    // Same document: the evidence itself restores the authority to land.
    const reloaded = createScanState()
    await settleIdle(deps, reloaded)

    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(reloaded.queued.size).toBe(0)
  })

  it('flushOnUnload lands the committed intents and clears the ledger', async () => {
    const state = createScanState()
    state.committing.add('aliyun')
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    const deps = makeDeps()
    flushOnUnload(state, deps)
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(deps.mutate).toHaveBeenCalledTimes(1)
    // The FILE is gone: a fresh state restores nothing (even though the
    // landed route had commit evidence).
    expect(createScanState().queued.size).toBe(0)
  })

  it('flushOnUnload lands even while a card was fenced open', async () => {
    const state = createScanState()
    state.committing.add('aliyun')
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    // The last scan saw a card open; the page is now going away, so its frozen
    // baseline no longer matters and the last landing must not be aborted.
    state.flushAbort = true

    const deps = makeDeps()
    flushOnUnload(state, deps)
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(deps.mutate).toHaveBeenCalledTimes(1)
  })

  it('keeps working when sessionStorage refuses the write', () => {
    const refusing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      const state = createScanState()
      expect(() => { queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } }) }).not.toThrow()
      expect(state.queued.get('aliyun')?.get('qwen-max')).toEqual({ efforts: { high: 'high' } })
    } finally {
      refusing.mockRestore()
    }
  })

  it('fences the idle pass while a card with no model row is open', async () => {
    const deps = makeDeps()
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    // An open provider card whose model list is empty: no capacity button
    // exists, but the card's action row does -- and that card still holds a
    // frozen revision baseline (the rarer half of issue #7).
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="editor">
        <div class="modelCatalog"></div>
        <div class="editorActions">
          <button type="button">Cancel</button>
          <button type="button">Apply</button>
        </div>
      </div>
    `
    document.body.appendChild(root)
    await settle(() => reconcile(root, deps, state), state)
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)
  })

  it('aborts an in-flight landing when a card opens during the read', async () => {
    const state = createScanState()
    // The card opens in the window between our read and our mutate: landing
    // now would sit behind its frozen revision baseline (issue #7), so the
    // write must abort and keep the intent for a later pass.
    const deps = makeDeps({
      describeNamespace: async () => {
        state.flushAbort = true
        return join
      },
    })
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)
    expect(state.committing.has('aliyun')).toBe(true)
  })

  it('keeps the commit marker when a flush is refused, so the retry can happen', async () => {
    const deps = makeDeps()
    deps.mutate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'settings/rejected', message: 'refused' },
    })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    // A refusal arrives as a value, not a throw: the intent stays for the
    // retry -- and so must the commit marker that authorizes it. Dropping the
    // marker here is what made a refused write wait forever: the next pass
    // reads the route as "never committed" and lands nothing.
    expect(state.queued.size).toBe(1)
    expect(state.committing.has('aliyun')).toBe(true)

    // The refused pass armed a backoff; let it expire and the retry lands.
    state.nextFlushAt = 0
    await settleIdle(deps, state)
    expect(state.queued.size).toBe(0)
    expect(state.committing.has('aliyun')).toBe(false)
    expect(deps.mutate).toHaveBeenCalledTimes(2)
  })

  it('does not let a spent commit marker authorize a later uncommitted edit', async () => {
    const deps = makeDeps()
    const state = createScanState()
    // The user pressed the official Save but had no plugin edit: the marker is
    // spent. Left behind, it would silently land a LATER edit the user never
    // saved -- the card's Save is the contract, and it must stay spent.
    state.committing.add('aliyun')
    await settleIdle(deps, state)
    expect(state.committing.has('aliyun')).toBe(false)

    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)
  })

  it('backs off after a refused write instead of hammering the wire', async () => {
    const deps = makeDeps()
    deps.mutate.mockResolvedValue({
      ok: false,
      error: { code: 'settings/rejected', message: 'refused' },
    })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    // A refusal is a failure of the PASS, not just of the row: without this
    // counter every later scan retries the same doomed write immediately.
    expect(state.flushFailures).toBeGreaterThan(0)
    expect(state.nextFlushAt).toBeGreaterThan(Date.now())

    // A scan inside the backoff window must not write again.
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(state.queued.size).toBe(1)
  })

  it('never lands the held ledger on a read-only document', async () => {
    // A commit signal is not permission: a memory / non-loopback document
    // refuses writes, and the held ledger must obey the same writability gate
    // the staged ledger already does.
    const deps = makeDeps({ describeNamespace: async () => ({ ...join, writable: false }) })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)
  })

  it('signals a timed retry when a pass arms a backoff', async () => {
    // The backoff clock only helps if something wakes the injector when it
    // expires; a static page has no DOM mutation to trigger the next scan.
    const backoffs: number[] = []
    const deps = makeDeps({ onBackoff: (delay: number) => { backoffs.push(delay) } })
    deps.mutate.mockResolvedValue({ ok: false, error: { code: 'settings/rejected', message: 'refused' } })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    expect(backoffs.length).toBeGreaterThan(0)
    expect(backoffs[0]).toBeGreaterThan(0)
  })

  it('isolates a throwing onIdle hook instead of rejecting the pass', async () => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
    const deps = makeDeps({ onIdle: () => { throw new Error('hook blew up') } })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    state.committing.add('aliyun')

    await settleIdle(deps, state)
    // The write still landed, and the hook failure was reported, not thrown
    // into an unhandled rejection (the pass is void-ed by reconcile).
    expect(state.queued.size).toBe(0)
    expect(errors.some(args => String(args[0]).includes('idle hook failed'))).toBe(true)
    spy.mockRestore()
  })

  it('backs the next attempt off when a whole idle pass throws', async () => {
    const deps = makeDeps({
      describeNamespace: async () => { throw new Error('wire down') },
    })
    const state = createScanState()
    // A staged route the document does not hold yet: the pass reads the
    // namespace first, and that read is what throws here.
    stageEffortsInto(state, 'acme-gateway', 'new-model', { high: 'high' })

    await settleIdle(deps, state)
    expect(state.flushFailures).toBe(1)
    expect(state.nextFlushAt).toBeGreaterThan(0)
    expect(state.pending.size).toBe(1)
  })
})

describe('the official commit signal (C2)', () => {
  /**
   * The official editing card's own DOM shape: the model row (whose capacity
   * button the injector anchors on), then the action row `EditorFooter`
   * renders -- cancel first, commit last.
   */
  function buildActionCardDom(buttons: string): HTMLElement {
    const section = document.createElement('div')
    section.innerHTML = `
      <li class="rowCard">
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
          <div class="editorActions">${buttons}</div>
        </div>
      </li>`
    document.body.appendChild(section)
    return section
  }

  /** Let the click's ledger marker land, then let the scan chain settle. */
  async function tick(): Promise<void> {
    await new Promise(resolve => { setTimeout(resolve, 0) })
  }

  /** Run an idle pass WITHOUT tearing the card down (the fence has to hold). */
  async function settleIdleKeepDom(deps: InjectorDeps, state: ReturnType<typeof createScanState>, root: HTMLElement): Promise<void> {
    reconcile(root, deps, state)
    await tick()
    await tick()
  }

  it('lands the held write once the official commit button was pressed', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(root, deps, state), state)
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    expect(deps.mutate).not.toHaveBeenCalled()

    // A readable card closed WITHOUT its commit: the user just walked away, so
    // the intent waits rather than landing behind that card's frozen revision
    // baseline. (This is the direction "committed with the official Save"
    // means; the case below pins the other one.)
    document.body.innerHTML = ''
    await settleIdle(deps, state)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)

    // Now the user really commits: the card reopens and its commit is pressed.
    const reopened = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(reopened, deps, state), state)
    reopened.querySelectorAll<HTMLButtonElement>('div.editorActions button')[1]!.click()
    await tick()

    document.body.innerHTML = ''
    await settleIdle(deps, state)
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(state.queued.size).toBe(0)
  })

  it('drops the held write when the card was dismissed', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(root, deps, state), state)
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    // The user dismisses the card: its own fields are discarded, and so is the
    // plugin's intent -- committed with the official Save means dropped with
    // the official Cancel.
    root.querySelectorAll<HTMLButtonElement>('div.editorActions button')[0]!.click()
    await tick()
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(0)
  })

  it('does not let a plain dismiss poison the next save of the same route', async () => {
    const deps = makeDeps()
    const state = createScanState()
    // Card 1: opened and dismissed WITHOUT touching the plugin editor, so the
    // cancel lands with no held write to drain.
    const first = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(first, deps, state), state)
    first.querySelectorAll<HTMLButtonElement>('div.editorActions button')[0]!.click()
    await tick()
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    // Card 2: the same route again, this time edited and SAVED. The dismiss
    // above must not have left a marker that swallows this save.
    const second = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(second, deps, state), state)
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    second.querySelectorAll<HTMLButtonElement>('div.editorActions button')[1]!.click()
    await tick()
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(state.queued.size).toBe(0)
  })

  it('withdraws a dismissed create card\'s staged declaration', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildCreateDom()
    root.querySelector('.editor')!.insertAdjacentHTML('beforeend', `
      <div class="editorActions">
        <button type="button" class="secondaryButton">Cancel</button>
        <button type="button" class="primaryButton">Apply</button>
      </div>`)
    await settle(() => reconcile(root, deps, state), state)
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { high: 'high' })

    // The user dismisses the create card: its own fields go away, and the
    // declaration staged against its route must go with them.
    root.querySelectorAll<HTMLButtonElement>('div.editorActions button')[0]!.click()
    await tick()
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    expect(state.pending.size).toBe(0)
    expect(deps.mutate).not.toHaveBeenCalled()
  })

  it('resolves the create card route at CLICK time, not first-wire time', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildCreateDom('acme-one')
    root.querySelector('.editor')!.insertAdjacentHTML('beforeend', `
      <div class="editorActions">
        <button type="button" class="secondaryButton">Cancel</button>
        <button type="button" class="primaryButton">Apply</button>
      </div>`)
    await settle(() => reconcile(root, deps, state), state)

    // The user finishes typing a DIFFERENT provider id after the buttons were
    // first wired. React reuses the button element, so a closure captured at
    // wiring time would clear the wrong route and leave this edit staged.
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Provider ID"]')!
    input.value = 'acme-two'
    await settle(() => reconcile(root, deps, state), state)
    stageEffortsInto(state, 'acme-two', 'deepseek-v4-flash-free', { high: 'high' })

    root.querySelectorAll<HTMLButtonElement>('div.editorActions button')[0]!.click()
    await tick()
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    expect(state.pending.size).toBe(0)
    expect(deps.mutate).not.toHaveBeenCalled()
  })

  it('degrades to landing on unmount when the action row yields no buttons', async () => {
    const deps = makeDeps()
    const state = createScanState()
    // A one-button row no tier can name: the commit cannot be observed at all,
    // so the plugin never drops the user's declaration on a signal it could
    // not read (writing too much stays recoverable).
    const root = buildActionCardDom('<button type="button">Frobnicate</button>')
    await settle(() => reconcile(root, deps, state), state)
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    document.body.innerHTML = ''
    await settleIdle(deps, state)

    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(state.queued.size).toBe(0)
  })

  it('recovers the official save signal once a readable action row appears', async () => {
    const deps = makeDeps()
    const state = createScanState()
    // Card 1 has no nameable button pair: the degrade flag trips.
    const broken = buildActionCardDom('<button type="button">Frobnicate</button>')
    await settle(() => reconcile(broken, deps, state), state)
    expect(state.signalsUnavailable).toBe(true)
    document.body.innerHTML = ''
    await settleIdle(deps, state)

    // A later normal card proves the signal works again: the latch is not a
    // one-way door for the rest of the session.
    const good = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(good, deps, state), state)
    expect(state.signalsUnavailable).toBe(false)
  })

  it('fences the idle pass while a readable card is open, with no signal yet', async () => {
    const deps = makeDeps()
    const state = createScanState()
    const root = buildActionCardDom(`
      <button type="button" class="secondaryButton">Cancel</button>
      <button type="button" class="primaryButton">Apply</button>`)
    await settle(() => reconcile(root, deps, state), state)
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })

    // An idle pass while the card is still open writes nothing: landing there
    // is exactly the frozen-revision write issue #7 is about.
    await settleIdleKeepDom(deps, state, root)
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.queued.size).toBe(1)
  })
})

describe('batch writes (one route, one mutate)', () => {
  it('lands every held row of a route in a single mutate', async () => {
    const deps = makeDeps()
    const state = createScanState()
    // No official action row exists in this fixture, so the signal degrades to
    // "the card went away, write it" -- which is what this case needs: it is
    // about the write SHAPE, not the commit signal.
    state.signalsUnavailable = true

    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    queueWriteInto(state, 'aliyun', 'qwen-turbo', { efforts: { low: 'low' } })
    await settleIdle(deps, state)

    // ONE describe + ONE mutate for the whole route: the document is a single
    // models array, so a per-row write was rebuilding and rewriting it twice.
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const ops = deps.mutate.mock.calls[0]![1] as Array<{ path: string[]; value: Array<Record<string, unknown>> }>
    expect(ops).toHaveLength(1)
    expect(ops[0]!.path).toEqual(['providers', 'aliyun', 'models'])
    // BOTH rows carry their own declaration in that one array.
    const models = ops[0]!.value
    expect(models.find(model => model['id'] === 'qwen-max')?.['reasoningEfforts']).toEqual({ high: 'high' })
    expect(models.find(model => model['id'] === 'qwen-turbo')?.['reasoningEfforts']).toEqual({ low: 'low' })
    expect(state.queued.size).toBe(0)
  })

  it('keeps every row of a route when the batch is refused', async () => {
    const deps = makeDeps()
    deps.mutate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'settings/rejected', message: 'refused' },
    })
    const state = createScanState()
    queueWriteInto(state, 'aliyun', 'qwen-max', { efforts: { high: 'high' } })
    queueWriteInto(state, 'aliyun', 'qwen-turbo', { efforts: { low: 'low' } })
    // The premise the ledger cannot carry: the user had committed this card.
    state.committing.add('aliyun')

    await settleIdle(deps, state)

    // A refused route keeps EVERY intent -- never a partial landing, so the
    // retry re-sends the same complete array.
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    expect(state.queued.get('aliyun')?.size).toBe(2)
  })
})
