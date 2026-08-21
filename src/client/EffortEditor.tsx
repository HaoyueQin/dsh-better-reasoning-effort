/**
 * The thinking-effort editor injected into the official Models page's model
 * rows. Rendered with `ReactDOM.createRoot` into a DOM container the injector
 * creates, it needs no harness services of its own: everything arrives through
 * a plain props face, so it stays testable in isolation. The draft/intent
 * rules live in {@link module:dsh-better-reasoning-effort/client/effort}.
 *
 * @module dsh-better-reasoning-effort/EffortEditor
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PLUGIN_MARKER } from '../constants.js'
import type {
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

/**
 * Render one model's thinking-effort editor: the level checkboxes, the wire
 * spellings, the auto-adapt action, and the apply/reset actions.
 */
export function EffortEditor({ route, routeDisplayName, routeApi, routeBaseURL, modelId, modelName, efforts: initialEfforts, index, staged = false, api, readOnly, t }: EffortEditorProps): ReactNode {
  const [draft, setDraft] = useState<DraftLevels>(() => draftFrom(initialEfforts))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | undefined>(undefined)
  const [suggested, setSuggested] = useState<ReasoningEfforts | false | undefined>(undefined)
  const [suggestedSource, setSuggestedSource] = useState('')
  const [suggestedConfidence, setSuggestedConfidence] = useState<'high' | 'medium' | 'low'>('low')
  // Once the user edits, the draft owns the row: a re-render that changes
  // `initialEfforts` (the official page re-renders on its own edits and on
  // apply) must not overwrite in-flight input. Before any edit the draft
  // simply follows the props.
  const dirtyRef = useRef(false)
  const previousEfforts = useRef<false | ReasoningEfforts | undefined>(initialEfforts)

  useEffect(() => {
    if (sameEfforts(previousEfforts.current, initialEfforts)) return
    previousEfforts.current = initialEfforts
    if (dirtyRef.current) return
    setDraft(draftFrom(initialEfforts))
  }, [initialEfforts])

  const changed = !sameEfforts(buildIntent(draft), initialEfforts)

  const markDirty = (): void => {
    dirtyRef.current = true
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
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

  const applySuggestion = (efforts: ReasoningEfforts | false, source: string, confidence: 'high' | 'medium' | 'low'): void => {
    markDirty()
    setDraft(draftFrom(efforts))
    setSuggested(efforts)
    setSuggestedSource(source)
    setSuggestedConfidence(confidence)
    setMessage({ kind: 'info', text: t('suggestionApplied') })
  }

  const autoAdapt = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      // A staged route has no stored profile yet; the card's own typed
      // protocol/endpoint are the facts inference has to work with.
      const reply = staged
        ? await api.suggest(route, modelId, modelName, { ...routeApi === undefined ? {} : { api: routeApi }, ...routeBaseURL === undefined ? {} : { baseURL: routeBaseURL } })
        : await api.suggest(route, modelId, modelName)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error === 'no-suggestion' ? t('noSuggestion') : reply.error })
        return
      }
      applySuggestion(reply.suggestion.efforts, reply.suggestion.source, reply.suggestion.confidence)
    } catch (error) {
      setMessage({ kind: 'error', text: t('writeError', { message: String(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    const next = buildIntent(draft)
    setBusy(true)
    setMessage(undefined)
    try {
      // Staged: keep the declaration in memory against the create card's
      // route id; the settings write happens when the injector sees the
      // saved route appear.
      if (staged) {
        api.stageEfforts(route, modelId, next)
        dirtyRef.current = false
        setMessage({ kind: 'success', text: t('staged') })
        return
      }
      const reply = await api.writeEfforts(route, modelId, next)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error })
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
    // Back to the SAVED declaration, not to "everything off": Reset means
    // "discard my edits". Clearing the declaration is still one flow away —
    // uncheck every level and Apply (the unset intent).
    dirtyRef.current = false
    setDraft(draftFrom(initialEfforts))
    setSuggested(undefined)
    setSuggestedSource('')
    setSuggestedConfidence('low')
    setMessage(undefined)
  }

  const disabled = readOnly || busy

  return (
    <div className="bre-effort-editor" data-plugin={PLUGIN_MARKER}>
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
            <label key={level} className={`bre-effort-row${cell.on ? ' bre-on' : ''}`}>
              <input
                type="checkbox"
                checked={cell.on}
                disabled={disabled}
                aria-label={`${t(`level_${level}`)} ${String(index + 1)}`}
                onChange={(event) => { patchLevel(level, event.target.checked) }}
              />
              <span className="bre-effort-level">{t(`level_${level}`)}</span>
              {/* Every armed level takes a wire input, off included: a
                  non-null off spelling is what some formats send to close
                  thinking (OpenAI's `none`, the deepseek/zai formats'
                  `thinking: disabled`); an empty one sends nothing. */}
              {cell.on
                ? (
                  <input
                    type="text"
                    className="bre-effort-wire"
                    value={cell.wire}
                    disabled={disabled}
                    placeholder={t('wirePlaceholder')}
                    aria-label={`${t(`level_${level}`)} ${t('wireValue')}`}
                    onChange={(event) => { patchWire(level, event.target.value) }}
                  />
                )
                : <span className="bre-effort-empty" />}
            </label>
          )
        })}
      </div>
      {staged ? <p className="bre-effort-note">{t('stagedHint')}</p> : null}
      {initialEfforts === false ? <p className="bre-effort-note">{t('reasoningDisabled')}</p> : null}
      {suggested !== undefined ? (
        <p className="bre-effort-note">
          {t('suggestedHint', { source: suggestedSource, confidence: t(`confidence_${suggestedConfidence}`) })}
        </p>
      ) : null}
      {message === undefined ? null : (
        <p className={`bre-effort-message bre-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
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
