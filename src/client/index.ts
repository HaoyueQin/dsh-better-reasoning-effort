/**
 * Browser half of dsh-better-reasoning-effort.
 *
 * Two contributions, all of which dispose with the plugin fiber:
 *   1. The DOM bypass injector: a MutationObserver over the whole document
 *      keeps the official Models page's model rows equipped with the
 *      thinking-effort editor, wherever the page lives in the settings
 *      surface (a panel, a dialog, a portal).
 *   2. The stylesheet and copy dictionaries.
 *
 * @module dsh-better-reasoning-effort/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SlotRegistrarFace, WireContext } from './types.js'
// Type-only: pulls the shell's locale/remote context merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createRoot } from 'react-dom/client'
import { Component, createElement } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { PI_AI_NS, PLUGIN_ID, STORE_NS } from '../constants.js'
import { EffortEditor } from './EffortEditor.tsx'
import { createScanState, reconcile } from './injector.ts'
import { en, zh, type BreKey } from './locales.ts'
import { describeNamespace } from './ops.ts'
import { ProviderEffortPanel } from './ProviderEffortPanel.js'
import { resolveWire } from './wire.js'
import { STYLES } from './styles.ts'
import type { RemoteApi } from './types.ts'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Cordis fiber dependencies of the browser half. */
export const inject = ['slots', 'locale', 'connection', 'remote']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's copy dictionaries. */
    [STORE_NS]: BreKey
  }
}

/** Render-failure boundary: surfaces the cause instead of an empty root. */
class EffortBoundary extends Component<{ children?: ReactNode; fallbackText: string }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[bre] editor render failed:', error, info.componentStack)
  }
  override render(): ReactNode {
    if (this.state.error !== null) {
      return createElement(
        'div',
        { style: { color: '#c00', fontSize: '11px', whiteSpace: 'pre-wrap', padding: '6px' } },
        `${this.props.fallbackText}: ${this.state.error}`,
      )
    }
    return this.props.children
  }
}

/**
 * The root this plugin scans. The official models page can live anywhere in
 * the settings surface (a hash-classed panel, a dialog, a portal), so guessing
 * a container is fragile — and the injector is idempotent and cheap, so
 * scanning the whole document is both safe and correct.
 */
function panelRoot(): HTMLElement {
  return document.body
}

/**
 * Apply the browser half.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(STORE_NS, { zh, en }), 'dsh-better-reasoning-effort: dictionaries')

  const style = document.createElement('style')
  style.dataset['pluginStyles'] = PLUGIN_ID
  style.textContent = STYLES
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-better-reasoning-effort: stylesheet')

  // Kernel-dual wire: alpha.1 answers on ctx.remote.settings (Typert stub,
  // mounted after boot), rc.2 on connection.api (IApiClient). Resolution is
  // lazy — every scan and write re-probes — so a stub that mounts later is
  // picked up without a re-apply. See client/wire.ts for the adapters.
  const wire = (): RemoteApi | undefined => resolveWire(ctx as unknown as WireContext)
  // Pushed invalidations for slot-mode panels: the same two signals the
  // official describe mirror listens to, folded into one subscription face.
  const subscribe = (listener: () => void): (() => void) => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { listener() }),
      ctx.on('connection/reset', () => { listener() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }
  // The shell's Translate is `(key: string, params?: Record<string, unknown>)`;
  // our components take a string-keyed face, so the bound translator narrows.
  const t = ctx.locale.bind(STORE_NS) as Translate

  // ---- DOM bypass injection ----
  /** Debounce window for DOM-mutation scans (one scan per render burst). */
  const SCAN_DEBOUNCE_MS = 120
  const scanState = createScanState()
  let scanTimer: number | undefined
  let observer: MutationObserver | undefined

  /** Once true, the sanctioned alpha.1 slot owns the page and DOM scans retire. */
  let slotMode = false
  const scheduleScan = (): void => {
    if (slotMode || scanTimer !== undefined) return
    // Debounce: the official page re-renders in bursts (typing, expanding,
    // applying); one scan per frame keeps the editor stable mid-keystroke.
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      const root = panelRoot()
      reconcile(root, {
        wire,
        // reconcile has already gated on the wire being up, so the read here
        // always has a face; the assertion only satisfies the types.
        describeNamespace: () => describeNamespace(wire() as RemoteApi),
        t,
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
              { fallbackText: t('renderFailed'), children: createElement(EffortEditor, p) },
            ))
          }
          renderEditor(props)
          return {
            unmount: () => { reactRoot.unmount() },
            render: renderEditor,
          }
        },
      }, scanState)
    }, SCAN_DEBOUNCE_MS)
  }

  const startObserver = (): void => {
    if (observer !== undefined) return
    observer = new MutationObserver(() => { scheduleScan() })
    observer.observe(document.body, { childList: true, subtree: true })
    scheduleScan()
  }
  const stopObserver = (): void => {
    if (scanTimer !== undefined) {
      window.clearTimeout(scanTimer)
      scanTimer = undefined
    }
    observer?.disconnect()
    observer = undefined
  }

  ctx.effect(() => {
    startObserver()
    return () => {
      stopObserver()
      // Orphaned editors must not outlive the fiber: on plugin disable or
      // HMR they would keep rendering with a stale api face, failing every
      // write visibly. Unmount every React root this plugin created.
      for (const [, entry] of scanState.mounted) entry.editor.unmount()
      scanState.mounted.clear()
    }
  }, 'dsh-better-reasoning-effort: DOM injector')

  // Refresh the injection when the settings document changes (an apply from
  // either the official page or this plugin re-renders the rows). The folded
  // describe snapshot is invalidated first: without that, every later scan —
  // and every editor mounted from it — would keep reading the revision and
  // providers as of the very first scan, making Apply conflict forever until
  // a full page reload.
  ctx.effect(() => {
    const refresh = (): void => {
      scanState.describePromise = undefined
      scheduleScan()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: unknown) => {
        if (ns === PI_AI_NS) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-better-reasoning-effort: pushed invalidations')

  // ---- alpha.1 slot mode ----
  // The official Models page grew a keyed extension slot
  // ('settings.models.provider-card', dispatched per provider card by its
  // settings namespace). Once the alpha.1 settings stub mounts, the plugin
  // switches to that sanctioned seat: the DOM bypass observer retires, its
  // editors unmount, and one panel per pi-ai provider card takes over. On
  // rc.2 the stub never mounts, this callback never fires, and the DOM
  // bypass remains the only path — one bundle, two kernels, no version
  // sniffing.
  ctx.effect(() => {
    let disposed = false
    const host = ctx as unknown as {
      inject?: (names: string[], cb: () => void) => unknown
      slots?: SlotRegistrarFace
    }
    host.inject?.(['remote.settings'], () => {
      if (disposed || slotMode) return
      slotMode = true
      stopObserver()
      for (const [, entry] of scanState.mounted) entry.editor.unmount()
      scanState.mounted.clear()
      host.slots?.inject('settings.models.provider-card', () => {
        host.slots?.register({
          name: 'settings.models.provider-card',
          key: PI_AI_NS,
          id: PLUGIN_ID,
          inject: () => ({ wire, subscribe, t }),
        }, ProviderEffortPanel)
      })
    })
    return () => { disposed = true }
  }, 'dsh-better-reasoning-effort: alpha.1 slot activation')
}

export type { BreKey }
export { EffortEditor }
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export type { InjectorDeps, EditorMountProps, ScanState } from './injector.ts'
export * from './ops.ts'
export * from './types.ts'
