/**
 * The provider-card slot wrapper's one job beyond rendering: it publishes
 * whether the official card is OPEN, because the section reveals itself only
 * while the card is being edited (a request-header row parked in every card of
 * the provider list is noise).
 *
 * The state cannot be expressed as CSS: the official editor is not a sibling of
 * the section — its container sits among the card row's own children, after the
 * row head and this section's wrapper — so no relative selector reaches it. The
 * wrapper watches the card row instead.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { Root } from 'react-dom/client'
import { ProviderCardSlot } from '../src/client/injection/provider-card-slot.js'
import { en } from '../src/client/locales.js'
import { STYLES } from '../src/client/styles.js'
import type { RemoteApi } from '../src/client/types.js'

;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

const t = (key: string, params?: Record<string, string | number>): string => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${String(name)}}`, String(value))
  }
  return text
}

/** A settings Remote that answers "nothing configured" and refuses no write. */
function fakeApi(): RemoteApi {
  const view = {
    ns: 'llm-pi-ai',
    schema: {},
    value: {},
    user: { providers: { 'local-test': { baseURL: 'https://relay.example.com', headers: {} } } },
    base: {},
    revision: 1,
    applies: 'live',
    secrets: [],
  }
  return {
    settings: {
      async describe() { return { ok: true, value: { namespaces: [view], writable: true } } as never },
      async mutate() { return { ok: true } as never },
    },
  } as unknown as RemoteApi
}

/** Mount the slot occurrence inside a card row, the way the official page does. */
async function renderCard(): Promise<{ row: HTMLElement; unmount(): Promise<void> }> {
  const row = document.createElement('li')
  row.className = 'rowCard'
  row.appendChild(document.createElement('div'))
  document.body.appendChild(row)
  const host = document.createElement('div')
  row.appendChild(host)
  let root: Root | undefined
  await act(async () => {
    root = createRoot(host)
    // The official `Translate` types its params as Record<string, unknown>;
    // this suite's stand-in narrows them to the shapes it substitutes, so it
    // asserts at the one place the component takes the seat.
    root.render(createElement(ProviderCardSlot, {
      provider: { provider: 'local-test' },
      api: fakeApi(),
      t: t as unknown as Translate,
    }))
  })
  return {
    row,
    async unmount() {
      await act(async () => { root!.unmount() })
      row.remove()
    },
  }
}

/** Let the observer's coalescing microtask and React's own effects drain. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

/** The slot wrapper's data-edit, i.e. what the stylesheet keys visibility on. */
function editState(row: HTMLElement): string | null {
  return row.querySelector('.bre-headers-host')?.getAttribute('data-edit') ?? null
}

/** The official editor element, as the wrapper's `_editor` probe sees it. */
function addOfficialEditor(row: HTMLElement): HTMLElement {
  const editor = document.createElement('div')
  editor.className = 'zGbnIq_editor'
  row.appendChild(editor)
  return editor
}

describe('ProviderCardSlot', () => {
  beforeEach(() => { (globalThis as Record<string, unknown>)['fetch'] = vi.fn(async () => { throw new Error('offline') }) })
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('collapses the wrapper OUT of the card layout, not merely empty', async () => {
    // Measured regression guard. The official slot mounts this wrapper inside a
    // display:contents container, so the wrapper IS a flex item of the card row
    // — and that row lays its children out with a 12px gap. A wrapper left in
    // the flow adds a phantom gap to EVERY provider card (measured live: card
    // 54px → 66px). jsdom computes no layout, so the contract is asserted on
    // both halves: the state the component publishes, and the rule the
    // stylesheet keys it on.
    const { row, unmount } = await renderCard()
    try {
      expect(editState(row)).toBe('0')
      expect(STYLES).toContain('.bre-headers-host {\n  display: none;')
      expect(STYLES).toContain('.bre-headers-host[data-edit="1"]')
    } finally {
      await unmount()
    }
  })

  it('stays un-opened while the card is collapsed', async () => {
    const { row, unmount } = await renderCard()
    try {
      expect(editState(row)).toBe('0')
      // The editor really is rendered (only hidden), so opening the card needs
      // no remount and no second read.
      expect(row.querySelector('.bre-headers')).not.toBeNull()
    } finally {
      await unmount()
    }
  })

  it('opens when the official card adds its editor, and closes when it goes', async () => {
    const { row, unmount } = await renderCard()
    try {
      const editor = addOfficialEditor(row)
      await settle()
      expect(editState(row)).toBe('1')

      editor.remove()
      await settle()
      expect(editState(row)).toBe('0')
    } finally {
      await unmount()
    }
  })

  it('ignores a class that merely mentions editor elsewhere', async () => {
    const { row, unmount } = await renderCard()
    try {
      // The probe matches the CSS-module stem, so a different class must not
      // be mistaken for the card being open.
      const other = document.createElement('div')
      other.className = 'rowHead'
      row.appendChild(other)
      await settle()
      expect(editState(row)).toBe('0')
    } finally {
      await unmount()
    }
  })

  it('renders nothing when the occurrence names no route', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root: Root | undefined
    await act(async () => {
      root = createRoot(host)
      root.render(createElement(ProviderCardSlot, {
        provider: {},
        api: fakeApi(),
        t: t as unknown as Translate,
      }))
    })
    try {
      expect(host.textContent).toBe('')
      expect(host.querySelector('.bre-headers')).toBeNull()
    } finally {
      await act(async () => { root!.unmount() })
    }
  })
})
