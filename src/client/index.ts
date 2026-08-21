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
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
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
class EffortBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
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
        `思考强度渲染失败: ${this.state.error}`,
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

  const connection = ctx.get('connection') as ConnectionHandle
  const api: RemoteApi = { settings: connection.api.settings }
  // The shell's Translate is `(key: string, params?: Record<string, unknown>)`;
  // our components take a string-keyed face, so the bound translator narrows.
  const t = ctx.locale.bind(STORE_NS) as Translate

  // ---- DOM bypass injection ----
  const scanState = createScanState()
  let scanTimer: number | undefined
  let observer: MutationObserver | undefined

  const scheduleScan = (): void => {
    if (scanTimer !== undefined) return
    // Debounce: the official page re-renders in bursts (typing, expanding,
    // applying); one scan per frame keeps the editor stable mid-keystroke.
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      const root = panelRoot()
      reconcile(root, {
        api,
        describeNamespace: () => describeNamespace(api),
        t,
        mount(container, props) {
          const rootEl = document.createElement('div')
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
              null,
              createElement(EffortEditor, p),
            ))
          }
          renderEditor(props)
          return {
            unmount: () => { reactRoot.unmount() },
            render: renderEditor,
          }
        },
      }, scanState)
    }, 120)
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
}

export type { BreKey }
export { EffortEditor }
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export type { InjectorDeps, EditorMountProps, ScanState } from './injector.ts'
export * from './ops.ts'
export * from './types.ts'
