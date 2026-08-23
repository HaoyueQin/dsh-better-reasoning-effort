/**
 * DOM bypass injector tests: anchor discovery, idempotent mounting, unmount
 * on row removal, full-document scanning (the plugin scans document.body),
 * remounts, and describe-failure recovery. Runs against jsdom with a
 * hand-built approximation of the official Models page DOM.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScanState, reconcile, stageEffortsInto, type EditorMountProps, type InjectorDeps, type SettingsJoin } from '../src/client/injector.js'
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

function makeDeps(overrides?: Partial<InjectorDeps>): InjectorDeps & {
  editors: FakeEditor[]
  mutate: ReturnType<typeof vi.fn>
} {
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
  const mutate = vi.fn(async () => ({ result: { ok: true } }))
  // The write seam describes through api.settings.describe, not through the
  // injector's describeNamespace — wire both to the same (overridable) read
  // so a test's dynamic document is what a flush sees too.
  const describeNamespace = overrides?.describeNamespace ?? (async () => join)
  return {
    api: {
      settings: {
        describe: async () => {
          const local = await describeNamespace()
          return { result: { ok: true, value: { writable: true, hasDocument: true, namespaces: local.namespace === undefined ? [] : [local.namespace] } } }
        },
        mutate,
      },
    } as unknown as RemoteApi,
    describeNamespace,
    t: (key: string) => key,
    mount,
    editors,
    mutate,
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
        ;(local.namespace!.value as { providers: Record<string, unknown> }).providers['acme-gateway'] = {
          api: 'openai-completions',
          models: [{ id: 'deepseek-v4-flash-free' }],
        }
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

    // The card's create lands: the next scan sees the route and flushes.
    saved = true
    state.describePromise = undefined
    await settle(() => reconcile(root, deps, state), state)
    // flushRoute is fire-and-forget; give its awaits a turn.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.mutate).toHaveBeenCalledTimes(1)
    const op = deps.mutate.mock.calls[0]![0].ops[0]
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
      ;(local.namespace!.value as { providers: Record<string, unknown> }).providers['acme-gateway'] = {
        displayName: 'acme-gateway',
        api: 'openai-completions',
        models: [{ id: 'deepseek-v4-flash-free' }],
      }
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
    // The staged declaration flushed to the document during the transition.
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
        ;(local.namespace!.value as { providers: Record<string, unknown> }).providers['acme-gateway'] = {
          api: 'openai-completions',
          models: [{ id: 'deepseek-v4-flash-free' }],
        }
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
    // Scan two: the fold read sees the saved route and starts the flush;
    // the flush's own live read rejects.
    state.describePromise = undefined
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await settle(() => reconcile(root, deps, state), state)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.size).toBe(1)
    expect(errorSpy.mock.calls[0]![0]).toContain('staged flush failed')
    errorSpy.mockRestore()
  })

  it('drops empty pending routes instead of rescanning them forever', async () => {
    const deps = makeDeps()
    const state = createScanState()
    state.pending.set('acme-gateway', new Map())
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    expect(state.pending.has('acme-gateway')).toBe(false)
  })

  it('drops a staged declaration the saved profile already answers', async () => {
    // "Never silently overwrite": a model carrying a declaration (or an unset
    // marker) when its route appears keeps what the document says.
    const answered: SettingsJoin = structuredClone(join)
    ;(answered.namespace!.value as { providers: Record<string, unknown> }).providers['acme-gateway'] = {
      api: 'openai-completions',
      models: [{ id: 'deepseek-v4-flash-free', reasoningEfforts: { high: 'high' } }],
    }
    const deps = makeDeps({ describeNamespace: async () => answered })
    const state = createScanState()
    stageEffortsInto(state, 'acme-gateway', 'deepseek-v4-flash-free', { low: 'low' })
    const root = buildCreateDom('acme-gateway')
    await settle(() => reconcile(root, deps, state), state)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.mutate).not.toHaveBeenCalled()
    expect(state.pending.size).toBe(0)
  })
})
