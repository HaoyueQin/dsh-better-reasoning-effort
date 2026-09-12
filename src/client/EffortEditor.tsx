/**
 * The thinking-effort + input-modality editor injected into the official
 * Models page's model rows. Rendered with ReactDOM.createRoot into a DOM
 * container the injector creates, it needs no harness services of its own:
 * everything arrives through a plain props face, so it stays testable in
 * isolation. The draft/intent rules live in the client/effort module.
 *
 * Suggestion feedback is ZONED: provenance + confidence form their own line;
 * capacity references render as a separate read-only block explicitly marked
 * "never auto-filled" -- the official capacity inputs above stay untouched.
 * The apply/reset actions sit at the very bottom and own every section.
 *
 * @module dsh-better-reasoning-effort/EffortEditor
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PLUGIN_ID } from '../constants.js'
import type {
  CompatSuggestion,
  InputModalities,
  InputSource,
  ReasoningEfforts,
} from '../knowledge.js'
import {
  buildIntent,
  draftFrom,
  LEVEL_ORDER,
  sameEfforts,
  type DraftLevels,
} from './effort.js'
import { defaultWireRisk } from './wire-preview.js'
import { suggestEfforts } from '../knowledge.js'
import type { EffortEditorApi } from './types.js'

/** Thousands-grouped token counts, matching the official capacity inputs. */
const COUNT = new Intl.NumberFormat('en-US')

/** A route's profile facts (as the editor's suggestion inference reads them). */
export interface EffortRoute {
  /** Route key. */
  route: string
  /** Display name. */
  displayName: string
  /** Wire protocol, when configured. */
  api?: string
  /** Endpoint, when configured. */
  baseURL?: string
}

/** One model row's data the editor needs. */
export interface EffortModel {
  /** Model id (the settings key). */
  id: string
  /** Display name, when one is set. */
  name?: string
  /** The model's current reasoningEfforts declaration. */
  efforts?: false | ReasoningEfforts
}

/** Props of {@link EffortEditor}. */
export interface EffortEditorProps {
  /** Route key. */
  route: string
  /**
   * Route display name. Part of the mount contract but never rendered here:
   * this editor lives inside ONE model row, whose provider card already
   * carries the name, so the component does not even destructure it. The
   * injector keeps it in the prop set and its sameProps diff compares it, which
   * is what catches a provider rename under an already-mounted editor.
   */
  routeDisplayName: string
  /** Route wire protocol, when configured. */
  routeApi?: string
  /** Route endpoint, when configured. */
  routeBaseURL?: string
  /** Model id. */
  modelId: string
  /** Model display name, when one is set. */
  modelName?: string
  /** The model's current reasoningEfforts declaration. */
  efforts?: false | ReasoningEfforts
  /** The model's current input-modality declaration. */
  input?: InputModalities
  /** The model's stored compat block (passthrough; suggestions merge over it). */
  compat?: CompatSuggestion
  /** The model's stored per-model default-effort pick, when one is set. */
  defaultEffort?: string
  /** Model row index (for aria labels). */
  index: number
  /**
   * The model row is not saved yet (a create card's draft route, or a new
   * model row on a saved route). Apply then stages the declaration instead
   * of writing settings; the injector applies staged declarations
   * automatically once the row is saved.
   */
  staged?: boolean
  /** The write seam (settings.mutate plus the suggestion engine). */
  api: EffortEditorApi
  /** Read-only (settings document not writable). */
  readOnly: boolean
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
}

/** Draft state of the modality part: declared or inheriting, image or not. */
interface DraftModality {
  declared: boolean
  image: boolean
}

/** Read the stored declaration into a draft. Empty mirrors undefined: the
 * resolved settings layer materializes absent arrays as [], and core reads
 * that as "no answer here" -- never as a phantom text-only declaration. */
function modalityFrom(input: InputModalities | undefined): DraftModality {
  if (input === undefined || input.length === 0) return { declared: false, image: false }
  return { declared: true, image: input.includes('image') }
}

/** Resolve a modality draft to the write intent (null = durably unset). */
function buildModalityIntent(draft: DraftModality): InputModalities | null {
  if (!draft.declared) return null
  return draft.image ? ['text', 'image'] : ['text']
}

/**
 * The compat fields this editor can SET, per protocol — which is also the set
 * it may clear. A key from neither list survives an apply untouched: a
 * hand-tuned field the UI never showed is not this editor's to drop. Clearing
 * a picker means unset, not "keep whatever was chosen last".
 */
export const OWNED_COMPAT_KEYS: Readonly<Record<string, readonly string[]>> = {
  'openai-completions': ['thinkingTokenBudgetField', 'supportsThinkingTokenBudget', 'vllmPriority'],
  'openai-responses': ['supportsMaxOutputTokens'],
}

/** The compat fields clearable on one protocol (empty = this edit owns none). */
export function ownedCompatKeys(routeApi: string | undefined): readonly string[] {
  return OWNED_COMPAT_KEYS[(routeApi ?? '').toLowerCase()] ?? []
}

/** The owned compat fields the draft actually left EMPTY. */
export function clearedCompatKeys(routeApi: string | undefined, draft: CompatSuggestion | undefined): readonly string[] {
  const owned = ownedCompatKeys(routeApi)
  if (owned.length === 0) return []
  const set = new Set<string>(draft === undefined ? [] : Object.keys(draft))
  return owned.filter(key => !set.has(key))
}

/** Semantic equality between a modality draft and a stored declaration. */
function sameModality(draft: DraftModality, stored: InputModalities | undefined): boolean {
  if (!draft.declared) return stored === undefined
  if (stored === undefined) return false
  return draft.image ? stored.includes('image') : !stored.includes('image')
}

/**
 * Render one model's thinking-effort + input-modality editor: the level
 * checkboxes, the modality toggle, the auto-adapt action, and the
 * apply/reset actions that own both sections.
 */
export function EffortEditor({ route, routeApi, routeBaseURL, modelId, modelName, efforts: initialEfforts, input: initialInput, compat: initialCompat, defaultEffort: initialDefaultEffort, index, staged = false, api, readOnly, t }: EffortEditorProps): ReactNode {
  const [draft, setDraft] = useState<DraftLevels>(() => draftFrom(initialEfforts))
  const [modality, setModality] = useState<DraftModality>(() => modalityFrom(initialInput))
  // The per-model default-effort pick (issue #4), as the level id or '' for
  // "follow the memory chain". The pick lives in the same Apply as the ladder
  // so one mutate carries both.
  const [defaultEffort, setDefaultEffort] = useState<string>(() => initialDefaultEffort ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | undefined>(undefined)
  const [suggested, setSuggested] = useState<ReasoningEfforts | false | undefined>(undefined)
  const [suggestedSource, setSuggestedSource] = useState('')
  const [suggestedConfidence, setSuggestedConfidence] = useState<'high' | 'medium' | 'low'>('low')
  // The compat block the applied suggestion carries, kept in a REF on purpose:
  // it describes the wire format, not the level set, so level/image tweaks must
  // NOT clear it -- markDirty() resets the user-facing draft context, and a
  // state here would wipe the very bytes Apply/stage needs to reproduce what
  // the host autofill writes. Only a fresh Auto-adapt replaces it; Reset
  // discards it along with everything else.
  const appliedCompatRef = useRef<CompatSuggestion | undefined>(undefined)
  // Modality + capacity parts of the applied suggestion. Capacities are
  // DISPLAY-ONLY: they render in the reference block and never touch the
  // official capacity inputs.
  const [budgetField, setBudgetField] = useState<string>(() => initialCompat?.thinkingTokenBudgetField ?? '')
  const [priorityText, setPriorityText] = useState<string>(() => initialCompat?.vllmPriority === undefined ? '' : String(initialCompat.vllmPriority))
  const [maxOutput, setMaxOutput] = useState<string>(() => initialCompat?.supportsMaxOutputTokens === undefined ? '' : String(initialCompat.supportsMaxOutputTokens))
  const previousCompat = useRef<CompatSuggestion | undefined>(initialCompat)
  const [suggestedInputSource, setSuggestedInputSource] = useState<InputSource | undefined>(undefined)
  const [referenceContext, setReferenceContext] = useState<number | undefined>(undefined)
  const [referenceMaxTokens, setReferenceMaxTokens] = useState<number | undefined>(undefined)
  // Once the user edits, the drafts own the row: a re-render that changes
  // the initial props (the official page re-renders on its own edits and on
  // apply) must not overwrite in-flight input. Before any edit the drafts
  // simply follow the props.
  const dirtyRef = useRef(false)
  const previousEfforts = useRef<false | ReasoningEfforts | undefined>(initialEfforts)
  const previousInput = useRef<InputModalities | undefined>(initialInput)
  const previousDefaultEffort = useRef<string | undefined>(initialDefaultEffort)

  useEffect(() => {
    if (!sameEfforts(previousEfforts.current, initialEfforts)) {
      previousEfforts.current = initialEfforts
      if (!dirtyRef.current) setDraft(draftFrom(initialEfforts))
    }
    if (previousInput.current !== initialInput) {
      previousInput.current = initialInput
      // A push that lands while the user is mid-edit must not clobber the
      // draft -- same contract as the level grid above.
      if (!dirtyRef.current) setModality(modalityFrom(initialInput))
    }
    if (previousDefaultEffort.current !== initialDefaultEffort) {
      previousDefaultEffort.current = initialDefaultEffort
      if (!dirtyRef.current) setDefaultEffort(initialDefaultEffort ?? '')
    }
    if (JSON.stringify(previousCompat.current ?? null) !== JSON.stringify(initialCompat ?? null)) {
      previousCompat.current = initialCompat
      if (!dirtyRef.current) {
        setBudgetField(initialCompat?.thinkingTokenBudgetField ?? '')
        setPriorityText(initialCompat?.vllmPriority === undefined ? '' : String(initialCompat.vllmPriority))
        setMaxOutput(initialCompat?.supportsMaxOutputTokens === undefined ? '' : String(initialCompat.supportsMaxOutputTokens))
      }
    }
  }, [initialEfforts, initialInput, initialCompat])

  const compatDraft = (): CompatSuggestion | undefined => {
    const out: CompatSuggestion = {}
    if (budgetField !== '') out.thinkingTokenBudgetField = budgetField as CompatSuggestion['thinkingTokenBudgetField']
    const pruned = priorityText.trim()
    if (pruned !== '' && /^-?\d+$/.test(pruned)) out.vllmPriority = Number.parseInt(pruned, 10)
    if (maxOutput === 'true') out.supportsMaxOutputTokens = true
    else if (maxOutput === 'false') out.supportsMaxOutputTokens = false
    return Object.keys(out).length === 0 ? undefined : out
  }
  const compatChanged = (): boolean => {
    const draftOut = compatDraft()
    return JSON.stringify(draftOut ?? null) !== JSON.stringify({
      ...(initialCompat?.thinkingTokenBudgetField === undefined ? {} : { thinkingTokenBudgetField: initialCompat.thinkingTokenBudgetField }),
      ...(initialCompat?.vllmPriority === undefined ? {} : { vllmPriority: initialCompat.vllmPriority }),
      ...(initialCompat?.supportsMaxOutputTokens === undefined ? {} : { supportsMaxOutputTokens: initialCompat.supportsMaxOutputTokens }),
    })
  }
  // The declared levels of this draft: the pick's value domain.
  const armedLevels = LEVEL_ORDER.filter(level => draft[level].on)
  const defaultEffortIntent = defaultEffort === (initialDefaultEffort ?? '')
    ? undefined
    : defaultEffort === '' ? null : defaultEffort

  const changed = !sameEfforts(buildIntent(draft), initialEfforts)
    || !sameModality(modality, initialInput)
    || compatChanged()
    || defaultEffortIntent !== undefined

  const markDirty = (): void => {
    dirtyRef.current = true
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
    setSuggestedInputSource(undefined)
    // appliedCompatRef deliberately SURVIVES this (see its declaration) --
    // Apply/stage must still write the applied suggestion's compat bytes.
    // Reference capacities SURVIVE tweaks too: they are read-only context about
    // the model, not part of the applied suggestion -- only Reset or a fresh
    // Auto-adapt replaces them.
  }

  const patchLevel = (level: (typeof LEVEL_ORDER)[number], on: boolean): void => {
    markDirty()
    // Disarming the level the pick names clears the pick with it: the pick is
    // a level of the declared ladder, and a stale one must not survive Apply.
    if (!on && defaultEffort === level) setDefaultEffort('')
    setDraft(current => {
      const next = { ...current, [level]: { ...current[level], on } }
      // Enabling a thinking level pre-fills the conventional spelling.
      if (on && level !== 'off' && next[level].wire.trim().length === 0) {
        next[level] = { ...next[level], wire: level }
      }
      return next
    })
    setMessage(undefined)
  }

  const patchWire = (level: (typeof LEVEL_ORDER)[number], wire: string): void => {
    markDirty()
    setDraft(current => ({ ...current, [level]: { ...current[level], wire } }))
    setMessage(undefined)
  }

  const patchImage = (on: boolean): void => {
    markDirty()
    setModality({ declared: true, image: on })
    setMessage(undefined)
  }

  const clearModality = (): void => {
    markDirty()
    setModality({ declared: false, image: false })
    setMessage(undefined)
  }

  const applySuggestion = (
    parts: {
      efforts: ReasoningEfforts | false
      source: string
      confidence: 'high' | 'medium' | 'low'
      compat?: CompatSuggestion
      input?: InputModalities
      inputSource?: InputSource
      contextWindow?: number
      maxTokens?: number
    },
  ): void => {
    markDirty()
    setDraft(draftFrom(parts.efforts))
    if (parts.input !== undefined) setModality(modalityFrom(parts.input))
    setSuggested(parts.efforts)
    setSuggestedSource(parts.source)
    setSuggestedConfidence(parts.confidence)
    appliedCompatRef.current = parts.compat
    setSuggestedInputSource(parts.inputSource)
    setReferenceContext(parts.contextWindow)
    setReferenceMaxTokens(parts.maxTokens)
    setMessage({
      kind: 'info',
      text: t('appliedHint', { source: parts.source, confidence: t('confidence_' + parts.confidence) }),
    })
  }

  const autoAdapt = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      // A staged route has no stored profile yet; the card's own typed
      // protocol/endpoint are the facts inference has to work with.
      const reply = staged
        ? await api.suggest(route, modelId, modelName, { ...(routeApi === undefined ? {} : { api: routeApi }), ...(routeBaseURL === undefined ? {} : { baseURL: routeBaseURL }) })
        : await api.suggest(route, modelId, modelName)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error === 'no-suggestion' ? t('noSuggestion') : reply.error })
        return
      }
      applySuggestion(reply.suggestion)
    } catch (error) {
      setMessage({ kind: 'error', text: t('writeError', { message: String(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    const next = buildIntent(draft)
    // The modality part travels ONLY when this edit actually changed it: an
    // untouched row must omit the intent entirely -- sending the unset-null
    // here would stamp the durable inputUnset marker onto modalities the
    // user never made any decision about.
    const nextInput = sameModality(modality, initialInput) ? undefined : buildModalityIntent(modality)
    // Nothing armed AND nothing stored: the ladder part of this edit is a
    // no-op, NOT an unset -- sending undefined here would stamp the durable
    // unset marker onto a never-declared model and silence host auto-fill.
    const effortsIntent = next === undefined && initialEfforts === undefined ? 'keep' as const : next
    const manualCompat = compatDraft()
    const baseCompat = appliedCompatRef.current
    let writeCompat = baseCompat !== undefined ? { ...baseCompat, ...(manualCompat ?? {}) } : manualCompat
    if (initialCompat?.supportsThinkingTokenBudget === true && initialCompat?.thinkingTokenBudgetField === undefined && writeCompat?.thinkingTokenBudgetField === undefined && (routeApi ?? '').toLowerCase() === 'openai-completions') {
      writeCompat = { ...(writeCompat ?? {}), thinkingTokenBudgetField: 'thinking_token_budget' }
    }
    setBusy(true)
    setMessage(undefined)
    try {
      // Staged: keep the declaration in memory against the create card's
      // route id; the settings write happens when the injector sees the
      // saved route appear.
      if (staged) {
        api.stageEfforts(route, modelId, effortsIntent, writeCompat, nextInput ?? undefined, defaultEffortIntent)
        dirtyRef.current = false
        setMessage({ kind: 'success', text: t('staged') })
        return
      }
      const reply = await api.writeEfforts(route, modelId, effortsIntent, writeCompat, nextInput, clearedCompatKeys(routeApi, writeCompat), defaultEffortIntent)
      if (!reply.ok) {
        setMessage({
          kind: 'error',
          text: reply.error === 'invalid-models'
            ? t('invalidModels')
            : reply.error === 'conflict'
              ? t('conflict')
              : reply.error,
        })
        return
      }
      dirtyRef.current = false
      setMessage({ kind: 'success', text: t('saved') })
    } catch (error) {
      setMessage({ kind: 'error', text: t('writeError', { message: String(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
    // Back to the SAVED declarations, not to "everything off": Reset means
    // "discard my edits". Clearing a declaration is still one flow away --
    // uncheck everything and Apply (the unset intent).
    dirtyRef.current = false
    setDraft(draftFrom(initialEfforts))
    setModality(modalityFrom(initialInput))
    setDefaultEffort(initialDefaultEffort ?? '')
    setBudgetField(initialCompat?.thinkingTokenBudgetField ?? '')
    setPriorityText(initialCompat?.vllmPriority === undefined ? '' : String(initialCompat.vllmPriority))
    setMaxOutput(initialCompat?.supportsMaxOutputTokens === undefined ? '' : String(initialCompat.supportsMaxOutputTokens))
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
    appliedCompatRef.current = undefined
    setSuggestedInputSource(undefined)
    setReferenceContext(undefined)
    setReferenceMaxTokens(undefined)
    setMessage(undefined)
  }

  // Default-wire warning (issue #2): a stored forced-thinking ladder sends
  // an off-equivalent on Default/test calls. The format prefers the just
  // applied suggestion, else the knowledge base for this route.
  const wireFormat = appliedCompatRef.current?.thinkingFormat
    ?? suggestEfforts(modelId, {
      ...(routeApi === undefined ? {} : { api: routeApi }),
      ...(routeBaseURL === undefined ? {} : { baseURL: routeBaseURL }),
    }).compat?.thinkingFormat
  const wireRisk = defaultWireRisk(initialEfforts, wireFormat)

  const disabled = readOnly || busy

  return (
    <div className="bre-effort-editor" data-plugin={PLUGIN_ID}>
      <div className="bre-effort-head">
        <span className="bre-effort-title">{t('reasoningEffort')}</span>
        <button
          type="button"
          className="bre-link-button"
          disabled={disabled}
          onClick={() => { void autoAdapt() }}
        >
          {t('autoAdapt')}
        </button>
      </div>
      <div className="bre-effort-grid">
        {LEVEL_ORDER.map(level => {
          const cell = draft[level]
          return (
            <label key={level} className="bre-effort-row">
              <input
                type="checkbox"
                checked={cell.on}
                disabled={disabled}
                aria-label={t('level_' + level) + ' ' + String(index + 1)}
                onChange={(event) => { patchLevel(level, event.target.checked) }}
              />
              <span className="bre-effort-level">{t('level_' + level)}</span>
              {/* Every armed level takes a wire input, off included: a
                  non-null off spelling is what some formats send to close
                  thinking (OpenAI's none spelling, or the deepseek/zai
                  explicit disabled object); an empty one sends nothing. */}
              {cell.on
                ? (
                  <input
                    type="text"
                    className="bre-effort-wire"
                    value={cell.wire}
                    disabled={disabled}
                    placeholder={t('wirePlaceholder')}
                    aria-label={t('level_' + level) + ' ' + t('wireValue')}
                    onChange={(event) => { patchWire(level, event.target.value) }}
                  />
                )
                : <span className="bre-effort-empty" />}
            </label>
          )
        })}
      </div>
      {armedLevels.length > 0 ? (
        <div className="bre-modality">
          <span className="bre-effort-title">{t('defaultEffortLabel')}</span>
          <label className="bre-modality-row">
            <select
              className="bre-select"
              disabled={disabled}
              aria-label={t('defaultEffortLabel') + ' ' + String(index + 1)}
              value={defaultEffort}
              onChange={(event) => { markDirty(); setDefaultEffort(event.target.value); setMessage(undefined) }}
            >
              <option value="">{t('defaultEffortUnset')}</option>
              {armedLevels.map(level => (
                <option key={level} value={level}>{t('level_' + level)}</option>
              ))}
            </select>
            {defaultEffort !== '' ? (
              <button
                type="button"
                className="bre-link-button bre-modality-clear"
                disabled={disabled}
                onClick={() => { markDirty(); setDefaultEffort(''); setMessage(undefined) }}
              >
                {t('clearDefaultEffort')}
              </button>
            ) : null}
          </label>
          <p className="bre-modality-note">{t('defaultEffortHint')}</p>
        </div>
      ) : null}
      <div className="bre-modality">
        <span className="bre-effort-title">{t('inputModality')}</span>
        <label className="bre-modality-row">
          <input
            type="checkbox"
            checked={modality.declared && modality.image}
            disabled={disabled}
            aria-label={t('modalityImage') + ' ' + String(index + 1)}
            onChange={(event) => { patchImage(event.target.checked) }}
          />
          <span className="bre-effort-level">{t('modalityImage')}</span>
          {modality.declared
            ? (
              <button
                type="button"
                className="bre-link-button bre-modality-clear"
                disabled={disabled}
                onClick={clearModality}
              >
                {t('clearDeclaration')}
              </button>
            )
            : null}
        </label>
        {!modality.declared ? <p className="bre-modality-note">{t('modalityInherit')}</p> : null}
      </div>
      {(routeApi ?? '').toLowerCase() === 'openai-completions' ? (
        <div className="bre-compat">
          <span className="bre-effort-title">{t('compatTitle')}</span>
          <label className="bre-compat-row">
            <span className="bre-compat-label">{t('budgetFieldLabel')}</span>
            <select
              className="bre-select"
              disabled={disabled}
              aria-label={t('budgetFieldLabel') + ' ' + String(index + 1)}
              value={budgetField}
              onChange={(event) => { markDirty(); setBudgetField(event.target.value); setMessage(undefined) }}
            >
              <option value="">{t('budgetUnset')}</option>
              <option value="thinking_token_budget">thinking_token_budget</option>
              <option value="thinking_budget">thinking_budget</option>
              <option value="thinking_budget_tokens">thinking_budget_tokens</option>
            </select>
            <span className="bre-compat-hint">{t('budgetFieldHint')}</span>
          </label>
          <div className="bre-compat-row">
            <label className="bre-compat-field">
              <span className="bre-compat-label">{t('priorityLabel')}</span>
              <input
                type="text"
                inputMode="numeric"
                className="bre-text-input"
                value={priorityText}
                disabled={disabled}
                placeholder={t('priorityPlaceholder')}
                aria-label={t('priorityLabel') + ' ' + String(index + 1)}
                onChange={(event) => { markDirty(); setPriorityText(event.target.value); setMessage(undefined) }}
              />
            </label>
            <span className="bre-compat-hint">{t('priorityHint')}</span>
            {priorityText.trim() !== '' && !/^-?\d+$/.test(priorityText.trim()) ? <p className="bre-effort-note bre-error">{t('priorityInvalid')}</p> : null}
          </div>
          {initialCompat?.supportsThinkingTokenBudget === true && initialCompat?.thinkingTokenBudgetField === undefined ? <p className="bre-effort-note">{t('aliasMigrated')}</p> : null}
        </div>
      ) : null}
      {(routeApi ?? '').toLowerCase() === 'openai-responses' ? (
        <div className="bre-compat">
          <span className="bre-effort-title">{t('compatTitle')}</span>
          <label className="bre-compat-row">
            <span className="bre-compat-label">{t('maxOutputLabel')}</span>
            <select
              className="bre-select"
              disabled={disabled}
              aria-label={t('maxOutputLabel') + ' ' + String(index + 1)}
              value={maxOutput}
              onChange={(event) => { markDirty(); setMaxOutput(event.target.value); setMessage(undefined) }}
            >
              <option value="">{t('maxOutputUnset')}</option>
              <option value="true">{t('maxOutputOn')}</option>
              <option value="false">{t('maxOutputOff')}</option>
            </select>
            <span className="bre-compat-hint">{t('maxOutputHint')}</span>
          </label>
        </div>
      ) : null}
      {staged ? <p className="bre-effort-note">{t('stagedHint')}</p> : null}
      {initialEfforts === false ? <p className="bre-effort-note">{t('reasoningDisabled')}</p> : null}
      {wireRisk === undefined
        ? null
        : <p className="bre-effort-note">{t(wireRisk === 'thinking-disabled' ? 'defaultRiskDisabled' : 'defaultRiskQwen')}</p>}
      {/* Unsetting says what it does: the save path below turns an
          all-off draft over a stored declaration into the durable unset
          marker, i.e. bare provider-default requests (the relay-compat
          mode of issue #2). Never-declared rows map to keep, so the hint
          stays hidden there exactly as the write does. */}
      {buildIntent(draft) === undefined && initialEfforts !== undefined
        ? <p className="bre-effort-note">{t('bareHint')}</p> : null}
      {suggested !== undefined ? (
        <div className="bre-suggestion">
          <p className="bre-effort-note">
            {t('appliedHint', { source: suggestedSource, confidence: t('confidence_' + suggestedConfidence) })}
          </p>
          {suggestedInputSource === undefined
            ? null
            : (
              <p className="bre-effort-note">
                {suggestedInputSource === 'endpoint'
                  ? t('inputHintEndpoint')
                  : suggestedInputSource === 'knowledge'
                    ? t('inputHintKnowledge')
                    : t('inputHintHeuristic')}
              </p>
            )}
          {referenceContext === undefined && referenceMaxTokens === undefined
            ? null
            : (
              <div className="bre-reference">
                <span className="bre-reference-title">{t('referenceTitle')}</span>
                <span className="bre-reference-values">
                  {referenceContext === undefined ? null : (
                    <span>{t('contextWindowLabel')} <b>{COUNT.format(referenceContext)}</b></span>
                  )}
                  {referenceMaxTokens === undefined ? null : (
                    <span>{t('maxTokensLabel')} <b>{COUNT.format(referenceMaxTokens)}</b></span>
                  )}
                </span>
              </div>
            )}
        </div>
      ) : null}
      {message === undefined ? null : (
        <p className={'bre-effort-message bre-' + message.kind} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      <div className="bre-effort-actions">
        <button
          type="button"
          className="bre-primary-button"
          disabled={disabled || !changed}
          onClick={() => { void save() }}
        >
          {busy ? t('saving') : staged ? t('stage') : t('apply')}
        </button>
        <button
          type="button"
          className="bre-secondary-button"
          disabled={disabled}
          onClick={reset}
        >
          {t('reset')}
        </button>
      </div>
    </div>
  )
}

export type { DraftLevels }
