/**
 * DOM bypass injector tests: anchor discovery, idempotent mounting, unmount
 * on row removal, full-document scanning (the plugin scans document.body),
 * remounts, and describe-failure recovery. Runs against jsdom with a
 * hand-built approximation of the official Models page DOM.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScanState, reconcile, type EditorMountProps, type InjectorDeps, type SettingsJoin } from '../src/client/injector.js'
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

const join: SettingsJoin = {
  namespace: {
    ns: 'llm-pi-ai',
    schema: {},
    value: {
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
    },
    user: {},
    revision: 1,
    applies: 'live',
    secrets: [],
  },
  writable: true,
}

/** One handle reconcile received back from mount(), with its spies. */
interface FakeEditor {
  unmount: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
}

function makeDeps(overrides?: Partial<InjectorDeps>): InjectorDeps & { editors: FakeEditor[] } {
  const editors: FakeEditor[] = []
  const mount = vi.fn((container: HTMLElement, _props: EditorMountProps): FakeEditor => {
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
    return editor
  })
  return {
    api: { settings: { describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [join.namespace] } } }) } } as unknown as RemoteApi,
    describeNamespace: async () => join,
    t: (key: string) => key,
    mount,
    editors,
    ...overrides,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
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
    // The edit card resolves to 'aliyun'; the create card (fixed heading, no
    // key) cannot resolve a route and stays unmounted.
    const props = vi.mocked(deps.mount).mock.calls.map(call => call[1] as EditorMountProps)
    expect(props).toHaveLength(1)
    expect(props[0].route).toBe('aliyun')
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
})
