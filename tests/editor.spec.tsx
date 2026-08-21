/**
 * EffortEditor render-level tests: the component's visible behavior over a
 * real React root in jsdom — armed levels, suggestion labeling, failure
 * surfacing, and busy-state disabling. The pure draft/intent rules are
 * covered by effort.spec.ts; this file covers what only exists rendered.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { EffortEditor, type EffortEditorProps } from '../src/client/EffortEditor.js'
import type { SuggestReply, WriteEffortsReply, EffortEditorApi } from '../src/client/types.js'
import { en } from '../src/client/locales.js'
import type { ReasoningEfforts } from '../src/knowledge.js'

;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

/** The shell's Translate face, approximated with the en dictionary. */
const t = (key: string, params?: Record<string, string | number>): string => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${String(name)}}`, String(value))
  }
  return text
}

function baseApi(): EffortEditorApi & { suggest: ReturnType<typeof vi.fn>; writeEfforts: ReturnType<typeof vi.fn> } {
  return {
    suggest: vi.fn(async (): Promise<SuggestReply> => ({ ok: false, error: 'no-suggestion' })),
    writeEfforts: vi.fn(async (): Promise<WriteEffortsReply> => ({ ok: true })),
  }
}

function baseProps(overrides?: Partial<EffortEditorProps>): EffortEditorProps {
  return {
    route: 'aliyun',
    routeDisplayName: 'Aliyun',
    modelId: 'qwen-max',
    index: 0,
    api: baseApi(),
    readOnly: false,
    t,
    ...overrides,
  }
}

async function renderEditor(props: EffortEditorProps): Promise<{
  container: HTMLElement
  setProps(next: EffortEditorProps): Promise<void>
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(EffortEditor, props))
  })
  return {
    container,
    async setProps(next: EffortEditorProps): Promise<void> {
      await act(async () => { root!.render(createElement(EffortEditor, next)) })
    },
  }
}

/** The editor's level checkboxes, in LEVEL_ORDER (off…max). */
function checkboxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const hit = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text)
  if (hit === undefined) throw new Error(`no button "${text}"`)
  return hit
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EffortEditor', () => {
  it('renders a saved declaration as armed levels with wire spellings', async () => {
    const { container } = await renderEditor(baseProps({
      efforts: { off: null, high: 'high' },
    }))
    const boxes = checkboxes(container)
    expect(boxes).toHaveLength(7) // off, minimal, low, medium, high, xhigh, max
    // off and high armed; everything else not.
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[4]!.checked).toBe(true)
    expect(boxes.slice(1, 4).every(box => !box.checked)).toBe(true)
    // The armed thinking level exposes its wire spelling; off takes none.
    const wires = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    expect(wires).toHaveLength(1)
    expect(wires[0]!.value).toBe('high')
  })

  it('applies an auto-adapt suggestion and labels its source and confidence', async () => {
    const api = baseApi()
    api.suggest.mockResolvedValue({
      ok: true,
      suggestion: {
        efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
        matched: false,
        source: 'endpoint:supported_features',
        confidence: 'medium',
      },
    } satisfies SuggestReply)
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })

    const note = container.querySelector('.bre-effort-note')
    expect(note?.textContent).toContain('endpoint:supported_features')
    expect(note?.textContent).toContain(t('confidence_medium'))
    // The draft followed the suggestion: low is now armed too.
    expect(checkboxes(container)[2]!.checked).toBe(true)
  })

  it('surfaces a failed save as an alert', async () => {
    const api = baseApi()
    api.writeEfforts.mockResolvedValue({ ok: false, error: 'boom' } satisfies WriteEffortsReply)
    const { container } = await renderEditor(baseProps({ api }))
    // Arm one level so Apply enables (the draft differs from unset).
    await act(async () => { checkboxes(container)[4]!.click() })
    expect((container.querySelector('[role="alert"]'))).toBeNull()

    await act(async () => { buttonByText(container, t('apply')).click() })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('boom')
  })

  it('disables the actions while a suggestion is in flight', async () => {
    let resolveSuggest!: (reply: SuggestReply) => void
    const api = baseApi()
    api.suggest.mockImplementation(() => new Promise<SuggestReply>(resolve => { resolveSuggest = resolve }))
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })
    expect(buttonByText(container, t('autoAdapt')).disabled).toBe(true)
    // While busy the apply button swaps its label to the in-flight copy.
    expect(buttonByText(container, t('saving')).disabled).toBe(true)

    await act(async () => {
      resolveSuggest({ ok: false, error: 'no-suggestion' })
    })
    expect(buttonByText(container, t('autoAdapt')).disabled).toBe(false)
  })

  it('keeps in-flight edits when the props re-render with the same declaration', async () => {
    // The injector swaps fresh props in place on settings changes; a user
    // typing mid-flight must not be clobbered by an unchanged declaration.
    const efforts: ReasoningEfforts = { high: 'high' }
    const props = baseProps({ efforts })
    const { container, setProps } = await renderEditor(props)
    // The user disarms high (dirty draft).
    await act(async () => { checkboxes(container)[4]!.click() })
    expect(checkboxes(container)[4]!.checked).toBe(false)

    await setProps({ ...props, efforts })

    // Still dirty: the user's edit survived the refresh.
    expect(checkboxes(container)[4]!.checked).toBe(false)
  })
})
