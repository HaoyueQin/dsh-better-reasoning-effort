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

  it('names the bare-relay outcome when clearing a stored declaration', async () => {
    const { container } = await renderEditor(baseProps({
      efforts: { off: null, high: 'high' },
    }))
    // Armed draft: no clearing hint (nothing would be cleared).
    expect(container.textContent).not.toContain(en.bareHint)
    // Uncheck every armed level: the save below would write the unset
    // intent (bare provider-default requests, the relay-compat mode).
    const boxes = checkboxes(container)
    await act(async () => {
      boxes[0]!.click()
      boxes[4]!.click()
    })
    expect(container.textContent).toContain(en.bareHint)
  })

  it('warns about the Default wire bytes on forced-thinking relay ladders', async () => {
    // Stored glm ladder (no off) on a self-hosted relay: Default sends the
    // disabled object the model rejects (issue #2).
    const { container } = await renderEditor(baseProps({
      routeApi: 'openai-completions',
      routeBaseURL: 'https://api.suiyue.site/v1',
      modelId: 'glm-5.3-flash',
      efforts: { low: 'low', high: 'high', max: 'max' },
    }))
    expect(container.textContent).toContain(en.defaultRiskDisabled)
  })

  it('shows no Default warning for off-capable ladders and official hosts', async () => {
    const off = await renderEditor(baseProps({
      routeApi: 'openai-completions',
      routeBaseURL: 'https://api.suiyue.site/v1',
      efforts: { off: null, high: 'high' },
    }))
    expect(off.container.textContent).not.toContain(en.defaultRiskDisabled)
    expect(off.container.textContent).not.toContain(en.defaultRiskQwen)
    const official = await renderEditor(baseProps({
      routeApi: 'openai-completions',
      routeBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
      modelId: 'glm-5.3-flash',
      efforts: { low: 'low', high: 'high', max: 'max' },
    }))
    // Official hosts keep pi-ai detection default... except the knowledge
    // base still resolves the zai format, whose Default is the disabled
    // object -- the warning correctly stays: format, not host, decides it.
    expect(official.container.textContent).toContain(en.defaultRiskDisabled)
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

    expect(api.stageEfforts).toHaveBeenCalledWith('acme-gateway', 'qwen-max', { high: 'high' }, undefined, undefined, undefined)
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
      undefined,
    )
  })

  it('staged: auto-adapt then checking image input keeps the suggestion compat', async () => {
    // Regression: markDirty() used to clear the applied suggestion's compat
    // block, so staging after ANY tweak lost thinkingFormat -- precisely on
    // the auto-adapt-then-check-image path this editor exists for. The compat
    // describes the wire format and must survive draft tweaks; only Reset or
    // a fresh Auto-adapt replaces it.
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
    const { container } = await renderEditor(baseProps({ api, staged: true, route: 'acme-gateway' }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })
    await act(async () => { checkboxes(container)[7]!.click() })
    await act(async () => { buttonByText(container, t('stage')).click() })

    expect(api.stageEfforts).toHaveBeenCalledWith(
      'acme-gateway',
      'qwen-max',
      { off: null, low: 'low', high: 'high', max: 'max' },
      compat,
      ['text', 'image'],
      undefined,
    )
  })

  it('staged: auto-adapt then tuning levels keeps the suggestion compat', async () => {
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
    const { container } = await renderEditor(baseProps({ api, staged: true, route: 'acme-gateway' }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })
    // Disarm the "high" level (index 4 in LEVEL_ORDER)...
    await act(async () => { checkboxes(container)[4]!.click() })
    await act(async () => { buttonByText(container, t('stage')).click() })

    expect(api.stageEfforts).toHaveBeenCalledWith(
      'acme-gateway',
      'qwen-max',
      { off: null, low: 'low', max: 'max' },
      compat,
      undefined,
      undefined,
    )
  })

  it('reset discards the applied suggestion compat for later applies', async () => {
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
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })
    await act(async () => { buttonByText(container, t('reset')).click() })
    // Re-arm one level by hand: this Apply is the user's own declaration and
    // must travel WITHOUT the discarded suggestion's compat.
    await act(async () => { checkboxes(container)[4]!.click() })
    await act(async () => { buttonByText(container, t('apply')).click() })

    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined, [], undefined)
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
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', 'keep', undefined, ['text'], [], undefined)
  })

  it('clearing the declaration writes the durable unset', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, input: ['text'] }))
    await act(async () => { buttonByText(container, t('clearDeclaration')).click() })
    expect(container.textContent).toContain(t('modalityInherit'))
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', 'keep', undefined, null, [], undefined)
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
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined, [], undefined)
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

describe('EffortEditor compat controls', () => {
  it('shows budget + priority controls on openai-completions only', async () => {
    const { container } = await renderEditor(baseProps({ routeApi: 'openai-completions' }))
    expect(container.textContent).toContain(t('budgetFieldLabel'))
    expect(container.textContent).toContain(t('priorityLabel'))
    expect(container.textContent).not.toContain(t('maxOutputLabel'))
  })
  it('shows the max_output control on openai-responses only', async () => {
    const { container } = await renderEditor(baseProps({ routeApi: 'openai-responses' }))
    expect(container.textContent).toContain(t('maxOutputLabel'))
    expect(container.textContent).not.toContain(t('budgetFieldLabel'))
  })
  it('renders the responses control as an official-shaped field with a hint', async () => {
    const { container } = await renderEditor(baseProps({ routeApi: 'openai-responses' }))
    const select = container.querySelector<HTMLSelectElement>('select.bre-select')
    expect(select).not.toBeNull()
    // The same control shape the official capacity/enum fields use: a caption
    // above, the picker capped at the official enum width, a hint below.
    expect(select!.getAttribute('aria-label')).toBe(t('maxOutputLabel') + ' 1')
    expect(container.querySelector('.bre-compat-label')?.textContent).toBe(t('maxOutputLabel'))
    expect(container.querySelector('.bre-compat-hint')?.textContent).toBe(t('maxOutputHint'))
    // The three intents, spelled so that "no value" is not the odd one out.
    expect(Array.from(select!.options).map(option => option.textContent)).toEqual([
      t('maxOutputUnset'), t('maxOutputOn'), t('maxOutputOff'),
    ])
    // The old inline-row shape is gone: the label no longer shares the control's line.
    expect(container.querySelector('.bre-compat-row .bre-effort-level')).toBeNull()
  })
  it('shows no compat controls without a protocol', async () => {
    const { container } = await renderEditor(baseProps({}))
    expect(container.textContent).not.toContain(t('budgetFieldLabel'))
    expect(container.textContent).not.toContain(t('maxOutputLabel'))
  })
  it('flags the legacy alias for migration', async () => {
    const { container } = await renderEditor(baseProps({
      routeApi: 'openai-completions',
      compat: { supportsThinkingTokenBudget: true },
    }))
    expect(container.textContent).toContain(t('aliasMigrated'))
  })
  it('clearing the responses picker asks the seam to clear the key it owns', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      routeApi: 'openai-responses',
      efforts: { high: 'high' },
      compat: { supportsMaxOutputTokens: false },
    }))
    // Back to "Unset": the choice has to be removable, not sticky forever.
    await act(async () => {
      // The responses picker, NOT the default-effort picker the armed ladder
      // also renders: locate it by its aria-label.
      const select = container.querySelector(`select[aria-label="${t('maxOutputLabel')} 1"]`) as HTMLSelectElement
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined, ['supportsMaxOutputTokens'], undefined)
  })

  it('writes the compat draft alongside the ladder', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      routeApi: 'openai-completions',
      efforts: { high: 'high' },
      compat: { thinkingTokenBudgetField: 'thinking_budget' },
    }))
    await act(async () => { checkboxes(container)[2]!.click() })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalled()
    const compat = (api.writeEfforts.mock.calls[0] as unknown[])[3] as Record<string, unknown>
    expect(compat).toMatchObject({ thinkingTokenBudgetField: 'thinking_budget' })
  })
})

describe('EffortEditor default-effort pick', () => {
  it('renders only while the draft declares levels, listing exactly those levels', async () => {
    // No armed ladder: no pick to make, no section at all.
    const bare = await renderEditor(baseProps())
    expect(bare.container.textContent).not.toContain(t('defaultEffortLabel'))
    const { container } = await renderEditor(baseProps({
      efforts: { off: null, high: 'high' },
      defaultEffort: 'high',
    }))
    expect(container.textContent).toContain(t('defaultEffortLabel'))
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label^="${t('defaultEffortLabel')}"]`)!
    expect(select.value).toBe('high')
    // The value domain is the model's OWN declared ladder: off and high.
    expect(Array.from(select.options).map(option => option.textContent)).toEqual([
      t('defaultEffortUnset'), t('level_off'), t('level_high'),
    ])
  })

  it('writes a picked level through the seam alongside the ladder', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, efforts: { high: 'high' } }))
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label^="${t('defaultEffortLabel')}"]`)!
    await act(async () => {
      select.value = 'high'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined, [], 'high')
  })

  it('a stored pick shows the clear button, and clearing writes the durable removal', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      efforts: { high: 'high' },
      defaultEffort: 'high',
    }))
    expect(hasButton(container, t('clearDefaultEffort'))).toBe(true)
    await act(async () => { buttonByText(container, t('clearDefaultEffort')).click() })
    // The ladder draft is untouched, so the only REAL intent is the cleared
    // pick (the ladder bytes rewrite identically).
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { high: 'high' }, undefined, undefined, [], null)
  })

  it('an untouched pick leaves the intent undefined so a ladder-only edit never clears it', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      efforts: { high: 'high' },
      defaultEffort: 'high',
    }))
    await act(async () => { checkboxes(container)[2]!.click() })
    await act(async () => { buttonByText(container, t('apply')).click() })
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', { low: 'low', high: 'high' }, undefined, undefined, [], undefined)
  })

  it('disarming the picked level flags the pick stale and clears it on apply', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      efforts: { off: null, high: 'high' },
      defaultEffort: 'high',
    }))
    // Disarm "high" (index 4 in LEVEL_ORDER): the pick names it, so it
    // auto-clears to "follow memory".
    await act(async () => { checkboxes(container)[4]!.click() })
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label^="${t('defaultEffortLabel')}"]`)!
    expect(select.value).toBe('')
    await act(async () => { buttonByText(container, t('apply')).click() })
    // The pick is cleared durably (null intent); the ladder keeps only the
    // off level, which declares a non-reasoning model.
    expect(api.writeEfforts).toHaveBeenCalledWith('aliyun', 'qwen-max', false, undefined, undefined, [], null)
  })

  it('reset restores the stored pick', async () => {
    const { container } = await renderEditor(baseProps({
      efforts: { high: 'high' },
      defaultEffort: 'high',
    }))
    await act(async () => { buttonByText(container, t('clearDefaultEffort')).click() })
    await act(async () => { buttonByText(container, t('reset')).click() })
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label^="${t('defaultEffortLabel')}"]`)!
    expect(select.value).toBe('high')
  })
})
