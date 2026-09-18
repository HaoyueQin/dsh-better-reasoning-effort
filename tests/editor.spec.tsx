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
import { EffortEditor, clearedCompatKeys, compatClearIntent, type EffortEditorProps } from '../src/client/EffortEditor.js'
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
  commit: ReturnType<typeof vi.fn>
  withdraw: ReturnType<typeof vi.fn>
} {
  return {
    suggest: vi.fn(async (): Promise<SuggestReply> => ({ ok: false, error: 'no-suggestion' })),
    // Since C2 the editor reports through commit() and the injector decides
    // where the intent lands; writeEfforts/stageEfforts are no longer its path.
    commit: vi.fn((_route: string, _modelId: string, _write: unknown): void => {}),
    withdraw: vi.fn((_route: string, _modelId: string): void => {}),
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

  // The write-failure copy ('boom', 'invalid-models', 'conflict') is no longer
  // this component's to render: since C2 the editor reports through commit()
  // and the injector owns the write, so the refusal surface moved with it (see
  // the injector suite). What stays here is the contract the editor does own.

  it('disables the row controls while a suggestion is in flight', async () => {
    let resolveSuggest!: (reply: SuggestReply) => void
    const api = baseApi()
    api.suggest.mockImplementation(() => new Promise<SuggestReply>(resolve => { resolveSuggest = resolve }))
    const { container } = await renderEditor(baseProps({ api }))

    await act(async () => { buttonByText(container, t('autoAdapt')).click() })
    expect(buttonByText(container, t('autoAdapt')).disabled).toBe(true)
    // The commit path is a checkbox, not a button since C2: it has to be held
    // while the suggestion it belongs to is still in flight.
    expect(checkboxes(container)[4]!.disabled).toBe(true)

    await act(async () => {
      resolveSuggest({ ok: false, error: 'no-suggestion' })
    })
    expect(buttonByText(container, t('autoAdapt')).disabled).toBe(false)
    expect(checkboxes(container)[4]!.disabled).toBe(false)
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

  it('staged: a change reports the pending intent and the staged banner stays', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, staged: true, route: 'acme-gateway' }))
    // The staged banner is present from the start.
    expect(container.textContent).toContain(t('stagedHint'))
    // No commit button of the editor's own exists since C2.
    expect(hasButton(container, t('apply'))).toBe(false)

    await act(async () => { checkboxes(container)[4]!.click() })

    // One commit, carrying the complete intent; the injector decides whether it
    // stages (unsaved route) or queues (saved row).
    expect(api.commit).toHaveBeenCalledWith('acme-gateway', 'qwen-max', { efforts: { high: 'high' } })
    expect(api.writeEfforts).not.toHaveBeenCalled()
    // The copy says "modified, it lands with the card's save" -- never a
    // "Saved." that would be a lie until the official Save lands.
    expect(container.querySelector('.bre-effort-message')?.textContent).toContain(t('pendingSave'))
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
    expect(api.commit).toHaveBeenCalledWith('acme-gateway', 'qwen-max', {
      efforts: { off: null, low: 'low', high: 'high', max: 'max' },
      compat,
      clearCompatKeys: ['thinkingTokenBudgetField', 'supportsThinkingTokenBudget', 'vllmPriority'],
    })
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

    // The LAST commit carries the suggestion's compat AND the checked
    // modality: the wire format must survive a draft tweak on the path this
    // editor exists for. (The auto-adapt itself commits first.)
    expect(api.commit).toHaveBeenLastCalledWith('acme-gateway', 'qwen-max', {
      efforts: { off: null, low: 'low', high: 'high', max: 'max' },
      compat,
      clearCompatKeys: [],
      input: ['text', 'image'],
    })
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

    expect(api.commit).toHaveBeenLastCalledWith('acme-gateway', 'qwen-max', {
      efforts: { off: null, low: 'low', max: 'max' },
      compat,
      clearCompatKeys: [],
    })
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
    // Re-arm one level by hand: this edit is the user's own declaration and
    // must travel WITHOUT the discarded suggestion's compat.
    await act(async () => { checkboxes(container)[4]!.click() })

    // Two commits: the auto-adapt's own, then the user's hand-armed ladder.
    // The LAST one is the user's declaration and must travel WITHOUT the
    // discarded suggestion's compat.
    expect(api.commit).toHaveBeenCalledTimes(2)
    expect(api.commit).toHaveBeenLastCalledWith('aliyun', 'qwen-max', { efforts: { high: 'high' } })
    expect(api.withdraw).toHaveBeenCalledWith('aliyun', 'qwen-max')
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
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: 'keep', input: ['text'] })
  })

  it('clearing the declaration writes the durable unset', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({ api, input: ['text'] }))
    await act(async () => { buttonByText(container, t('clearDeclaration')).click() })
    expect(container.textContent).toContain(t('modalityInherit'))
    // The durable unset travels as the null intent, not as an omission: the
    // injector must record the absence as the user's decision.
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: 'keep', input: null })
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
    // An untouched modality row omits the intent entirely -- an effort-only
    // edit must never stamp inputUnset onto a decision the user never made.
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: { high: 'high' } })
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
    // A controlled <select> whose value React tracks does not dispatch onChange
    // for a synthetic change in this environment (the tracker is updated by the
    // native change, and the event is then folded as a no-op). The key-clearing
    // rule this case exists for is asserted over the pure seam instead, where
    // it is the same call the commit path makes.
    expect(clearedCompatKeys('openai-responses', undefined)).toEqual(['supportsMaxOutputTokens'])
    expect(clearedCompatKeys('openai-responses', { supportsMaxOutputTokens: false })).toEqual([])
    // The protocol owns no key elsewhere, so an unsupported route clears nothing.
    expect(clearedCompatKeys(undefined, { supportsMaxOutputTokens: false })).toEqual([])
  })
  it('clears the owned keys even when the whole draft is empty', () => {
    // Regression (C2): the commit path only attached `clearCompatKeys` when the
    // DRAFT had bytes, so dropping the last owned field (e.g. the responses
    // max-output pick back to "unset") sent no clear at all and the stored key
    // survived. The owned-key clear must ride an empty draft too.
    expect(compatClearIntent('openai-responses', undefined))
      .toEqual({ clearCompatKeys: ['supportsMaxOutputTokens'] })
    // A defined draft still reports every owned field it left empty...
    expect(compatClearIntent('openai-responses', { supportsMaxOutputTokens: false }))
      .toEqual({ clearCompatKeys: [] })
    // ...while a route owning no key (or none at all) attaches nothing.
    expect(compatClearIntent(undefined, undefined)).toEqual({})
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
    expect(api.commit).toHaveBeenCalled()
    const write = (api.commit.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(write['compat']).toMatchObject({ thinkingTokenBudgetField: 'thinking_budget' })
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
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: { high: 'high' }, defaultEffort: 'high' })
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
    // pick; it travels as null (durable removal), never as an omission.
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: { high: 'high' }, defaultEffort: null })
  })

  it('an untouched pick leaves the intent undefined so a ladder-only edit never clears it', async () => {
    const api = baseApi()
    const { container } = await renderEditor(baseProps({
      api,
      efforts: { high: 'high' },
      defaultEffort: 'high',
    }))
    await act(async () => { checkboxes(container)[2]!.click() })
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: { low: 'low', high: 'high' } })
  })

  it('disarming the picked level flags the pick stale and clears it', async () => {
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
    // The pick is cleared durably (null intent) in the SAME commit that writes
    // the narrowed ladder -- one mutate carries both parts. A ladder holding
    // only `off` is the `false` declaration: the model does not reason.
    expect(api.commit).toHaveBeenCalledWith('aliyun', 'qwen-max', { efforts: false, defaultEffort: null })
  })

  it('follows a pick-only props push — the pick rides the same sync discipline', async () => {
    const { container, setProps } = await renderEditor(baseProps({
      efforts: { high: 'high' },
    }))
    const select = () => container.querySelector<HTMLSelectElement>(`select[aria-label^="${t('defaultEffortLabel')}"]`)!
    expect(select()!.value).toBe('')
    // Another tab (or a hand-edited document) sets the pick: the editor's
    // draft must follow it even though nothing else in the props changed.
    await setProps(baseProps({ efforts: { high: 'high' }, defaultEffort: 'high' }))
    expect(select()!.value).toBe('high')
    // And a pick cleared elsewhere clears here too.
    await setProps(baseProps({ efforts: { high: 'high' } }))
    expect(select()!.value).toBe('')
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
