/**
 * The add-provider staging flow, end to end against the real injector: the
 * user configures the ladder and the modalities on the create card, saves the
 * provider, and the declaration must be in the document afterwards.
 *
 * Regression for the reported bug: the host autofill fills the knowledge base
 * suggestion in-process the moment the provider is committed, so the browser's
 * debounced flush used to find its own suggestion already stored and withdraw
 * the staged intent as a "document takeover": the user's configuration simply
 * disappeared. The autofill provenance marker is what now separates the two.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createScanState, effectiveStagedIntents, reconcile, type EditorMountProps, type InjectorDeps, type MountedEditor, type SettingsJoin } from '../src/client/injector.js'
import { suggestEfforts } from '../src/knowledge.js'
import { AUTOFILL_MARKER } from '../src/constants.js'
import type { RemoteApi } from '../src/client/types.js'

const ROUTE = 'acme-gateway'
const MODEL = 'deepseek-v4-flash'

/** What the host autofill would write for this model on this route. */
const SUGGESTION = suggestEfforts(MODEL, { api: 'openai-completions', baseURL: 'https://gw.example.com/v1' })
const AUTOFILL_BYTES = SUGGESTION.efforts as Record<string, string | null>

/** The row exactly as the host autofill leaves it: suggestion + provenance. */
function autofilledRow(revision = 7): Record<string, unknown> {
  return {
    id: MODEL,
    name: 'DeepSeek V4 Flash',
    reasoningEfforts: structuredClone(AUTOFILL_BYTES),
    input: [...(SUGGESTION.input ?? ['text'])],
    [AUTOFILL_MARKER]: revision,
  }
}

function makeHost(): { doc: Record<string, unknown>; mutate: ReturnType<typeof vi.fn> } {
  const doc: Record<string, unknown> = {}
  const mutate = vi.fn(async (_ns: string, ops: { op: string; path: string[]; value?: unknown }[]) => {
    for (const op of ops) {
      if (op.op !== 'set' || op.path.length !== 3) continue
      const [, route, field] = op.path
      const profile = (doc[route] ??= {}) as Record<string, unknown>
      profile[field] = structuredClone(op.value)
    }
    return { ok: true, value: undefined }
  })
  return { doc, mutate }
}

function makeDeps(host: { doc: Record<string, unknown>; mutate: ReturnType<typeof vi.fn> }): InjectorDeps & {
  editors: { props?: EditorMountProps }[]
} {
  const editors: { props?: EditorMountProps }[] = []
  // Built per call so every scan reads the LIVE document: the host autofill
  // lands after the create card commits, and a value captured once at
  // construction would be the empty document forever.
  const join = (): SettingsJoin => {
    const value = { providers: structuredClone(host.doc) }
    return {
      namespace: { ns: 'llm-pi-ai', schema: {}, value, user: {}, revision: 1, applies: 'live', secrets: [] },
      writable: true,
    } as unknown as SettingsJoin
  }
  const apiFace = {
    settings: {
      describe: async () => {
        const local = join()
        return { ok: true, value: { writable: true, hasDocument: true, namespaces: [local.namespace] } }
      },
      mutate: host.mutate,
    },
  } as unknown as RemoteApi
  const mount = vi.fn((container: HTMLElement, props: EditorMountProps): MountedEditor => {
    const marker = document.createElement('div')
    marker.dataset['plugin'] = 'dsh-better-reasoning-effort'
    container.appendChild(marker)
    const record: { props?: EditorMountProps } = { props }
    editors.push(record)
    return {
      unmount: () => { marker.remove() },
      render: (next: EditorMountProps) => { record.props = next },
    }
  })
  return {
    api: apiFace,
    describeNamespace: async () => join(),
    t: (key: string) => key,
    labels: () => ({
      capacity: ['Capacities'], modelId: ['Model ID'], modelName: ['Display name'],
      routeId: ['Provider ID'], baseUrl: ['Base URL'], apiProtocol: ['API protocol'],
    }),
    mount,
    editors,
  } as unknown as InjectorDeps & { editors: { props?: EditorMountProps }[] }
}

async function settle(fn: () => void, state: ReturnType<typeof createScanState>): Promise<void> {
  // The real bundle clears this fold on `settings/document-updated` (index.ts);
  // a test that edits its host document is that invalidation.
  state.describePromise = undefined
  fn()
  await state.describePromise
  for (let tick = 0; tick < 6; tick++) await Promise.resolve()
}

function cardDom(title: string, saved: boolean): string {
  const routeFields = saved
    ? ''
    : '<div class="field"><input aria-label="Provider ID" value="' + ROUTE + '" /></div>'
      + '<div class="field"><input aria-label="Base URL" value="https://gw.example.com/v1" /></div>'
      + '<div class="field"><select aria-label="API protocol"><option selected>openai-completions</option></select></div>'
  return [
    '<div class="editor">',
    '  <div class="editorHeader">',
    '    <span class="editorTitle">' + title + '</span>',
    saved ? '    <span class="editorRoute">' + ROUTE + '</span>' : '',
    '  </div>',
    routeFields,
    '  <div class="modelCatalog">',
    '    <div class="modelEntry">',
    '      <div class="modelRow">',
    '        <input aria-label="Model ID" value="' + MODEL + '" />',
    '        <input aria-label="Display name" value="DeepSeek V4 Flash" />',
    '        <button aria-label="Capacities 1"></button>',
    '      </div>',
    '      <div class="modelAdvanced" style="display:block"><label><span>Context window</span><input /></label></div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n')
}

/** Drive the create card once, staging a declaration through the editor's own face. */
async function stageOnCreateCard(
  deps: ReturnType<typeof makeDeps>,
  state: ReturnType<typeof createScanState>,
  efforts: unknown,
  input: string[],
): Promise<void> {
  document.body.innerHTML = '<div class="section">' + cardDom('Custom provider', false) + '</div>'
  await settle(() => reconcile(document.querySelector('.section') as HTMLElement, deps, state), state)
  const staged = deps.editors.at(-1)?.props
  expect(staged?.staged).toBe(true)
  // The editor's own save path sends `nextInput ?? undefined`: an untouched
  // modality part travels as undefined, never as an empty list.
  const modality = input.length === 0 ? undefined : (input as never)
  staged?.api.stageEfforts(ROUTE, MODEL, efforts as never, undefined, modality)
  expect(state.pending.get(ROUTE)?.get(MODEL)).toBeDefined()
}

/** The official card commits (route + rows), then the host autofill lands. */
function commitProvider(host: { doc: Record<string, unknown> }, row: Record<string, unknown>): void {
  host.doc[ROUTE] = {
    displayName: 'Acme',
    api: 'openai-completions',
    baseURL: 'https://gw.example.com/v1',
    models: [row],
  }
}

async function reopenEditCard(deps: ReturnType<typeof makeDeps>, state: ReturnType<typeof createScanState>): Promise<void> {
  document.body.innerHTML = '<div class="section">' + cardDom('Acme', true) + '</div>'
  await settle(() => reconcile(document.querySelector('.section') as HTMLElement, deps, state), state)
  await new Promise(resolve => setTimeout(resolve, 0))
  await settle(() => reconcile(document.querySelector('.section') as HTMLElement, deps, state), state)
}

beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('staged declaration vs host autofill', () => {
  it('writes the users own ladder over the autofilled suggestion (different bytes)', async () => {
    const host = makeHost()
    const deps = makeDeps(host)
    const state = createScanState()
    // The editor's own convention for "off sends nothing", plus image input the
    // knowledge base does not predict: neither is byte-identical to autofill.
    const userEfforts = { off: null, low: 'low', high: 'high', max: 'max' }
    expect(userEfforts).not.toEqual(AUTOFILL_BYTES)

    await stageOnCreateCard(deps, state, userEfforts, ['text', 'image'])
    commitProvider(host, autofilledRow())
    await reopenEditCard(deps, state)

    const row = (host.doc[ROUTE] as { models: Record<string, unknown>[] }).models[0]
    // The assertion that carries the regression: before the provenance marker,
    // the flush read its own suggestion as a document takeover and wrote
    // nothing, leaving the knowledge base's ladder (off: 'none') in place.
    expect(row['reasoningEfforts']).toEqual(userEfforts)
    expect(row['input']).toEqual(['text', 'image'])
    // These bytes are the user's decision now, so provenance retires.
    expect(row[AUTOFILL_MARKER]).toBeUndefined()
    expect(state.pending.size).toBe(0)
  })

  it('writes the staged modality together with a ladder that differs', async () => {
    const host = makeHost()
    const deps = makeDeps(host)
    const state = createScanState()
    // Only the ladder's off spelling differs from the knowledge base's ladder,
    // which is enough for the whole staged declaration to be the user's.
    const userEfforts = { ...AUTOFILL_BYTES, off: null }
    await stageOnCreateCard(deps, state, userEfforts, ['text', 'image'])
    commitProvider(host, autofilledRow())
    await reopenEditCard(deps, state)
    const row = (host.doc[ROUTE] as { models: Record<string, unknown>[] }).models[0]
    expect(row['reasoningEfforts']).toEqual(userEfforts)
    expect(row['input']).toEqual(['text', 'image'])
    expect(state.pending.size).toBe(0)
  })

  it('never writes over a ladder the user declared by hand', async () => {
    const host = makeHost()
    const deps = makeDeps(host)
    const state = createScanState()
    // Ladder-only staging: the modality part carries nothing, so nothing at all
    // may be written over the hand-declared row.
    await stageOnCreateCard(deps, state, { off: null, low: 'low' }, [])
    // The stored row carries NO provenance marker: a hand edit (or an
    // official-page ladder) owns it, so the staging stands down.
    commitProvider(host, { id: MODEL, reasoningEfforts: { off: 'none', low: 'low', high: 'high' } })
    await reopenEditCard(deps, state)
    const row = (host.doc[ROUTE] as { models: Record<string, unknown>[] }).models[0]
    // The document's ladder stands untouched, and nothing was written for it.
    expect(row['reasoningEfforts']).toEqual({ off: 'none', low: 'low', high: 'high' })
    expect(host.mutate).not.toHaveBeenCalled()
    // Everything the staging carried was overruled, so the flush withdrew it:
    // nothing of the user's card ever reaches a row the document owns.
    expect(state.pending.get(ROUTE)?.get(MODEL)).toBeUndefined()
    expect(effectiveStagedIntents(
      { efforts: { off: null, low: 'low' }, input: undefined },
      row,
      { efforts: SUGGESTION.efforts as never, input: [...(SUGGESTION.input ?? ['text'])] },
    )).toBeNull()
  })
})

describe('effectiveStagedIntents provenance', () => {
  it('treats a marked ladder as autofill even when the bytes differ from the footprint', () => {
    const out = effectiveStagedIntents(
      { efforts: { off: null, low: 'low' }, input: ['text', 'image'] },
      autofilledRow(),
      { efforts: { off: 'none', low: 'low', high: 'high', max: 'max' }, input: ['text'] },
    )
    expect(out?.efforts).toEqual({ off: null, low: 'low' })
    expect(out?.input).toEqual(['text', 'image'])
  })

  it('lets the document win on the ladder when no marker stands and the bytes differ', () => {
    // A hand-declared (or official-page-written) ladder: no provenance marker,
    // bytes unlike the suggestion. The staging may still carry its own modality
    // intent, but the ladder part stands down.
    const stored = { id: MODEL, reasoningEfforts: { low: 'low' }, input: ['text'] }
    const out = effectiveStagedIntents(
      { efforts: { off: null, low: 'low', high: 'high' }, input: ['text', 'image'] },
      stored,
      { efforts: { off: null, low: 'low', high: 'high' }, input: ['text'] },
    )
    expect(out?.efforts).toBe('keep')
    expect(out?.input).toEqual(['text', 'image'])
  })
})
