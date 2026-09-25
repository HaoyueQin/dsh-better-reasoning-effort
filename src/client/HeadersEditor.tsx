/**
 * The provider-card request-header editor (issue #12, MVP-1) — the fetch-layer
 * `user-agent` takeover is its MVP-2 half, rendered in the same section because
 * to the user they are one thing: "what this route sends".
 *
 * Mounted through the OFFICIAL seat, `settings.models.provider-card`, which the
 * Models section dispatches per provider card. That is a sanctioned extension
 * point, so unlike the per-model effort editor this component needs no DOM
 * injection, no mutation observer and no anchor labels.
 *
 * Write discipline: the draft is a whole dict and only the explicit Save writes
 * it, so an edit can never race a stale snapshot of the same card the way
 * per-keystroke writes would — and Cancel/Reload behaves like the official
 * card's own fields. The headers land through `llm-pi-ai.providers.<route>.headers`,
 * the one channel the adapter actually sends.
 *
 * @module dsh-better-reasoning-effort/HeadersEditor
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { HEADERS_CONFIG_PATH, PLUGIN_ID } from '../constants.js'
import { describeNamespace, providerHeadersOf, writeProviderHeaders, type ProviderHeadersReply } from './ops.js'
import type { RemoteApi } from './types.js'

/**
 * Offered client identities, most useful first. These are the shapes relays
 * that police the `user-agent` look for; every one is a preset, never a filter
 * — the field stays free text.
 */
const USER_AGENT_PRESETS: readonly string[] = [
  'claude-cli/2.1.161 (external, cli)',
  'claude-code/1.0.0',
  'Kilo-Code/1.0',
]

/** The fixed fetch-layer report the host route serves. */
export interface HeaderEnvironment {
  /** Whether the fetch-layer takeover is enabled in this deployment. */
  enabled: boolean
  /** Whether the plugin's wrapper currently owns the global fetch. */
  installed: boolean
  /** Routes whose `user-agent` the plugin is sending. */
  overrides: { origin: string; route: string; userAgent: string }[]
  /** Origins two routes claim with different values. */
  conflicts: { origin: string; routes: string[]; values: string[] }[]
  /** What was found of the plugins rewriting the same surface. */
  environment: {
    adapter: 'patched' | 'stock' | 'unknown'
    siblings: { name: string; path: string }[]
    preferOfficialLayer: boolean
  }
}

/** Props of {@link HeadersEditor}. */
export interface HeadersEditorProps {
  /** The provider route this card edits. */
  route: string
  /** Route display name (for the section heading's aria labels). */
  routeDisplayName: string
  /** The write seam. */
  api: RemoteApi
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
}

/** One editable header row; a stable `id` keeps React keys off the name. */
interface DraftRow {
  id: number
  name: string
  value: string
}

/** A draft as the editor holds it: ordered rows plus the UA choice. */
interface Draft {
  rows: DraftRow[]
  userAgent: string
}

/** Build a draft from a stored headers dict, splitting the UA out of the rows. */
function draftFrom(headers: Record<string, string> | undefined): Draft {
  const rows: DraftRow[] = []
  let userAgent = ''
  let id = 0
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === 'user-agent') {
      userAgent = value
      continue
    }
    rows.push({ id: id += 1, name, value })
  }
  return { rows, userAgent }
}

/** The headers dict a draft stores: blank rows dropped, UA merged back in. */
export function headersFromDraft(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of draft.rows) {
    const name = row.name.trim()
    if (name.length === 0) continue
    out[name] = row.value
  }
  const userAgent = draft.userAgent.trim()
  if (userAgent.length > 0) out['user-agent'] = userAgent
  return out
}

/**
 * Render the provider card's request-header section.
 * @param props - route identity, write seam and copy.
 * @returns the section.
 */
export function HeadersEditor({ route, api, t }: HeadersEditorProps): ReactNode {
  const [stored, setStored] = useState<Record<string, string> | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>({ rows: [], userAgent: '' })
  /** Whether the section's details are disclosed. Collapsed on mount. */
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | undefined>(undefined)
  const [environment, setEnvironment] = useState<HeaderEnvironment | undefined>(undefined)
  const nextRowId = useRef(1)

  // Seed the draft from the stored document. The slot hands the editor a route,
  // not a profile: the section reads the pi-ai namespace itself, so the card
  // re-renders that the section pushes cannot hand it a stale draft.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const join = await describeNamespace(api)
        if (!live) return
        const headers = providerHeadersOf(join.namespace, route)
        setStored(headers)
        setDraft(draftFrom(headers))
        setReadOnly(join.writable !== true)
      } catch {
        // A read failure leaves the section inert rather than blocking the card.
        if (live) setReadOnly(true)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [api, route])

  // The fetch-layer report is a host fact the page cannot observe on its own:
  // read once per mount, and never let its absence break the editor.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch(HEADERS_CONFIG_PATH, { method: 'GET' })
        const body = await response.json() as { ok?: boolean; data?: HeaderEnvironment }
        if (live && body.ok === true && body.data !== undefined) setEnvironment(body.data)
      } catch {
        // Older host, or a page that cannot reach its own origin: stay silent.
      }
    })()
    return () => { live = false }
  }, [])

  const addRow = (): void => {
    setDraft(current => ({ ...current, rows: [...current.rows, { id: nextRowId.current += 1, name: '', value: '' }] }))
    setMessage(undefined)
  }

  const patchRow = (id: number, patch: Partial<DraftRow>): void => {
    setDraft(current => ({ ...current, rows: current.rows.map(row => (row.id === id ? { ...row, ...patch } : row)) }))
    setMessage(undefined)
  }

  const removeRow = (id: number): void => {
    setDraft(current => ({ ...current, rows: current.rows.filter(row => row.id !== id) }))
    setMessage(undefined)
  }

  const cancel = (): void => {
    setDraft(draftFrom(stored))
    setEditing(false)
    setMessage(undefined)
  }

  const save = async (next: Record<string, string>): Promise<void> => {
    setBusy(true)
    setMessage(undefined)
    let reply: ProviderHeadersReply
    try {
      reply = await writeProviderHeaders(api, route, next)
    } catch (error) {
      reply = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    setBusy(false)
    if (!reply.ok) {
      setMessage({
        kind: 'error',
        text: reply.error === 'no-route' ? t('headersNoRoute')
          : reply.error === 'read-only' ? t('headersReadOnly')
            : t('headersError', { error: reply.error }),
      })
      return
    }
    setStored(next)
    setEditing(false)
    // Saving opened the section (edit mode is always disclosed); landing the
    // write keeps it open so the user sees the new value rather than watching
    // the card snap shut under them.
    setMessage({
      kind: 'success',
      text: Object.keys(next).length === 0 ? t('headersCleared') : t('headersSaved'),
    })
  }

  const rows = Object.entries(stored ?? {})
  const disabled = readOnly || busy
  // Collapsed by default: the card is a list of providers, and a section that
  // pushed its hint, its rows and its warnings into every card would bury the
  // list. Collapsed shows the section's identity only — what it is called and
  // whether anything is configured — and the disclosure arrow opens the rest.
  const count = rows.length

  return (
    <div className="bre-headers" data-plugin={PLUGIN_ID} data-open={open ? '1' : '0'}>
      <div className="bre-headers-head">
        {editing
          ? <span className="bre-effort-title">{t('headersTitle')}</span>
          : (
            <button
              type="button"
              className="bre-headers-disclosure"
              aria-expanded={open}
              aria-label={`${t('headersTitle')} ${route}`}
              onClick={() => { setOpen(!open); setMessage(undefined) }}
            >
              <span className="bre-effort-title">{t('headersTitle')}</span>
              {loading || count === 0
                ? null
                : <span className="bre-headers-count">{count}</span>}
              <span className="bre-headers-chevron" aria-hidden="true">›</span>
            </button>
          )}
      </div>

      {!open && !editing
        ? null
        : (
          <>
            <p className="bre-effort-note">{t('headersHint')}</p>

            {/* The coexistence report. It is the difference between "the value I
                typed is on the wire" and "another plugin is winning", which the
                user cannot tell from the settings document alone. */}
            {environment === undefined
              ? null
              : (
                <>
                  {environment.environment.preferOfficialLayer
                    ? <p className="bre-effort-note bre-warn">{t('headersConflictPatched')}</p>
                    : null}
                  {environment.conflicts.length === 0
                    ? null
                    : <p className="bre-effort-note bre-warn">{t('headersConflictOrigin')}</p>}
                  {environment.environment.siblings.length === 0
                    ? null
                    : (
                      <p className="bre-effort-note bre-warn">
                        {t('headersConflictSiblings', { names: environment.environment.siblings.map(item => item.name).join(', ') })}
                      </p>
                    )}
                </>
              )}

            {loading
              ? null
              : editing
                ? (
                  <div className="bre-headers-edit">
                    {draft.rows.map(row => (
                      <div className="bre-headers-row" key={row.id}>
                        <input
                          type="text"
                          className="bre-text-input bre-headers-name"
                          value={row.name}
                          disabled={disabled}
                          placeholder={t('headersNamePlaceholder')}
                          aria-label={t('headersName')}
                          onChange={(event) => { patchRow(row.id, { name: event.target.value }) }}
                        />
                        <input
                          type="text"
                          className="bre-text-input bre-headers-value"
                          value={row.value}
                          disabled={disabled}
                          placeholder={t('headersValue')}
                          aria-label={t('headersValue')}
                          onChange={(event) => { patchRow(row.id, { value: event.target.value }) }}
                        />
                        <button
                          type="button"
                          className="bre-link-button"
                          disabled={disabled}
                          aria-label={`${t('headersClear')} ${row.name}`}
                          onClick={() => { removeRow(row.id) }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button type="button" className="bre-link-button" disabled={disabled} onClick={addRow}>
                      {t('headersAdd')}
                    </button>
                    <label className="bre-headers-row">
                      <span className="bre-effort-title">{t('headersUserAgentTitle')}</span>
                      <input
                        type="text"
                        className="bre-text-input bre-headers-value"
                        value={draft.userAgent}
                        disabled={disabled}
                        list="bre-ua-presets"
                        placeholder={t('headersUserAgentPlaceholder')}
                        aria-label={t('headersUserAgentTitle')}
                        onChange={(event) => {
                          setDraft(current => ({ ...current, userAgent: event.target.value }))
                          setMessage(undefined)
                        }}
                      />
                      {draft.userAgent.trim().length === 0
                        ? null
                        : (
                          <button
                            type="button"
                            className="bre-link-button"
                            disabled={disabled}
                            onClick={() => { setDraft(current => ({ ...current, userAgent: '' })); setMessage(undefined) }}
                          >
                            {t('headersUserAgentClear')}
                          </button>
                        )}
                    </label>
                    <datalist id="bre-ua-presets">
                      {USER_AGENT_PRESETS.map(preset => <option key={preset} value={preset} />)}
                    </datalist>
                    <p className="bre-effort-note">{t('headersUserAgentHint')}</p>
                    <div className="bre-effort-actions">
                      <button
                        type="button"
                        className="bre-primary-button"
                        disabled={disabled}
                        onClick={() => { void save(headersFromDraft(draft)) }}
                      >
                        {t('headersSave')}
                      </button>
                      <button type="button" className="bre-secondary-button" disabled={disabled} onClick={cancel}>
                        {t('headersCancel')}
                      </button>
                    </div>
                  </div>
                )
                : (
                  <div className="bre-headers-rows">
                    {rows.length === 0
                      ? <p className="bre-effort-note">{t('headersEmpty')}</p>
                      : rows.map(([name, value]) => (
                        <div className="bre-headers-row" key={name}>
                          <span className="bre-headers-name">{name}</span>
                          {/* Masked: the official README warns that a credential in
                              `headers` is not reached by the harness redactor, so the
                              value must not sit in plain sight on a shared screen. */}
                          <span className="bre-headers-value bre-headers-masked">{'•'.repeat(Math.min(value.length, 24))}</span>
                        </div>
                      ))}
                    {readOnly
                      ? null
                      : (
                        <div className="bre-effort-actions">
                          <button
                            type="button"
                            className="bre-secondary-button"
                            disabled={disabled}
                            onClick={() => { setEditing(true); setMessage(undefined) }}
                          >
                            {t('headersEdit')}
                          </button>
                        </div>
                      )}
                  </div>
                )}
          </>
        )}

      {message === undefined
        ? null
        : (
          <p className={'bre-effort-message bre-' + message.kind} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
    </div>
  )
}
