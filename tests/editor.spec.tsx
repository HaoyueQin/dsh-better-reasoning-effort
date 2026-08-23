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

function baseApi(): EffortEditorApi & {
  suggest: ReturnType<typeof vi.fn>
  writeEfforts: ReturnType<typeof vi.fn>
  stageEfforts: ReturnType<typeof vi.fn>
} {
  return {
    suggest: vi.fn(async (): Promise<SuggestReply> => ({ ok: false, error: 'no-suggestion' })),
    writeEfforts: vi.fn(async (): Promise<WriteEffortsReply> => ({ ok: true })),
    stageEfforts: vi.fn((_route: string, _modelId: string, _efforts: unknown, _compat?: unknown): void => {}),
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

/** Whether a button with exactly this text exists (absence is expected sometimes). */
function hasButton(container: HTMLElement, text: string): boolean {
  return Array.from(container.querySelectorAll('button')).some(candidate => candidate.textContent === text)
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
    expect(boxes).toHaveLength(8) // off…max plus the image-input toggle
    // off and high armed; everything else not.
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[4]!.checked).toBe(true)
    expect(boxes.slice(1, 4).every(box => !box.checked)).toBe(true)
    // The armed thinking level exposes its wire spelling; off takes one too
    // (its spelling is what some formats send to close thinking).
    const wires = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    expect(wires).toHaveLength(2)
    expect(wires[0]!.value).toBe('') // off: null spells as "send nothing"
    expect(wires[1]!.value).toBe('high')
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

  it('localizes the malformed-model-list write refusal', async () => {
    const api = baseApi()
    api.writeEfforts.mockResolvedValue({ ok: false, error: 'invalid-models' } satisfies WriteEffortsReply)
    const { container } = await renderEditor(baseProps({ api }))
    await act(async () => { checkboxes(container)[4]!.click() })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t('invalidModels'))
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

  it('staged: Apply stages instead of writing settings and shows the staged copy', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, staged: true, route: 'acme-gateway' }))
    // The staged banner is present from the start.
    expect(container.textContent).toContain(t('stagedHint'))

    await act(async () => { checkboxes(container)[4]!.click() })
    const stageButton = buttonByText(container, t('stage'))
    expect(hasButton(container, t('apply'))).toBe(false)
    await act(async () => { stageButton.click() })

    expect(api.stageEfforts).toHaveBeenCalledWith('acme-gateway', 'qwen-max', { high: 'high' }, undefined, undefined)
    expect(api.writeEfforts).not.toHaveBeenCalled()
    expect(container.querySelector('.bre-effort-message')?.textContent).toContain(t('staged'))
  })

  it('staged: auto-adapt feeds the card-typed protocol and endpoint as inference facts', async () => {
    const api = baseApi()
    const compat = { thinkingFormat: 'deepseek' as const, supportsReasoningEffort: true }
    api.suggest.mockResolvedValue({
      ok: true,
      suggestion: {
        efforts: { off: null, low: 'low', high: 'high', max: 'max' },
        compat,
        matched: true,
        source: 'deepseek-v4',
        confidence: 'high',
      },
    } satisfies SuggestReply)
    const { container } = await renderEditor(baseProps({
      api,
      staged: true,
      route: 'acme-gateway',
      routeApi: 'openai-completions',
      routeBaseURL: 'https://api.deepseek.com/v1',
    }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })

    expect(api.suggest).toHaveBeenCalledWith('acme-gateway', 'qwen-max', undefined, {
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
    })
    // Staging must carry the suggestion's compat so the flush writes the
    // same declaration the host autofill would have written.
    await act(async () => { buttonByText(container, t('stage')).click() })
    expect(api.stageEfforts).toHaveBeenCalledWith(
      'acme-gateway',
      'qwen-max',
      { off: null, low: 'low', high: 'high', max: 'max' },
      compat,
      undefined,
    )
  })
})

describe('EffortEditor modality', () => {
  it('reflects a stored declaration and writes through the seam', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, input: ['text', 'image'] }))
    const boxes = checkboxes(container)
    expect(boxes[7].checked).toBe(true)
    expect(container.textContent).not.toContain(t('modalityInherit'))
    // Unchecking image narrows the declaration to text-only. The ladder was
    // never declared, so the effort part must travel as 'keep' -- NOT as the
    // unset intent, which would stamp a durable marker onto nothing.
    await act(async () => { boxes[7].click() })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', 'keep', undefined, ['text'])
  })

  it('clearing the declaration writes the durable unset', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, input: ['text'] }))
    await act(async () => { buttonByText(container, t('clearDeclaration')).click() })
    expect(container.textContent).toContain(t('modalityInherit'))
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', 'keep', undefined, null)
  })

  it('renders a resolved-layer empty input array as inheriting', async () => {
    // Production descriptors materialize absent arrays as []; that shape must
    // read as undeclared -- inherit note visible, no Clear-declaration button.
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, input: [] }))
    expect(container.textContent).toContain(t('modalityInherit'))
    expect(hasButton(container, t('clearDeclaration'))).toBe(false)
    expect(checkboxes(container)[7].checked).toBe(false)
  })

  it('an undeclared row stays untouched by an effort-only apply', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api }))
    expect(container.textContent).toContain(t('modalityInherit'))
    await act(async () => { checkboxes(container)[4].click() })
    await act(async () => { buttonByText(container, t('apply')).click() })
    // An untouched modality row omits the intent entirely -- an effort-only
    // apply must never stamp inputUnset onto a decision the user never made.
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined)
  })

  it('auto-adapt renders the zoned reference block and provenance hints', async () => {
    const api = baseApi()
    api.suggest.mockResolvedValue({
      ok: true,
      suggestion: {
        efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
        matched: true,
        source: 'deepseek-v4',
        confidence: 'high',
        input: ['text'],
        inputSource: 'endpoint',
        contextWindow: 1048576,
        maxTokens: 128000,
      },
    } satisfies SuggestReply)
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })

    const reference = container.querySelector('.bre-reference')
    expect(reference?.textContent).toContain(t('referenceTitle'))
    expect(reference?.textContent).toContain('1,048,576')
    expect(reference?.textContent).toContain('128,000')
    expect(container.textContent).toContain(t('contextWindowLabel'))
    expect(container.textContent).toContain(t('maxTokensLabel'))
    expect(container.textContent).toContain(t('inputHintEndpoint'))
    // The suggestion's text-only advice disarms the image toggle.
    expect(checkboxes(container)[7].checked).toBe(false)
  })

  it('heuristic modality advice surfaces the verify hint and arms the toggle', async () => {
    const api = baseApi()
    api.suggest.mockResolvedValue({
      ok: true,
      suggestion: {
        efforts: { low: 'low' },
        matched: false,
        source: 'protocol:openai-completions',
        confidence: 'low',
        input: ['text', 'image'],
        inputSource: 'heuristic',
      },
    } satisfies SuggestReply)
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })

    expect(container.textContent).toContain(t('inputHintHeuristic'))
    expect(checkboxes(container)[7].checked).toBe(true)
    // No capacities in the suggestion -- no reference block at all.
    expect(container.querySelector('.bre-reference')).toBeNull()
  })
})
