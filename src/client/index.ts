/**
 * Browser half of dsh-better-reasoning-effort.
 *
 * Contributions, all of which dispose with the plugin fiber:
 *   1. The DOM bypass injector: a MutationObserver over the whole document
 *      keeps the official Models page's model rows equipped with the
 *      thinking-effort editor, wherever the page lives in the settings
 *      surface (a panel, a dialog, a portal). This is the SINGLE path:
 *      the official per-model disclosure keeps the same anchors
 *      (Capacities / 容量), so the editor lives under each model row
 *      rather than on the provider card.
 *   2. The composer reasoning-effort slider, mounted inside the OFFICIAL
 *      model menu opened from the bottom-right seat. The seat's trigger is
 *      never touched — the official "model · effort" display stays.
 *   3. The Models-page slider toggle, taking the official
 *      'settings.models.footer' slot unconditionally at apply.
 *   4. The stylesheet and copy dictionaries.
 *
 * @module dsh-better-reasoning-effort/client
 */

import type { ClientContext, SlotRegistrarFace, ModelDirectoryLike } from './types.js'
// Type-only: pulls the shell's locale/remote context merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createRoot, type Root } from 'react-dom/client'
import { Component, createElement } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { DEFAULT_EFFORT_FIELD, PI_AI_NS, PLUGIN_ID, STORE_NS } from '../constants.js'
import { EffortEditor } from './EffortEditor.tsx'
import { wireEffortMemory } from './effort-memory.js'
import { createScanState, reconcile, type HostLabels } from './injector.ts'
import { LocaleRefresh, type LocaleFace } from './LocaleRefresh.tsx'
import { en, zh, type BreKey } from './locales.ts'
import { describeNamespace, providersOf } from './ops.ts'
import { ComposerSlider } from './ComposerSlider.js'
import { SliderToggle } from './SliderToggle.js'
import { SLIDER_PREF_KEY, sliderEnabled, subscribeSliderEnabled, syncSliderEnabled } from './slider-pref.js'
import { STYLES } from './styles.ts'
import type { RemoteApi } from './types.ts'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Cordis fiber dependencies of the browser half. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings']

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

/**
 * The official composer model menu: the seat root's open popover.
 *
 * Shape-tolerant across kernels: 0.1.5 portals the menu to document.body
 * and links it from the seat trigger via aria-controls, while older kernels
 * render it inline right after the trigger. Both shapes keep
 * aria-haspopup="menu" on the trigger and role="menu" on the menu, so the
 * controls link is the primary route and the sibling check stays as the
 * fallback. Trigger search stays scoped to the composer card, so other
 * seats' menus never match; no copy text is read, so every locale matches.
 */
export function findModelMenu(doc: Document = document): HTMLElement | undefined {
  const card = doc.querySelector('[data-composer-card]')
  const scope: ParentNode = card ?? doc
  for (const trigger of Array.from(scope.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"][aria-controls]'))) {
    const id = trigger.getAttribute('aria-controls')
    if (id === null || id.length === 0) continue
    const menu = doc.getElementById(id)
    if (menu !== null && menu.getAttribute('role') === 'menu') return menu
  }
  // Fallback: the pre-portal inline shape — the menu sits right after its
  // trigger button, which disambiguates it from other menus in the card.
  const menus = card === null
    ? Array.from(doc.querySelectorAll<HTMLElement>('[role="menu"]'))
    : Array.from(card.querySelectorAll<HTMLElement>('[role="menu"]'))
  for (const menu of menus) {
    if (menu.previousElementSibling?.matches('button[aria-haspopup="menu"]')) return menu
  }
  return undefined
}

/** The official composer model menu: the seat root's open popover. */
function modelMenuOf(): HTMLElement | undefined {
  return findModelMenu()
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

  // The kernel mounts the settings Remote as an injectable
  // 'remote.settings' service, declared in the plugin's own inject above — so
  // the face is available before apply runs. No runtime seat probing remains.
  const settingsApi: RemoteApi = { settings: ctx.remote.settings }
  // The shell's Translate is `(key: string, params?: Record<string, unknown>)`;
  // our components take a string-keyed face, so the bound translator narrows.
  const t = ctx.locale.bind(STORE_NS) as Translate

  // The locale service is also its own LocaleFace (getSnapshot/subscribe).
  // Without those two members a language switch cannot reach copy
  // that is already on screen — the pre-existing behaviour, not a failure.
  const localeFace = (): LocaleFace | undefined => {
    const locale = ctx.locale
    return typeof locale.subscribe === 'function' && typeof locale.getSnapshot === 'function'
      ? locale as LocaleFace
      : undefined
  }

  /**
   * Wrap a subtree so it re-translates on a language switch. The thunk is
   * rebuilt per render by {@link LocaleRefresh}; without the seat the subtree
   * renders exactly as it did before.
   */
  const refreshed = (children: () => ReactNode): ReactNode => {
    const face = localeFace()
    return face === undefined ? children() : createElement(LocaleRefresh, { locale: face, children })
  }

  /**
   * The official controls' aria-labels in the host's ACTIVE language.
   *
   * A thunk, never a cached value: the host renders those labels from its own
   * dictionary through its own fallback chain, so re-reading per scan is what
   * keeps a language switch (or a late language pack) from stranding the
   * anchors on words the page no longer prints.
   */
  const hostLabels = (): HostLabels => {
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

  // ---- DOM bypass injection ----
  /** Debounce window for DOM-mutation scans (one scan per render burst). */
  const SCAN_DEBOUNCE_MS = 120
  const scanState = createScanState()
  let scanTimer: number | undefined
  let observer: MutationObserver | undefined

  // ---- Composer slider mount (DOM path) ----
  let sliderMount: ForeignMount | undefined
  let sliderDirectory: { sessionId: string; directory: ModelDirectoryLike } | undefined
  // One effort-memory wiretap per directory instance, with each original
  // `select` kept for the fiber disposer to restore. Entries record their
  // session id so the sweep in ensureSessionDirectory can release the
  // wiretaps of directories whose session scope is gone (a deleted session's
  // directory must not stay referenced and wrapped until fiber dispose).
  interface WiredDirectory {
    sessionId: string
    restore: () => void
  }
  const wiredDirectories = new Map<ModelDirectoryLike, WiredDirectory>()

  // ---- Per-model configured picks (issue #4): the browser-side cache of the
  // ---- settings document's model rows' `defaultEffort` field. The chain
  // ---- reads it through the wiring below; a pushed document update or a
  // ---- connection reset invalidates it, and the next read re-describes.
  let configuredEfforts: Map<string, string> | undefined
  let configuredEffortsInflight: Promise<void> | undefined
  let configuredEffortsGeneration = 0

  const ensureConfiguredEfforts = (): Promise<void> => {
    if (configuredEfforts !== undefined) return Promise.resolve()
    const generation = configuredEffortsGeneration
    configuredEffortsInflight ??= describeNamespace(settingsApi)
      .then((join) => {
        if (join.namespace === undefined) {
          // The namespace is unregistered, or the read was refused (a
          // gateway hiccup): do NOT cache the empty answer — the next chain
          // read re-describes, instead of silently disabling the configured
          // layer until the next invalidation.
          configuredEffortsInflight = undefined
          return
        }
        const map = new Map<string, string>()
        for (const [route, profile] of Object.entries(providersOf(join.namespace))) {
          const rawModels = Array.isArray(profile['models']) ? profile['models'] : []
          for (const model of rawModels) {
            if (typeof model !== 'object' || model === null || Array.isArray(model)) continue
            const id = (model as Record<string, unknown>)['id']
            const effort = (model as Record<string, unknown>)[DEFAULT_EFFORT_FIELD]
            if (typeof id === 'string' && typeof effort === 'string' && effort.length > 0) {
              map.set(`${route}/${id}`, effort)
            }
          }
        }
        // An invalidation during the flight must not land a stale snapshot:
        // the caller re-describes on the next read instead.
        if (generation === configuredEffortsGeneration) configuredEfforts = map
        else configuredEffortsInflight = undefined
      })
      .catch(() => {
        // A failed read leaves the cache empty: the next read re-describes.
        if (generation === configuredEffortsGeneration) configuredEffortsInflight = undefined
      })
    return configuredEffortsInflight
  }

  /** The configured pick for one model, after the cache has settled. */
  const configuredEffortOf = async (provider: string, model: string): Promise<string | undefined> => {
    await ensureConfiguredEfforts()
    return configuredEfforts?.get(`${provider}/${model}`)
  }

  /** Drop the configured-pick cache; the next read re-describes. */
  const invalidateConfiguredEfforts = (): void => {
    configuredEffortsGeneration += 1
    configuredEfforts = undefined
    configuredEffortsInflight = undefined
  }

  /**
   * Release the wiretaps whose session scope is gone. The host resolver
   * deletes a directory's entry when the session scope tears down, and its
   * `directoryFor` then refuses that id (scope and binding are both gone --
   * not the transient unmounted window, which happens before a wiretap can
   * exist): re-resolving that id and comparing identities tells a dead
   * wiretap from one whose session is merely not current. Runs on EVERY
   * directory resolution, cache hits included -- the sweep must not depend
   * on the current session changing.
   */
  const sweepDeadWiretaps = (directories: ModelDirectoriesLike, liveDirectory: ModelDirectoryLike): void => {
    for (const [wired, entry] of wiredDirectories) {
      if (wired === liveDirectory) continue
      let alive: boolean
      try {
        alive = directories.directoryFor(entry.sessionId) === wired
      } catch {
        alive = false
      }
      if (!alive) {
        entry.restore()
        wiredDirectories.delete(wired)
      }
    }
  }

  /**
   * Resolve the current session's model directory and wire the effort-memory
   * wiretap into it. Deliberately menu-INDEPENDENT: the directory is a
   * per-session instance, and a brand-new session's durable projection lands
   * without going through `select`, so the watcher is the only thing that can
   * re-apply the remembered level to it — it must be in place from the
   * session's birth, not from the first time the user opens the model menu
   * (issue #4: every new session otherwise read as Default until a manual
   * pick). Runs on every mutation and scan; the per-session cache makes the
   * hot path one snapshot read.
   */
  const ensureSessionDirectory = (): ModelDirectoryLike | undefined => {
    const host = ctx as unknown as SliderContext
    const sessions = host.get?.('sessions') as SessionsLike | undefined
    const directories = host.get?.('modelDirectories') as ModelDirectoriesLike | undefined
    const current = sessions?.list?.getSnapshot().current
    if (current === undefined || directories === undefined) return undefined
    try {
      // Resolve FIRST, then compare identities: a session scope can be torn
      // down and re-resolved under the same id, and the cached instance would
      // be a disposed directory serving a frozen snapshot forever.
      const directory = directories.directoryFor(current)
      sweepDeadWiretaps(directories, directory)
      if (sliderDirectory !== undefined && sliderDirectory.sessionId === current
        && sliderDirectory.directory === directory) {
        return directory
      }
      // The effort-memory wiretap rides the shared directory (wrapping its
      // select AND watching for level-less restored projections), so a model
      // switch and a session restore both carry the remembered level.
      // Idempotent per instance. The configured-pick read rides along so the
      // chain's second layer comes from the settings document.
      if (!wiredDirectories.has(directory)) {
        wiredDirectories.set(directory, {
          sessionId: current,
          restore: wireEffortMemory(directory, { configuredEffort: configuredEffortOf }),
        })
      }
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
      const hostMenu = modelMenuOf()
      if (hostMenu !== undefined) {
        hostMenu.classList.remove('bre-model-menu-host')
        for (const el of Array.from(hostMenu.children)) {
          if (el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem') {
            el.style.display = ''
          }
        }
      }
      return
    }
    const directory = ensureSessionDirectory()
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
          children: refreshed(() => createElement(ComposerSlider, {
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
          })),
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

  const scheduleScan = (): void => {
    if (scanTimer !== undefined) return
    // Debounce: the official page re-renders in bursts (typing, expanding,
    // applying); one scan per frame keeps the editor stable mid-keystroke.
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      // Menu-independent effort-memory wiring (issue #4): the debounced scan
      // also covers the paths no mutation carries — apply boot and a slider
      // preference flip.
      ensureSessionDirectory()
      const root = panelRoot()
      reconcile(root, {
        api: settingsApi,
        describeNamespace: () => describeNamespace(settingsApi),
        t,
        labels: hostLabels,
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
                // Same seat as the slider and the toggle: without the locale
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
      }, scanState)
      reconcileSlider()
    }, SCAN_DEBOUNCE_MS)
  }

  const startObserver = (): void => {
    if (observer !== undefined) return
    // A session may already be resident when the fiber starts (page reload,
    // HMR): wire it before the first mutation has a chance to land.
    ensureSessionDirectory()
    observer = new MutationObserver(() => {
      // The slider path runs SYNCHRONOUSLY on the mutation microtask: the
      // React commit that opens the menu and this callback are delivered
      // before the browser's next paint, so the FIRST painted frame already
      // carries the replicated popover — the official menu never flashes and
      // is never "covered". The settings-page editor/toggle reconciles stay
      // debounced below (they do heavy wire reads).
      // The effort-memory wiring leads the callback for the same reason: a
      // session switch lands as a DOM mutation, and the new session's
      // directory must be watched before its projection can read as Default.
      ensureSessionDirectory()
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
      // Restore every wrapped directory's original select (the instances
      // outlive the fiber on disable/HMR and must submit officially again).
      for (const [, entry] of wiredDirectories) entry.restore()
      wiredDirectories.clear()
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
      // The configured-pick cache rides the same invalidations: a document
      // update (or a fresh connection) must not leave stale picks behind.
      invalidateConfiguredEfforts()
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

  // ---- Models-page footer slot ----
  // The Models page ships the sanctioned 'settings.models.footer'
  // extension slot after the provider rows and the add controls, and the
  // plugin's top-level inject already declares 'remote.settings' — its wired
  // contract on this kernel — so the boxed slider toggle takes that seat
  // unconditionally here; no DOM fallback exists.
  ctx.effect(() => {
    const host = ctx as unknown as { slots?: SlotRegistrarFace }
    host.slots?.inject('settings.models.footer', () => {
      host.slots?.register({
        name: 'settings.models.footer',
        id: PLUGIN_ID + '-slider-toggle',
        order: 15,
        inject: () => ({ t }),
      }, SliderToggle)
    })
  }, 'dsh-better-reasoning-effort: footer slot activation')
}

export type { BreKey }
export { EffortEditor }
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export type { InjectorDeps, EditorMountProps, ScanState } from './injector.ts'
export * from './ops.ts'
export * from './types.ts'
