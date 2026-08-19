/**
 * The fallback settings section: bulk management of every third-party model's
 * thinking effort, plus the one-click preset apply and the auto-adapt actions.
 * Registered as a `settings.section` entry, it is the safety net when the
 * official Models page's DOM no longer exposes the injection anchors — and a
 * convenient place to apply a preset to every model of a route at once.
 *
 * @module dsh-better-reasoning-effort/FallbackSection
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import {
  PRESETS,
  THINKING_LEVELS,
  type ReasoningEfforts,
} from '../knowledge.js'
import type { FlagStore } from './flag.ts'
import type { SettingsJoin } from './injector.ts'
import { createEditorApi, effortsOf, modelsOf, providersOf } from './ops.js'
import type { RemoteApi, SettingsNamespaceView } from './types.js'

/** Props of {@link FallbackSection}. */
export interface FallbackSectionProps {
  /** settings Remote face. */
  api: RemoteApi
  /** Read the pi-ai namespace plus writability. */
  describeNamespace(): Promise<SettingsJoin>
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
  /** Whether the DOM injector is currently active (shown as a status). */
  injectionActive: FlagStore
}

interface RouteView {
  route: string
  displayName: string
  models: { id: string; name?: string; efforts?: false | ReasoningEfforts }[]
}

function levelSummary(efforts: false | ReasoningEfforts | undefined): string {
  if (efforts === false) return 'off'
  if (efforts === undefined) return '—'
  return THINKING_LEVELS.filter(level => Object.prototype.hasOwnProperty.call(efforts, level)).join(', ')
}

/**
 * Render the fallback section: per-route blocks with one-click presets and a
 * flat model list; per-model edits open inline via the shared editor.
 */
export function FallbackSection({ api, describeNamespace, t, injectionActive }: FallbackSectionProps): ReactNode {
  const [namespace, setNamespace] = useState<SettingsNamespaceView | undefined>(undefined)
  const [writable, setWritable] = useState(true)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | undefined>(undefined)
  const injectionActiveNow = useSyncExternalStore(
    injectionActive.subscribe,
    injectionActive.getSnapshot,
  )

  useEffect(() => {
    let stale = false
    void describeNamespace().then(join => {
      if (stale) return
      setNamespace(join.namespace)
      setWritable(join.writable)
      setStatus('ready')
    }).catch(caught => {
      if (stale) return
      setStatus('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    })
    return () => { stale = true }
  }, [describeNamespace])

  const editorApi = createEditorApi(api, async () => namespace)

  if (status === 'loading') return <p className="bre-status">{t('loading')}</p>
  if (status === 'error') return <p className="bre-status bre-error">{error ?? t('writeError', { message: '' })}</p>

  const providers = providersOf(namespace)
  const routes: RouteView[] = Object.entries(providers).map(([route, profile]) => ({
    route,
    displayName: typeof profile['displayName'] === 'string' ? profile['displayName'] as string : route,
    models: modelsOf(providers, route).map(model => ({
      id: typeof model['id'] === 'string' ? model['id'] as string : '',
      ...typeof model['name'] === 'string' ? { name: model['name'] as string } : {},
      ...effortsOf([model], typeof model['id'] === 'string' ? model['id'] as string : '') !== undefined
        ? { efforts: effortsOf([model], typeof model['id'] === 'string' ? model['id'] as string : '') }
        : {},
    })),
  })).filter(routeView => routeView.models.length > 0)

  const applyPreset = async (route: string, preset: ReasoningEfforts): Promise<void> => {
    setMessage(undefined)
    const reply = await editorApi.applyPreset(route, preset)
    if (!reply.ok) {
      setMessage({ kind: 'error', text: reply.error })
      return
    }
    setMessage({ kind: 'success', text: t('appliedToAll', { count: reply.count }) })
    void describeNamespace().then(join => { setNamespace(join.namespace); setWritable(join.writable) })
  }

  return (
    <div className="bre-section">
      <h2>{t('fallbackTitle')}</h2>
      <p>{t('fallbackIntro')}</p>
      <p className={`bre-status ${injectionActiveNow ? 'bre-active' : 'bre-inactive'}`}>
        {t('injectionStatus')}: {injectionActiveNow ? t('injectionActive') : t('injectionInactive')}
      </p>
      {writable === false ? <p className="bre-readonly">{t('readOnly')}</p> : null}
      {message === undefined ? null : (
        <p className={`bre-effort-message bre-${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {routes.length === 0 ? <p>{t('fallbackEmpty')}</p> : null}
      {routes.map(routeView => (
        <div key={routeView.route} className="bre-provider-block">
          <div className="bre-provider-head">
            <span className="bre-provider-name">{routeView.displayName}</span>
            <span className="bre-presets">
              {PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  className="bre-preset-button"
                  disabled={writable === false}
                  title={t('applyPresetToAll', { preset: t(preset.labelKey) })}
                  onClick={() => { void applyPreset(routeView.route, preset.efforts) }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </span>
          </div>
          <div className="bre-model-list">
            {routeView.models.map(model => (
              <div key={`${routeView.route}\u0000${model.id}`} className="bre-model-row">
                <span className="bre-model-id">{model.id}</span>
                <span className="bre-model-levels" title={levelSummary(model.efforts)}>
                  {levelSummary(model.efforts)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
