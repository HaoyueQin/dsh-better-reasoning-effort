/**
 * Browser half of dsh-better-reasoning-effort.
 *
 * Contributions, all of which dispose with the plugin fiber:
 *   1. The DOM bypass injector: a MutationObserver over the whole document
 *      keeps the official Models page's model rows equipped with the
 *      thinking-effort editor, wherever the page lives in the settings
 *      surface (a panel, a dialog, a portal). This is the SINGLE path on
 *      both kernel lines: on alpha.1 the official per-model disclosure kept
 *      the same anchors (Capacities / 容量), so the sanctioned slot mode is
 *      gone and the editor lives under each model row again instead of on
 *      the provider card.
 *   2. The composer reasoning-effort slider, mounted inside the OFFICIAL
 *      model menu opened from the bottom-right seat. The seat's trigger is
 *      never touched — the official "model · effort" display stays.
 *   3. The Models-page slider toggle below the add-provider actions
 *      (alpha.1 'settings.models.footer' slot; rc.2 DOM fallback since the
 *      rc.2 Models section declares no extension slots).
 *   4. The stylesheet and copy dictionaries.
 *
 * @module dsh-better-reasoning-effort/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SlotRegistrarFace, WireContext, ModelDirectoryLike } from './types.js'
// Type-only: pulls the shell's locale/remote context merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createRoot, type Root } from 'react-dom/client'
import { Component, createElement } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { PI_AI_NS, PLUGIN_ID, STORE_NS } from '../constants.js'
import { EffortEditor } from './EffortEditor.tsx'
import { createScanState, reconcile } from './injector.ts'
import { en, zh, type BreKey } from './locales.ts'
import { describeNamespace } from './ops.ts'
import { ComposerSlider } from './ComposerSlider.js'
import { SliderToggle } from './SliderToggle.js'
import { SLIDER_PREF_KEY, sliderEnabled, subscribeSliderEnabled, syncSliderEnabled } from './slider-pref.js'
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

// ---- Composer slider + Models-page toggle host faces (structural; both
// ---- kernels expose the same shape, see client/types.ts). ----

/** The `sessions` service face the slider needs: the current session id. */
interface SessionsLike {
  list?: { getSnapshot(): { current?: string } }
}

/** The `modelDirectories` service face the slider needs. */
interface ModelDirectoriesLike {
  directoryFor(sessionId: string): ModelDirectoryLike
}

/** The context seats the slider probes, lazily (services mount after boot). */
interface SliderContext {
  get?(name: string): unknown
}

/** The official composer model menu: the seat root's open popover. */
function modelMenuOf(): HTMLElement | undefined {
  for (const menu of Array.from(document.querySelectorAll<HTMLElement>('[data-composer-card] [role="menu"]'))) {
    // The seat renders [trigger button, open menu]; any other menu in the
    // composer card (attachments, commands) does not sit right after a
    // menu-triggering button, so the sibling check disambiguates across
    // kernels and locales without reading copy text.
    if (menu.previousElementSibling?.matches('button[aria-haspopup="menu"]')) return menu
  }
  return undefined
}

interface ForeignMount {
  wrapper: HTMLElement
  root: Root
}

function mountReact(container: HTMLElement, children: ReactNode): ForeignMount {
  const root = createRoot(container)
  root.render(children)
  return { wrapper: container, root }
}

function unmountReact(mount: ForeignMount | undefined): void {
  if (mount === undefined) return
  mount.root.unmount()
  mount.wrapper.remove()
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

  // Kernel-dual wire: alpha.1 answers on the 'remote.settings' service (Typert
  // stub, mounted after boot; probed through ctx.get because its property read
  // demands an inject declaration rc.2 can never satisfy), rc.2 on
  // connection.api (IApiClient). Resolution is lazy — every scan and write
  // re-probes — so a stub that mounts later is picked up without a re-apply.
  // See client/wire.ts for the adapters.
  const wire = (): RemoteApi | undefined => resolveWire(ctx as unknown as WireContext)
  // The shell's Translate is `(key: string, params?: Record<string, unknown>)`;
  // our components take a string-keyed face, so the bound translator narrows.
  const t = ctx.locale.bind(STORE_NS) as Translate

  // ---- DOM bypass injection ----
  /** Debounce window for DOM-mutation scans (one scan per render burst). */
  const SCAN_DEBOUNCE_MS = 120
  const scanState = createScanState()
  let scanTimer: number | undefined
  let observer: MutationObserver | undefined

  /** Once true, the sanctioned alpha.1 footer slot owns the toggle; DOM retires. */
  let footerSlotActive = false

  // ---- Composer slider mount (DOM path on both kernels) ----
  let sliderMount: ForeignMount | undefined
  let sliderDirectory: { sessionId: string; directory: ModelDirectoryLike } | undefined

  /** Resolve the current session's model directory (lazy seat probe). */
  const currentDirectory = (): ModelDirectoryLike | undefined => {
    const host = ctx as unknown as SliderContext
    const sessions = host.get?.('sessions') as SessionsLike | undefined
    const directories = host.get?.('modelDirectories') as ModelDirectoriesLike | undefined
    const current = sessions?.list?.getSnapshot().current
    if (current === undefined || directories === undefined) return undefined
    if (sliderDirectory !== undefined && sliderDirectory.sessionId === current) return sliderDirectory.directory
    try {
      const directory = directories.directoryFor(current)
      sliderDirectory = { sessionId: current, directory }
      return directory
    } catch {
      // Unknown session (a scope not mounted yet): transient — retry next scan.
      sliderDirectory = undefined
      return undefined
    }
  }

  /** Reconcile the slider into the official model menu (idempotent). */
  const reconcileSlider = (): void => {
    const menu = sliderEnabled() ? modelMenuOf() : undefined
    if (menu === undefined) {
      unmountReact(sliderMount)
      sliderMount = undefined
      // The preference flipped off while the menu stayed open: the host menu
      // must go back to the official content-sized box AND its root cells
      // must become visible again (the active branch hides them inline).
      const hostMenu = document.querySelector<HTMLElement>('[data-composer-card] [role="menu"]')
      if (hostMenu !== null) {
        hostMenu.classList.remove('bre-model-menu-host')
        for (const el of Array.from(hostMenu.children)) {
          if (el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem') {
            el.style.display = ''
          }
        }
      }
      return
    }
    const directory = currentDirectory()
    if (directory === undefined) {
      // Transient boot window only: the seat itself cannot mount before the
      // directory service resolves, so a menu open here is momentary. The
      // next DOM mutation re-enters (the mounted slider keeps its face).
      return
    }
    // React re-renders the menu around a foreign node; keep our wrapper as the
    // menu's FIRST child by re-inserting it whenever a re-render displaced it.
    // The React root survives DOM moves (the fiber tree is position-independent),
    // so a displaced slider is re-attached, never re-created.
    if (sliderMount === undefined) {
      const wrapper = document.createElement('div')
      wrapper.dataset['plugin'] = PLUGIN_ID
      wrapper.dataset['breSlider'] = '1'
      menu.insertBefore(wrapper, menu.firstChild)
      sliderMount = mountReact(wrapper,
        createElement(EffortBoundary, {
          fallbackText: t('renderFailed'),
          children: createElement(ComposerSlider, {
            directory,
            t,
            // Our model row replicates upstream's: clicking it opens the
            // OFFICIAL model list. The official cells are the menu's DIRECT
            // children (role=menuitem); this replicated row is nested inside
            // the wrapper, so a document-order querySelector would find our
            // OWN row first and recurse — the direct-child scope is what
            // keeps the click on the official"Model" cell. The drill-in
            // lists use menuitemradio and are never matched.
            pickModel: () => {
              const official = Array.from(menu.children).find((el): el is HTMLButtonElement =>
                el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem')
              official?.click()
            },
          }),
        }),
      )
    } else if (sliderMount.wrapper.parentElement !== menu || menu.firstChild !== sliderMount.wrapper) {
      menu.insertBefore(sliderMount.wrapper, menu.firstChild)
    }
    // The replicated popover body takes the upstream .re-model-menu box.
    menu.classList.add('bre-model-menu-host')
    // Popover replication rules, mirroring upstream's pane behaviour:
    //  - ROOT pane: our body (slider + separator + model row) IS the content;
    //    the official menu's root cells (role=menuitem direct children —
    //    "Model" and "Effort") are duplicated and hidden. A pane switch
    //    re-creates them and the next scan re-applies.
    //  - Model-pane drill-in (menuitemradio rows): upstream shows ONLY the
    //    pane, so our body retires while the official list is open.
    // Known tradeoff (a11y): the official shell's Arrow-key roving focus walks
    // the hidden cells — focus() on a display:none node is a no-op — so
    // keyboard users reach the replica via Tab; the replica row's Enter opens
    // the official model list, keeping model switching keyboard-reachable.
    const cells = Array.from(menu.children).filter((el): el is HTMLButtonElement =>
      el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem')
    if (menu.querySelector('[role="menuitemradio"]') !== null) {
      // Focus handoff BEFORE hiding: the replica row (possibly focused) is
      // about to become display:none. Without moving focus first the browser
      // drops it to <body>, the official shell's onBlur reads that as "focus
      // left the seat" and closes the menu instantly — the flash-out that
      // made the model list unusable. The menu itself sits inside the seat
      // root, so focusing it keeps the blur inside (tabindex -1: no Tab
      // stop, no focus ring for programmatic focus).
      if (sliderMount.wrapper.contains(document.activeElement)) {
        menu.tabIndex = -1
        menu.focus({ preventScroll: true })
      }
      sliderMount.wrapper.style.display = 'none'
    } else {
      sliderMount.wrapper.style.display = ''
      for (const cell of cells) cell.style.display = 'none'
    }
  }

  // ---- Models-page slider toggle ----
  let toggleMount: ForeignMount | undefined

  /** rc.2 DOM seat: the boxed toggle after the add-provider actions. */
  const reconcileToggle = (): void => {
    if (footerSlotActive) {
      // The alpha.1 sanctioned slot owns the toggle; the DOM seat is retired.
      unmountReact(toggleMount)
      toggleMount = undefined
      return
    }
    // The Models page add area, scoped: the same 'addBlock' local class is
    // also used by a credential-only editor (the first-run onboarding dialog,
    // a body portaled open at the same time); the models section is the one
    // that sits inside a section container and outside any dialog.
    const block = Array.from(document.querySelectorAll<HTMLElement>('[class*="addBlock"]')).find(candidate =>
      candidate.closest('[class*="section"]') !== null
      && candidate.closest('[class*="dialog"]') === null)
    if (block === undefined) {
      unmountReact(toggleMount)
      toggleMount = undefined
      return
    }
    if (toggleMount === undefined) {
      const wrapper = document.createElement('div')
      wrapper.dataset['plugin'] = PLUGIN_ID
      wrapper.dataset['breToggle'] = '1'
      block.appendChild(wrapper)
      toggleMount = mountReact(wrapper,
        createElement(EffortBoundary, { fallbackText: t('renderFailed'), children: createElement(SliderToggle, { t }) }),
      )
      return
    }
    // React re-renders the add area (opening an add card, typing); keep the
    // boxed toggle below whatever the block currently shows.
    if (toggleMount.wrapper.parentElement !== block || block.lastChild !== toggleMount.wrapper) {
      block.appendChild(toggleMount.wrapper)
    }
  }

  const scheduleScan = (): void => {
    if (scanTimer !== undefined) return
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
      reconcileSlider()
      reconcileToggle()
    }, SCAN_DEBOUNCE_MS)
  }

  const startObserver = (): void => {
    if (observer !== undefined) return
    observer = new MutationObserver(() => {
      // The slider path runs SYNCHRONOUSLY on the mutation microtask: the
      // React commit that opens the menu and this callback are delivered
      // before the browser's next paint, so the FIRST painted frame already
      // carries the replicated popover — the official menu never flashes and
      // is never "covered". The settings-page editor/toggle reconciles stay
      // debounced below (they do heavy wire reads).
      reconcileSlider()
      scheduleScan()
    })
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
      unmountReact(sliderMount)
      sliderMount = undefined
      unmountReact(toggleMount)
      toggleMount = undefined
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

  // Refresh the slider the moment the preference flips (the toggle and the
  // menu can be open at the same time), and follow other tabs' changes.
  ctx.effect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SLIDER_PREF_KEY) syncSliderEnabled(event.newValue !== 'false')
    }
    window.addEventListener('storage', onStorage)
    const dispose = subscribeSliderEnabled(() => { scheduleScan() })
    return () => {
      window.removeEventListener('storage', onStorage)
      void dispose()
    }
  }, 'dsh-better-reasoning-effort: slider preference')

  // ---- alpha.1 footer slot ----
  // The alpha.1 Models page grew a footer extension slot after the provider
  // rows and the add controls ('settings.models.footer'). Once the alpha.1
  // settings stub mounts, the boxed slider toggle takes that sanctioned seat;
  // on rc.2 the stub never mounts, so the DOM fallback above remains the only
  // path. One probe, two kernels, no version sniffing.
  ctx.effect(() => {
    let disposed = false
    const host = ctx as unknown as {
      inject?: (names: string[], cb: () => void) => unknown
      slots?: SlotRegistrarFace
    }
    host.inject?.(['remote.settings'], () => {
      if (disposed || footerSlotActive) return
      footerSlotActive = true
      // The sanctioned seat owns the toggle now: retire the DOM fallback.
      unmountReact(toggleMount)
      toggleMount = undefined
      host.slots?.inject('settings.models.footer', () => {
        host.slots?.register({
          name: 'settings.models.footer',
          id: PLUGIN_ID + '-slider-toggle',
          order: 15,
          inject: () => ({ t }),
        }, SliderToggle)
      })
    })
    return () => { disposed = true }
  }, 'dsh-better-reasoning-effort: alpha.1 footer slot activation')
}

export type { BreKey }
export { EffortEditor }
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export type { InjectorDeps, EditorMountProps, ScanState } from './injector.ts'
export * from './ops.ts'
export * from './types.ts'
