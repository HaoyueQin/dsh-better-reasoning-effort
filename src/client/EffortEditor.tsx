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
export function EffortEditor({ route, routeDisplayName, routeApi, routeBaseURL, modelId, modelName, efforts: initialEfforts, index, api, readOnly, t }: EffortEditorProps): ReactNode {
  const [draft, setDraft] = useState<DraftLevels>(() => draftFrom(initialEfforts))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | undefined>(undefined)
  const [suggested, setSuggested] = useState<ReasoningEfforts | undefined>(undefined)
  const [suggestedSource, setSuggestedSource] = useState('')
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

  const applySuggestion = (efforts: ReasoningEfforts, source: string): void => {
    markDirty()
    setDraft(draftFrom(efforts))
    setSuggested(efforts)
    setSuggestedSource(source)
    setMessage({ kind: 'info', text: t('suggestionApplied') })
  }

  const autoAdapt = async (): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    try {
      const reply = await api.suggest(route, modelId, modelName)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error === 'no-suggestion' ? t('noSuggestion') : reply.error })
        return
      }
      applySuggestion(reply.suggestion.efforts, reply.suggestion.source)
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
    dirtyRef.current = false
    setDraft(draftFrom(undefined))
    setSuggested(undefined)
    setSuggestedSource('')
    setMessage(undefined)
  }

  const disabled = readOnly || busy

  return (
    <div className="bre-effort-editor" data-plugin="dsh-better-reasoning-effort">
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
          const isOff = level === 'off'
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
              {cell.on
                ? (
                  <input
                    type="text"
                    className="bre-effort-wire"
                    value={cell.wire}
                    disabled={disabled}
                    placeholder={isOff ? t('offPlaceholder') : t('wirePlaceholder')}
                    aria-label={`${t(`level_${level}`)} ${t('wireValue')}`}
                    onChange={(event) => { patchWire(level, event.target.value) }}
                  />
                )
                : <span className="bre-effort-empty" />}
            </label>
          )
        })}
      </div>
      {initialEfforts === false ? <p className="bre-effort-note">{t('reasoningDisabled')}</p> : null}
      {suggested !== undefined ? <p className="bre-effort-note">{t('suggestedHint', { source: suggestedSource })}</p> : null}
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
          {busy ? t('saving') : t('apply')}
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
