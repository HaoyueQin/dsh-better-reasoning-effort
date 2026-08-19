/**
 * DOM bypass injector tests: anchor discovery, idempotent mounting, and
 * unmount on row removal. Runs against jsdom with a hand-built approximation
 * of the official Models page DOM.
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

function makeDeps(overrides?: Partial<InjectorDeps>): InjectorDeps {
  const mount = vi.fn((container: HTMLElement, _props: EditorMountProps) => {
    // Mirror the real mount: the editor DOM carries the plugin marker, which
    // is what the idempotency guard checks.
    const marker = document.createElement('div')
    marker.dataset['plugin'] = 'dsh-better-reasoning-effort'
    container.appendChild(marker)
    return () => { marker.remove() }
  })
  return {
    api: { settings: { describe: async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [join.namespace] } } }) } } as unknown as RemoteApi,
    describeNamespace: async () => join,
    t: (key: string) => key,
    mount,
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
    const secondProps = calls[1][1] as EditorMountProps
    expect(secondProps.modelId).toBe('qwen-turbo')
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
})
