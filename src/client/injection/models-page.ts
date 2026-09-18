/**
 * The Models-page DOM injection.
 *
 * Owns the document-wide MutationObserver, the debounced scan, the editor
 * mounts, the host-label anchors and the ledger teardown. The scan itself is
 * `reconcile()` from the editor injector; this module is the wiring and the
 * lifecycle around it.
 *
 * The composer path is NOT this module's business: the caller hands
 * `start()` a synchronous hook that runs on every mutation burst BEFORE the
 * debounced scan, because the composer body must land before the first paint
 * while the settings-page scan does heavy wire reads.
 *
 * @module dsh-better-reasoning-effort/client/injection/models-page
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { PLUGIN_ID } from '../../constants.js'
import { EffortEditor } from '../EffortEditor.tsx'
import {
  createScanState, reconcile,
  type HostLabels, type InjectorDeps, type ScanState,
} from './models-page-editor.js'
import { describeNamespace } from '../ops.ts'
import type { ClientContext, RemoteApi } from '../types.js'
import { EffortBoundary, panelRoot } from './mount.js'

/** Dictionary namespace owning the Models page's copy (ui-settings-models). */
const HOST_MODELS_NS = 'settings.models'

/**
 * The official Models-page controls this plugin anchors to, as
 * (dictionary key, English copy) pairs — the English copy is both the anchor
 * for a host that ships no such namespace and the language the host itself
 * falls back to, so it stays valid in every configuration. Resolved through
 * the host's own dictionary so a third language (or a late language pack)
 * relabels the page and the anchors together.
 */
const HOST_LABEL_KEYS = {
  capacity: ['modelAdvanced', 'Capacities'],
  modelId: ['modelId', 'Model ID'],
  modelName: ['modelName', 'Display name'],
  routeId: ['customRoute', 'Provider ID'],
  baseUrl: ['baseUrl', 'Base URL'],
  apiProtocol: ['customApi', 'API protocol'],
} as const satisfies Record<keyof HostLabels, readonly [string, string]>

/** What the Models-page injection needs from its host. */
export interface ModelsPageDeps {
  /** The client root context. */
  ctx: ClientContext
  /** The settings remote the editors read and write through. */
  api: RemoteApi
  /** The plugin's locale-bound translator. */
  t: Translate
  /** Wrap a subtree so it re-translates on a language switch. */
  refreshed: (children: () => ReactNode) => ReactNode
}

/** The Models-page injection's face. */
export interface ModelsPageInjection {
  /** The live scan state (the ledger teardown drains it). */
  readonly state: ScanState
  /** The host label anchors in the host's ACTIVE language. */
  labels: () => HostLabels
  /**
   * Begin observing. `onComposerMutation` runs synchronously on every mutation
   * burst, before the debounced scan.
   */
  start: (onComposerMutation: () => void) => void
  /** Disconnect the observer and cancel the pending scan. */
  stopObserver: () => void
  /**
   * Stop observing and unmount every editor this plugin created. The fiber is
   * going away: orphaned editors would keep rendering with a stale api face.
   */
  teardown: () => void
  /** Force a rescan (document update, connection reset, preference flip). */
  schedule: () => void
}

/**
 * Build the Models-page injection.
 * @param deps - context, settings remote, copy, idle hook and locale refresh.
 * @returns the injection's {@link ModelsPageInjection} face.
 */
export function createModelsPage(deps: ModelsPageDeps): ModelsPageInjection {
  const { ctx, api, t, refreshed } = deps

  /**
   * The official controls' aria-labels in the host's ACTIVE language.
   *
   * A thunk, never a cached value: the host renders those labels from its own
   * dictionary through its own fallback chain, so re-reading per scan is what
   * keeps a language switch (or a late language pack) from stranding the
   * anchors on words the page no longer prints.
   */
  const labels = (): HostLabels => {
    const translate = ctx.locale.bind(HOST_MODELS_NS) as (key: string) => string
    const resolve = ([key, fallback]: readonly [string, string]): readonly string[] => {
      const value = translate(key)
      // A host with no such namespace makes translate() echo the key back.
      return value === key || value.trim() === '' ? [fallback] : [value, fallback]
    }
    return {
      capacity: resolve(HOST_LABEL_KEYS.capacity),
      modelId: resolve(HOST_LABEL_KEYS.modelId),
      modelName: resolve(HOST_LABEL_KEYS.modelName),
      routeId: resolve(HOST_LABEL_KEYS.routeId),
      baseUrl: resolve(HOST_LABEL_KEYS.baseUrl),
      apiProtocol: resolve(HOST_LABEL_KEYS.apiProtocol),
    }
  }

  /** Debounce window for DOM-mutation scans (one scan per render burst). */
  const SCAN_DEBOUNCE_MS = 120
  const scanState = createScanState()
  let scanTimer: number | undefined
  let observer: MutationObserver | undefined
  let composerMutation: (() => void) | undefined

  /**
   * The injector's dependencies, built ONCE outside the debounced scan: the
   * teardown path (plugin dispose, page unload) drains the ledgers through the
   * very same seam a live scan uses, so a landing write can never take a
   * different path than an in-session one.
   */
  const injectorDeps: InjectorDeps = {
    api,
    describeNamespace: () => describeNamespace(api),
    t,
    labels,
    mount(container, props) {
      const rootEl = document.createElement('div')
      // The slot class carries the grid-column span: this wrapper — not
      // the React editor inside it — is the item the official disclosure
      // grid places (see STYLES).
      rootEl.className = 'bre-effort-slot'
      // Mark the container synchronously — before React renders — so the
      // idempotency guard (hasEditor) holds from the very first scan.
      // Without this, the appendChild-triggered MutationObserver scan can
      // run while React's async render has not produced the editor div
      // yet, misjudge the row as unmounted, and mount again — an infinite
      // loop that grows the container without bound.
      rootEl.dataset['plugin'] = PLUGIN_ID
      container.appendChild(rootEl)
      const reactRoot = createRoot(rootEl)
      const renderEditor = (p: typeof props): void => {
        reactRoot.render(createElement(
          EffortBoundary,
          {
            fallbackText: t('renderFailed'),
            // Same seat as the composer bodies: without the locale
            // subscription a language switch re-renders the official page
            // but not this editor — sameProps compares only document data,
            // so the copy would stay in the language it rendered in.
            children: refreshed(() => createElement(EffortEditor, p)),
          },
        ))
      }
      renderEditor(props)
      return {
        unmount: () => { reactRoot.unmount() },
        render: renderEditor,
      }
    },
  }

  const schedule = (): void => {
    if (scanTimer !== undefined) return
    // Debounce: the official page re-renders in bursts (typing, expanding,
    // applying); one scan per frame keeps the editor stable mid-keystroke.
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      // The composer path rides along: the debounced scan is the only thing
      // that covers the paths no mutation carries — apply boot and a slider
      // preference flip.
      composerMutation?.()
      reconcile(panelRoot(), injectorDeps, scanState)
    }, SCAN_DEBOUNCE_MS)
  }

  const start = (onComposerMutation: () => void): void => {
    if (observer !== undefined) return
    composerMutation = onComposerMutation
    // A session may already be resident when the fiber starts (page reload,
    // HMR): wire it before the first mutation has a chance to land.
    onComposerMutation()
    observer = new MutationObserver(() => {
      // The composer path runs SYNCHRONOUSLY on the mutation microtask: the
      // React commit that opens the menu and this callback are delivered
      // before the browser's next paint, so the FIRST painted frame already
      // carries the replicated popover — the official menu never flashes and
      // is never "covered". The settings-page editor/toggle reconciles stay
      // debounced below (they do heavy wire reads).
      // The effort-memory wiring leads the callback for the same reason: a
      // session switch lands as a DOM mutation, and the new session's
      // directory must be watched before its projection can read as Default.
      onComposerMutation()
      schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    schedule()
  }

  const stopObserver = (): void => {
    if (scanTimer !== undefined) {
      window.clearTimeout(scanTimer)
      scanTimer = undefined
    }
    observer?.disconnect()
    observer = undefined
  }

  const teardown = (): void => {
    stopObserver()
    // Orphaned editors must not outlive the fiber: on plugin disable or HMR
    // they would keep rendering with a stale api face, failing every write
    // visibly. Unmount every React root this plugin created.
    for (const [, entry] of scanState.mounted) entry.editor.unmount()
    scanState.mounted.clear()
  }

  return { state: scanState, labels, start, stopObserver, teardown, schedule }
}
