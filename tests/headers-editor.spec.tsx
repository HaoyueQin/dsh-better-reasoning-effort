/**
 * HeadersEditor render-level tests (issue #12, MVP-1): what only exists once
 * the component is mounted — the stored draft, the masked read view, the
 * whole-dict Save, and the coexistence warning.
 *
 * The write path itself is covered against the settings seam in
 * `ops.spec.ts`/`headers.spec.ts`; this file covers the component's contract.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { HeadersEditor, headersFromDraft, type HeadersEditorProps } from '../src/client/HeadersEditor.js'
import { en } from '../src/client/locales.js'
import type { RemoteApi } from '../src/client/types.js'

;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

/** The shell's Translate face, approximated with the en dictionary. */
const t = (key: string, params?: Record<string, string | number>): string => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${String(name)}}`, String(value))
  }
  return text
}

/** One refused settings write, in the wire's envelope shape. */
type Refusal = { ok: false; error: { code: string; message: string } }

/** The write seam a fake Remote exposes, so a test can read what was sent. */
type MutateSpy = ReturnType<typeof vi.fn<(ns: string, ops: unknown[], revision?: number) => Promise<unknown>>>

/**
 * A settings Remote whose describe answers one namespace view.
 *
 * ONE spy backs both `api.mutate` and `api.settings.mutate` on purpose: the
 * editor reaches the seam through `settings.mutate`, and a test that asserted
 * on a second, separate spy would pass `toHaveBeenCalled` on a call the editor
 * never made.
 *
 * The envelope is cast at the seam: the editor only branches on `ok` and
 * `error.code`, and pinning the remote's full Typert envelope here would widen
 * the plugin's type graph for one refusal shape.
 */
function fakeApi(options: {
  headers?: Record<string, string>
  writable?: boolean
  mutate?: () => Promise<{ ok: true } | Refusal>
} = {}): RemoteApi & { mutate: MutateSpy } {
  const view = {
    ns: 'llm-pi-ai',
    schema: {},
    value: {},
    user: { providers: { aliyun: { baseURL: 'https://relay.example.com', headers: options.headers ?? {} } } },
    base: {},
    revision: 7,
    applies: 'live',
    secrets: [],
  }
  const mutate: MutateSpy = vi.fn(async () =>
    (options.mutate === undefined ? { ok: true } : await options.mutate()) as never)
  const api = {
    settings: {
      async describe() {
        return {
          ok: true,
          value: { namespaces: [view], writable: options.writable !== false },
        } as never
      },
      mutate,
    },
  }
  return Object.assign(api, { mutate }) as unknown as RemoteApi & { mutate: MutateSpy }
}

/** Stub the coexistence route; the component reads it in an effect. */
function stubEnvironment(data: unknown): void {
  ;(globalThis as Record<string, unknown>)['fetch'] = vi.fn(async () => ({
    ok: true,
    async json() { return { ok: true, data } },
  }))
}

/** The report a deployment with nothing installed produces. */
const CLEAN_ENVIRONMENT = {
  enabled: true,
  installed: true,
  overrides: [],
  conflicts: [],
  environment: { adapter: 'stock' as const, siblings: [], preferOfficialLayer: false },
}

/**
 * Render the editor inside a provider-card row.
 *
 * The slot wrapper watches its nearest `li` to learn whether the official card
 * is open (it reveals the section then), so a bare detached container would
 * exercise a state the real page never produces. The row stands in for the
 * official `.rowCard`.
 */
async function renderEditor(props: HeadersEditorProps): Promise<{ container: HTMLElement; row: HTMLElement; unmount(): Promise<void> }> {
  const row = document.createElement('li')
  row.className = 'rowCard'
  document.body.appendChild(row)
  const container = document.createElement('div')
  row.appendChild(container)
  let root: Root | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(HeadersEditor, props))
  })
  return {
    container,
    row,
    async unmount() {
      await act(async () => { root!.unmount() })
      row.remove()
    },
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const hit = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text)
  if (hit === undefined) throw new Error(`no button "${text}"`)
  return hit
}

/**
 * The section's disclosure control. The heading itself is the button, so this
 * is both "is it open?" and "open it".
 */
function disclosure(container: HTMLElement): HTMLButtonElement {
  const hit = container.querySelector<HTMLButtonElement>('.bre-headers-disclosure')
  if (hit === null) throw new Error('no disclosure control')
  return hit
}

/** Expand the section, the way a user reaches any of its contents. */
async function expand(container: HTMLElement): Promise<void> {
  if (disclosure(container).getAttribute('aria-expanded') !== 'true') {
    await act(async () => { disclosure(container).click() })
  }
}

/**
 * Type into a React CONTROLLED input.
 *
 * Assigning `.value` directly updates the DOM node but not React's own value
 * tracker, so the library sees no change and skips `onChange` — the classic
 * trap where a test types and the component never hears it. Driving the native
 * value setter first is what makes React observe the new value and fire.
 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/**
 * Inputs carrying one aria-label, in DOM order. Editing by label rather than by
 * a positional index is what keeps these tests honest: the row list grows and
 * shrinks, so an index assumed by the test would silently address the
 * user-agent field (the one input that is always last).
 */
function inputsByLabel(container: HTMLElement, label: string): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    .filter(input => input.getAttribute('aria-label') === label)
}

/** The headers dict one mutate call wrote. */
function writtenHeaders(spy: MutateSpy): unknown {
  const ops = (spy.mock.calls[0] as unknown[])[1] as { value: unknown }[]
  return ops[0]!.value
}

describe('headersFromDraft', () => {
  it('merges the user-agent back into the dict and drops blank names', () => {
    expect(headersFromDraft({
      rows: [{ id: 1, name: ' x-company ', value: 'acme' }, { id: 2, name: '', value: 'orphan' }],
      userAgent: 'claude-cli/2.1.161 (external, cli)',
    })).toEqual({
      'x-company': 'acme',
      'user-agent': 'claude-cli/2.1.161 (external, cli)',
    })
  })

  it('omits the user-agent when the draft clears it', () => {
    expect(headersFromDraft({ rows: [{ id: 1, name: 'a', value: '1' }], userAgent: '   ' })).toEqual({ a: '1' })
  })

  it('reports an empty dict for an empty draft (the "send no headers" intent)', () => {
    expect(headersFromDraft({ rows: [], userAgent: '' })).toEqual({})
  })
})

describe('HeadersEditor', () => {
  beforeEach(() => { stubEnvironment(CLEAN_ENVIRONMENT) })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('shows only its heading until the disclosure is opened', async () => {
    // The provider card lists providers: a section that rendered its rows,
    // its hint and its warnings in every card would bury that list.
    const api = fakeApi({ headers: { 'x-company': 'acme' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      const control = disclosure(editor.container)
      expect(control.getAttribute('aria-expanded')).toBe('false')
      expect(control.textContent).toContain(en.headersTitle)
      // The count is the one fact worth showing while closed.
      expect(control.textContent).toContain('1')
      // None of the details leaked.
      expect(editor.container.querySelectorAll('.bre-headers-row')).toHaveLength(0)
      expect(editor.container.querySelector('.bre-headers-masked')).toBeNull()
      expect(editor.container.querySelector('.bre-headers-edit')).toBeNull()
      expect(editor.container.textContent).not.toContain(en.headersHint)
      expect(editor.container.textContent).not.toContain(en.headersEdit)

      await expand(editor.container)
      expect(disclosure(editor.container).getAttribute('aria-expanded')).toBe('true')
      expect(editor.container.querySelectorAll('.bre-headers-row')).toHaveLength(1)
      expect(editor.container.textContent).toContain(en.headersHint)

      // And it closes again.
      await act(async () => { disclosure(editor.container).click() })
      expect(disclosure(editor.container).getAttribute('aria-expanded')).toBe('false')
      expect(editor.container.querySelectorAll('.bre-headers-row')).toHaveLength(0)
    } finally {
      await editor.unmount()
    }
  })

  it('shows no count while nothing is configured', async () => {
    const api = fakeApi({})
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      expect(editor.container.querySelector('.bre-headers-count')).toBeNull()
      await expand(editor.container)
      expect(editor.container.textContent).toContain(en.headersEmpty)
    } finally {
      await editor.unmount()
    }
  })

  it('shows the stored headers with the value masked', async () => {
    const api = fakeApi({ headers: { 'x-company': 'acme', 'user-agent': 'claude-cli/2.1.161 (external, cli)' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      const rows = Array.from(editor.container.querySelectorAll('.bre-headers-row'))
      expect(rows).toHaveLength(2)

      const names = Array.from(editor.container.querySelectorAll('.bre-headers-name')).map(node => node.textContent)
      expect(names).toContain('x-company')

      // The value never renders in clear text: a credential in `headers` is not
      // reached by the harness redactor (the official README's own warning).
      expect(editor.container.textContent).not.toContain('acme')
      expect(editor.container.querySelector('.bre-headers-masked')?.textContent).toBe('••••')
    } finally {
      await editor.unmount()
    }
  })

  it('offers no edit action when the document is not writable', async () => {
    const api = fakeApi({ headers: { a: '1' }, writable: false })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      // The section still REPORTS what is configured; it just offers no way to
      // change it, which is how the official cards behave on a read-only
      // document (a disabled button would invite a click that cannot land).
      expect(editor.container.querySelectorAll('.bre-headers-row')).toHaveLength(1)
      expect(editor.container.textContent).not.toContain(en.headersEdit)
    } finally {
      await editor.unmount()
    }
  })

  it('saves the whole dict once, with the edited row and the user-agent', async () => {
    const api = fakeApi({ headers: { 'x-company': 'acme' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })

      const values = inputsByLabel(editor.container, en.headersValue)
      const userAgent = inputsByLabel(editor.container, en.headersUserAgentTitle)
      // Row: name, value. Then the user-agent field.
      expect(values).toHaveLength(1)
      expect(userAgent).toHaveLength(1)
      await type(values[0]!, 'ACME-2')
      await type(userAgent[0]!, 'claude-cli/2.1.161 (external, cli)')
      await act(async () => { buttonByText(editor.container, en.headersSave).click() })

      expect(api.mutate).toHaveBeenCalledTimes(1)
      const [ns, ops, revision] = api.mutate.mock.calls[0] as [string, { op: string; path: string[]; value: unknown }[], number]
      expect(ns).toBe('llm-pi-ai')
      expect(ops).toHaveLength(1)
      expect(ops[0]!.path).toEqual(['providers', 'aliyun', 'headers'])
      expect(ops[0]!.value).toEqual({
        'x-company': 'ACME-2',
        'user-agent': 'claude-cli/2.1.161 (external, cli)',
      })
      // Fenced on the revision the draft was read at.
      expect(revision).toBe(7)

      expect(editor.container.textContent).toContain(en.headersSaved)
      // Back to the read view.
      expect(buttonByText(editor.container, en.headersEdit)).toBeDefined()
    } finally {
      await editor.unmount()
    }
  })

  it('adds a row and clears a row before saving', async () => {
    const api = fakeApi({ headers: { 'x-drop': 'me' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })
      await act(async () => { buttonByText(editor.container, en.headersAdd).click() })

      // The new row is the LAST one of each column; the stored row is first.
      const names = inputsByLabel(editor.container, en.headersName)
      const values = inputsByLabel(editor.container, en.headersValue)
      expect(names).toHaveLength(2)
      expect(names[0]!.value).toBe('x-drop')
      await type(names[1]!, 'x-new')
      await type(values[1]!, 'value')

      // Drop the stored row: its remove button carries the row name in its label.
      const remove = Array.from(editor.container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.getAttribute('aria-label') === `${en.headersClear} x-drop`)
      await act(async () => { remove!.click() })

      await act(async () => { buttonByText(editor.container, en.headersSave).click() })
      expect(writtenHeaders(api.mutate)).toEqual({ 'x-new': 'value' })
    } finally {
      await editor.unmount()
    }
  })

  it('stores an empty dict when the last header is cleared', async () => {
    const api = fakeApi({ headers: { 'x-company': 'acme' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })
      const remove = Array.from(editor.container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.getAttribute('aria-label') === `${en.headersClear} x-company`)
      await act(async () => { remove!.click() })
      await act(async () => { buttonByText(editor.container, en.headersSave).click() })

      expect(writtenHeaders(api.mutate)).toEqual({})
      expect(editor.container.textContent).toContain(en.headersCleared)
    } finally {
      await editor.unmount()
    }
  })

  it('discards the draft on cancel without writing', async () => {
    const api = fakeApi({ headers: { 'x-company': 'acme' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })
      await type(inputsByLabel(editor.container, en.headersValue)[0]!, 'CHANGED')
      await act(async () => { buttonByText(editor.container, en.headersCancel).click() })
      expect(api.mutate).not.toHaveBeenCalled()
      expect(buttonByText(editor.container, en.headersEdit)).toBeDefined()

      // Re-opening shows the STORED value again, not the discarded edit.
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })
      expect(inputsByLabel(editor.container, en.headersValue)[0]!.value).toBe('acme')
    } finally {
      await editor.unmount()
    }
  })

  it('surfaces a refused write and stays in edit mode', async () => {
    const api = fakeApi({
      headers: { a: '1' },
      mutate: async () => ({ ok: false, error: { code: 'settings/rejected', message: 'nope' } }),
    })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      await act(async () => { buttonByText(editor.container, en.headersEdit).click() })
      await act(async () => { buttonByText(editor.container, en.headersSave).click() })
      expect(editor.container.textContent).toContain('nope')
      // Still editing: the draft must not be lost to a refusal.
      expect(buttonByText(editor.container, en.headersSave)).toBeDefined()
    } finally {
      await editor.unmount()
    }
  })

  it('warns when the installed adapter is already patched', async () => {
    stubEnvironment({
      ...CLEAN_ENVIRONMENT,
      environment: { adapter: 'patched', siblings: [], preferOfficialLayer: true },
    })
    const api = fakeApi({ headers: { a: '1' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      expect(editor.container.textContent).toContain(en.headersConflictPatched)
    } finally {
      await editor.unmount()
    }
  })

  it('warns about a sibling plugin and about a same-origin disagreement', async () => {
    stubEnvironment({
      ...CLEAN_ENVIRONMENT,
      conflicts: [{ origin: 'https://relay.example.com', routes: ['a', 'b'], values: ['u1', 'u2'] }],
      environment: {
        adapter: 'stock',
        siblings: [{ name: 'dsh-llm-headers', path: '/x/node_modules/dsh-llm-headers' }],
        preferOfficialLayer: false,
      },
    })
    const api = fakeApi({ headers: { a: '1' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      expect(editor.container.textContent).toContain(en.headersConflictOrigin)
      expect(editor.container.textContent).toContain('dsh-llm-headers')
    } finally {
      await editor.unmount()
    }
  })

  it('renders without the coexistence route answering at all', async () => {
    ;(globalThis as Record<string, unknown>)['fetch'] = vi.fn(async () => { throw new Error('offline') })
    const api = fakeApi({ headers: { 'x-company': 'acme' } })
    const editor = await renderEditor({ route: 'aliyun', routeDisplayName: 'Aliyun', api, t })
    try {
      await expand(editor.container)
      // The section still works: the report is advisory, never a dependency.
      expect(editor.container.querySelectorAll('.bre-headers-row')).toHaveLength(1)
      expect(editor.container.textContent).not.toContain(en.headersConflictUnavailable)
    } finally {
      await editor.unmount()
    }
  })
})
