/**
 * Browser half of dsh-better-reasoning-effort.
 *
 * Three contributions, all of which dispose with the plugin fiber:
 *   1. The DOM bypass injector: a MutationObserver over the settings panel
 *      keeps the official Models page's model rows equipped with the
 *      thinking-effort editor.
 *   2. A `settings.section` page ("Reasoning effort" / 思考强度) offering the
 *      same editing plus one-click presets — the safety net if the official
 *      page's DOM ever stops exposing the injection anchors.
 *   3. The stylesheet and copy dictionaries.
 *
 * The official Models page registers `settings.section` id `models`; this
 * plugin's section registers a sibling id (`reasoning-effort`), so both pages
 * coexist in the settings sidebar.
 *
 * @module dsh-better-reasoning-effort/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge ('settings.section' entry) and
// the locale/remote context merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createRoot } from 'react-dom/client'
import { EffortEditor } from './EffortEditor.tsx'
import { FallbackSection, type FallbackSectionProps } from './FallbackSection.tsx'
import { createFlagStore } from './flag.ts'
import { createScanState, reconcile, type SettingsJoin } from './injector.ts'
import { en, zh, type BreKey } from './locales.ts'
import { STYLES } from './styles.ts'
import type { RemoteApi, SettingsNamespaceView } from './types.ts'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = 'dsh-better-reasoning-effort'

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-better-reasoning-effort'

/** The settings namespace this plugin edits. */
const PI_AI_NS = 'llm-pi-ai'

/** Cordis fiber dependencies of the browser half. */
export const inject = ['slots', 'locale', 'connection', 'remote']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's copy dictionaries. */
    'dsh-better-reasoning-effort': BreKey
  }
}

/** Whether a node is the models section title heading. */
function isModelsTitle(node: Element): boolean {
  if (node.tagName !== 'H2') return false
  const text = node.textContent?.trim() ?? ''
  return text === 'Models' || text === '模型'
}

/** The settings panel root this plugin watches (the models page section). */
function panelRoot(): HTMLElement | undefined {
  const title = Array.from(document.querySelectorAll<HTMLElement>('h2')).find(isModelsTitle)
  // The section that owns the title is the models page's content column.
  const section = title?.closest<HTMLElement>('[class*="section"]')
  return section ?? title?.parentElement ?? undefined
}

/**
 * Apply the browser half.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-better-reasoning-effort: dictionaries')

  const style = document.createElement('style')
  style.dataset['plugin'] = 'dsh-better-reasoning-effort'
  style.textContent = STYLES
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-better-reasoning-effort: stylesheet')

  const connection = ctx.get('connection') as ConnectionHandle
  const api: RemoteApi = { settings: connection.api.settings }
  // The shell's Translate is `(key: string, params?: Record<string, unknown>)`;
  // our components take a string-keyed face, so the bound translator narrows.
  const t = ctx.locale.bind(NS) as Translate

  /** Read the pi-ai namespace plus writability through the settings Remote. */
  const describeNamespace = async (): Promise<SettingsJoin> => {
    const response = await api.settings.describe({})
    if (!response.result.ok) return { namespace: undefined, writable: false }
    const namespace = response.result.value.namespaces.find(ns => ns.ns === PI_AI_NS)
    return { namespace, writable: response.result.value.writable }
  }

  /** Whether the injector currently has any editor mounted. */
  const injectionFlag = createFlagStore(false)

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
      if (root === undefined) return
      const before = scanState.mounted.size
      reconcile(root, {
        api,
        describeNamespace,
        t,
        mount(container, props) {
          const rootEl = document.createElement('div')
          container.appendChild(rootEl)
          const reactRoot = createRoot(rootEl)
          reactRoot.render(EffortEditor({ ...props, index: 0 }))
          return () => { reactRoot.unmount() }
        },
      }, scanState)
      injectionFlag.set(scanState.mounted.size > 0)
      if (scanState.mounted.size !== before) {
        // A scan changed the mounted set; the fallback page's status must
        // re-render (the shell re-renders sections on the ledger bump only,
        // so publish through the shared flag the page subscribes to).
        injectionFlag.set(scanState.mounted.size > 0)
      }
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

  // ---- Fallback section ----
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'reasoning-effort',
    order: 12,
    label: () => t('nav'),
    inject: () => ({
      api,
      describeNamespace,
      t: t as FallbackSectionProps['t'],
      injectionActive: injectionFlag,
    }),
  }, FallbackSection as never))

  ctx.effect(() => {
    startObserver()
    return () => { stopObserver() }
  }, 'dsh-better-reasoning-effort: DOM injector')

  // Refresh the injection when the settings document changes (an apply from
  // either the official page or this plugin re-renders the rows).
  ctx.effect(() => {
    const refresh = (): void => { scheduleScan() }
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
export { FallbackSection }
export { EffortEditor }
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export type { FallbackSectionProps } from './FallbackSection.tsx'
export type { InjectorDeps, EditorMountProps, ScanState } from './injector.ts'
export * from './ops.ts'
export * from './types.ts'
