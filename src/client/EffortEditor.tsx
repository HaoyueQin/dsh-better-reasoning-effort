/**
 * The thinking-effort editor injected into the official Models page's model
 * rows. Rendered with `ReactDOM.createRoot` into a DOM container the injector
 * creates, it needs no harness services of its own: everything arrives through
 * a plain props face, so it stays testable in isolation.
 *
 * @module dsh-better-reasoning-effort/EffortEditor
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  THINKING_LEVELS,
  type ReasoningEfforts,
  type ThinkingLevel,
} from '../knowledge.js'
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

const LEVEL_ORDER: readonly ThinkingLevel[] = [...THINKING_LEVELS]

/** Current declaration as a set of enabled levels. */
function enabledLevels(efforts: false | ReasoningEfforts | undefined): Set<ThinkingLevel> {
  if (efforts === false) return new Set()
  if (efforts === undefined) return new Set()
  return new Set(LEVEL_ORDER.filter(level => Object.prototype.hasOwnProperty.call(efforts, level)))
}

/** Draft state of one level's wire value. */
type DraftLevels = Record<ThinkingLevel, { on: boolean; wire: string }>

function draftFrom(efforts: false | ReasoningEfforts | undefined): DraftLevels {
  const draft = {} as DraftLevels
  for (const level of LEVEL_ORDER) {
    if (efforts === undefined || efforts === false) {
      draft[level] = { on: false, wire: '' }
      continue
    }
    const wire = efforts[level]
    draft[level] = {
      on: wire !== undefined,
      wire: wire === null ? '' : typeof wire === 'string' ? wire : '',
    }
  }
  return draft
}

/** Build a reasoningEfforts value from the draft; `false` disables reasoning. */
function buildEfforts(draft: DraftLevels): ReasoningEfforts | false {
  const out: ReasoningEfforts = {}
  let thinking = false
  for (const level of LEVEL_ORDER) {
    const cell = draft[level]
    if (!cell.on) continue
    if (level === 'off') {
      out.off = null
      continue
    }
    const wire = cell.wire.trim()
    if (wire.length === 0) {
      // A level switched on without a spelling defaults to its own name —
      // the convention every OpenAI-compatible endpoint follows.
      out[level] = level
    } else {
      out[level] = wire
    }
    thinking = true
  }
  return thinking ? out : false
}

/** The one error the settings schema rejects: a dict that names no thinking level. */
function hasThinking(draft: DraftLevels): boolean {
  return LEVEL_ORDER.some(level => level !== 'off' && draft[level].on)
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

  const changed = JSON.stringify(buildEfforts(draft)) !== JSON.stringify(initialEfforts ?? false)

  const patchLevel = (level: ThinkingLevel, on: boolean): void => {
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

  const patchWire = (level: ThinkingLevel, wire: string): void => {
    setDraft(current => ({ ...current, [level]: { ...current[level], wire } }))
    setMessage(undefined)
  }

  const applySuggestion = (efforts: ReasoningEfforts, source: string): void => {
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
    if (!hasThinking(draft)) {
      setMessage({ kind: 'error', text: t('needThinking') })
      return
    }
    const next = buildEfforts(draft)
    setBusy(true)
    setMessage(undefined)
    try {
      const reply = await api.writeEfforts(route, modelId, next)
      if (!reply.ok) {
        setMessage({ kind: 'error', text: reply.error })
        return
      }
      setMessage({ kind: 'success', text: t('saved') })
    } catch (error) {
      setMessage({ kind: 'error', text: t('writeError', { message: String(error) }) })
    } finally {
      setBusy(false)
    }
  }

  const reset = (): void => {
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
          disabled={disabled || !changed || !hasThinking(draft)}
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
