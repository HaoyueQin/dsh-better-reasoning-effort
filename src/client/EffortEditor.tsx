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
  /** Route display name (shown in the editor header). */
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
  /** Model row index (for aria labels). */
  index: number
  /**
   * The route is a create card's draft: not saved yet. Apply then stages the
   * declaration instead of writing settings; the injector applies staged
   * declarations automatically once the route is created.
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

/** Read the stored declaration into a draft. */
function modalityFrom(input: InputModalities | undefined): DraftModality {
  if (input === undefined) return { declared: false, image: false }
  return { declared: true, image: input.includes('image') }
}

/** Resolve a modality draft to the write intent (null = durably unset). */
function buildModalityIntent(draft: DraftModality): InputModalities | null {
  if (!draft.declared) return null
  return draft.image ? ['text', 'image'] : ['text']
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
export function EffortEditor({ route, routeDisplayName, routeApi, routeBaseURL, modelId, modelName, efforts: initialEfforts, input: initialInput, index, staged = false, api, readOnly, t }: EffortEditorProps): ReactNode {
  const [draft, setDraft] = useState<DraftLevels>(() => draftFrom(initialEfforts))
  const [modality, setModality] = useState<DraftModality>(() => modalityFrom(initialInput))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | undefined>(undefined)
  const [suggested, setSuggested] = useState<ReasoningEfforts | false | undefined>(undefined)
  const [suggestedSource, setSuggestedSource] = useState('')
  const [suggestedConfidence, setSuggestedConfidence] = useState<'high' | 'medium' | 'low'>('low')
  // The compat block the applied suggestion carries. Survives level tweaks
  // (it describes the wire format, not the level set) so Apply writes the
  // same bytes the host autofill would have written.
  const [suggestedCompat, setSuggestedCompat] = useState<CompatSuggestion | undefined>(undefined)
  // Modality + capacity parts of the applied suggestion. Capacities are
  // DISPLAY-ONLY: they render in the reference block and never touch the
  // official capacity inputs.
  const [suggestedInput, setSuggestedInput] = useState<InputModalities | undefined>(undefined)
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

  useEffect(() => {
    if (!sameEfforts(previousEfforts.current, initialEfforts)) {
      previousEfforts.current = initialEfforts
      if (!dirtyRef.current) setDraft(draftFrom(initialEfforts))
    }
    if (previousInput.current !== initialInput && !dirtyRef.current) {
      const before = previousInput.current
      previousInput.current = initialInput
      // A push that lands while the user is mid-edit must not clobber the
      // draft -- same contract as the level grid above.
      setModality(current => (current.declared && !sameModality(current, before) ? current : modalityFrom(initialInput)))
    }
  }, [initialEfforts, initialInput])

  const changed = !sameEfforts(buildIntent(draft), initialEfforts)
    || !sameModality(modality, initialInput)

  const markDirty = (): void => {
    dirtyRef.current = true
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
    setSuggestedCompat(undefined)
    setSuggestedInput(undefined)
    setSuggestedInputSource(undefined)
    setReferenceContext(undefined)
    setReferenceMaxTokens(undefined)
  }

  const patchLevel = (level: (typeof LEVEL_ORDER)[number], on: boolean): void => {
    markDirty()
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
    setSuggestedCompat(parts.compat)
    setSuggestedInput(parts.input)
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
    const nextInput = buildModalityIntent(modality)
    setBusy(true)
    setMessage(undefined)
    try {
      // Staged: keep the declaration in memory against the create card's
      // route id; the settings write happens when the injector sees the
      // saved route appear.
      if (staged) {
        api.stageEfforts(route, modelId, next, suggestedCompat, nextInput ?? undefined)
        dirtyRef.current = false
        setMessage({ kind: 'success', text: t('staged') })
        return
      }
      const reply = await api.writeEfforts(route, modelId, next, suggestedCompat, nextInput)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error === 'invalid-models' ? t('invalidModels') : reply.error })
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
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
    setSuggestedCompat(undefined)
    setSuggestedInput(undefined)
    setSuggestedInputSource(undefined)
    setReferenceContext(undefined)
    setReferenceMaxTokens(undefined)
    setMessage(undefined)
  }

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
      {staged ? <p className="bre-effort-note">{t('stagedHint')}</p> : null}
      {initialEfforts === false ? <p className="bre-effort-note">{t('reasoningDisabled')}</p> : null}
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
