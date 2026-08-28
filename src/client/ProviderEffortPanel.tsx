/**
 * The alpha.1 slot-mode container: the plugin's entry in the official Models
 * page's 'settings.models.provider-card' keyed slot. One panel renders per
 * pi-ai provider card; inside, one EffortEditor per model the settings
 * document holds for the route.
 *
 * Props are the composed slot face (ui-slots ComposedProps): the owner share
 * (provider/configured/keyConfigured) and the registrant's inject face
 * (wire/subscribe/t) all arrive TOP-LEVEL — the framework flattens them, it
 * does not nest them under an 'inject' prop.
 *
 * Document-driven by construction: the slot hands the provider row, not the
 * page's DOM rows, so a model appears here once it is SAVED. That is the
 * slot's contract and the one interaction difference from the rc.2 DOM
 * bypass (where a typed-but-unsaved row could stage its declaration).
 *
 * @module dsh-better-reasoning-effort/client/ProviderEffortPanel
 */

import { createElement, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { modelsOf } from '../shared.js'
import { EffortEditor } from './EffortEditor.js'
import { createEditorApi, describeNamespace, effortsOf, inputOf, nameOf, providersOf } from './ops.js'
import type { EffortEditorApi, RemoteApi, SettingsJoin } from './types.js'

/** The composed props face the slot framework flattens onto the component. */
export interface ProviderEffortPanelProps {
  // -- owner share (from the page's renderSlot call) --
  /** The card's provider row (route id, display name, namespace, live state). */
  provider: { provider: string; displayName: string; settingsNs: string; active: boolean }
  /** Whether any layer configures this provider; dormant drafts render nothing useful. */
  configured: boolean
  /** Credential fact supplied by the page (unused today; part of the slot contract). */
  keyConfigured: boolean
  // -- registrant inject face (from register()'s inject thunk, flattened) --
  /** Resolve the settings wire lazily; a read is skipped while undefined. */
  wire(): RemoteApi | undefined
  /** Localized copy (the plugin's bound translator). */
  t: (key: string, params?: Record<string, string | number>) => string
  /** Pushed-invalidation subscription; the returned disposer dies with the fiber. */
  subscribe(listener: () => void): () => void
}

/** What one successful describe contributed to this panel. */
interface LoadedRoute {
  models: Record<string, unknown>[]
  profile: Record<string, unknown> | undefined
  readOnly: boolean
}

/**
 * Render the provider's saved models as a column of EffortEditors, refreshed
 * on every pushed invalidation. A panel whose first describe is still in
 * flight renders nothing (no empty-notice flash); a describe failure degrades
 * to a quiet error line — never to a broken mount.
 */
export function ProviderEffortPanel(props: ProviderEffortPanelProps): ReactNode {
  const { provider, configured, wire, t, subscribe } = props
  const [loaded, setLoaded] = useState<LoadedRoute | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const api = wire()
      if (api === undefined) return
      try {
        const join: SettingsJoin = await describeNamespace(api)
        if (!alive) return
        const providers = providersOf(join.namespace)
        setFailed(undefined)
        setLoaded({
          models: modelsOf(providers, provider.provider),
          profile: providers[provider.provider],
          readOnly: join.writable !== true,
        })
      } catch (error) {
        if (alive) setFailed(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    const dispose = subscribe(() => { void load() })
    return () => {
      alive = false
      dispose()
    }
  }, [provider.provider, wire, subscribe])

  const api = useMemo<EffortEditorApi | undefined>(() => {
    const face = wire()
    return face === undefined ? undefined : createEditorApi(face)
  }, [wire])

  if (!configured) return null
  if (failed !== undefined) {
    return createElement('div', { className: 'bre-provider-panel bre-provider-panel-failed' },
      createElement('span', null, t('writeError', { message: failed })))
  }
  // First describe in flight: render nothing instead of flashing the
  // empty notice — the notice is only true once the document answered.
  if (loaded === undefined) return null
  const models = loaded.models
  if (models.length === 0) {
    return createElement('div', { className: 'bre-provider-panel' },
      createElement('span', { className: 'bre-provider-panel-empty' }, t('panelEmpty')))
  }
  return createElement('div', { className: 'bre-provider-panel' },
    models.map((model, index) => {
      const modelId = typeof model['id'] === 'string' ? model['id'] : ''
      if (modelId.length === 0) return null
      const name = nameOf(models, modelId)
      const profile = loaded.profile
      return createElement(EffortEditor, {
        key: modelId,
        route: provider.provider,
        routeDisplayName: provider.displayName,
        ...(typeof profile?.['api'] === 'string' ? { routeApi: profile['api'] as string } : {}),
        ...(typeof profile?.['baseURL'] === 'string' ? { routeBaseURL: profile['baseURL'] as string } : {}),
        modelId,
        ...(name === undefined ? {} : { modelName: name }),
        efforts: effortsOf(models, modelId),
        input: inputOf(models, modelId),
        index,
        api: api as EffortEditorApi,
        readOnly: loaded.readOnly,
        t,
      })
    }),
  )
}
