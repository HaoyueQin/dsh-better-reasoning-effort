/**
 * Browser half of dsh-better-reasoning-effort.
 *
 * This is the ASSEMBLY LAYER: it registers the copy dictionaries and the
 * stylesheet, builds the injection modules with their dependencies, and wires
 * them to the plugin fiber's lifecycle. The behaviour itself lives in
 * `src/client/injection/`, one module per seam:
 *
 *   models-page.ts          the Models-page DOM injection (observer + editors)
 *   models-page-editor.ts   the editor injector behind it (anchors, staging, flush)
 *   composer-menu.ts        the composer slider AND the model search box
 *   session-directory.ts    the per-session directory + effort-memory wiretaps
 *   configured-efforts.ts   the settings document's per-model `defaultEffort` cache
 *   slider-toggle-slot.ts   the Models-page footer toggle
 *   autofill-run.ts         the running auto-fill complement (issue #7)
 *   mount.tsx               foreign React roots and the render boundary
 *   model-menu.ts           locating the official composer model menu
 *
 * Contributions, all of which dispose with the plugin fiber:
 *   1. The DOM bypass injector: a MutationObserver over the whole document
 *      keeps the official Models page's model rows equipped with the
 *      thinking-effort editor, wherever the page lives in the settings
 *      surface (a panel, a dialog, a portal). This is the SINGLE path:
 *      the official per-model disclosure keeps the same anchors (the
 *      `modelAdvanced` dictionary value — Capacities / 容量 through
 *      0.1.6-alpha.1, Model options / 模型选项 from 0.1.6-alpha.2), so the
 *      editor lives under each model row rather than on the provider card.
 *   2. The composer reasoning-effort slider AND the model search box, mounted
 *      inside the OFFICIAL model menu opened from the bottom-right seat. The
 *      seat's trigger is never touched — the official "model · effort" display
 *      stays. The search box is unconditional: it does not follow the slider
 *      preference.
 *   3. The Models-page slider toggle, taking the official
 *      'settings.models.footer' slot unconditionally at apply.
 *   4. The stylesheet and copy dictionaries.
 *
 * @module dsh-better-reasoning-effort/client
 */

import type { ClientContext, RemoteApi, SettingsScopeBinderLike, SettingsScopeReadLike } from './types.js'
// Type-only: pulls the shell's locale/remote context merges into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { PI_AI_NS, PLUGIN_ID, STORE_NS } from '../constants.js'
import { LocaleRefresh, type LocaleFace } from './LocaleRefresh.tsx'
import { en, zh, type BreKey } from './locales.ts'
import { SLIDER_PREF_KEY, sliderEnabled, subscribeSliderEnabled, syncSliderEnabled } from './slider-pref.js'
import { STYLES } from './styles.ts'
import { createComposerMenu } from './injection/composer-menu.js'
import { createConfiguredEfforts } from './injection/configured-efforts.js'
import { createIdleAutofill } from './injection/autofill-run.js'
import { createModelsPage } from './injection/models-page.js'
import { createSessionDirectoryTracker } from './injection/session-directory.js'
import { modelMenuOf } from './injection/model-menu.js'
import { registerSliderToggleSlot } from './injection/slider-toggle-slot.js'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Cordis fiber dependencies of the browser half. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's copy dictionaries. */
    [STORE_NS]: BreKey
  }
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
  //
  // The official settings scope is picked up on top of it when this shell
  // provides one: reads then ride its shared describe mirror (no wire round
  // trip, and the revision the settings surface itself fences writes with).
  // Deliberately NOT part of the plugin's `inject`: a kernel without the
  // service must still activate the browser half, on the wire-describe path.
  const settingsScope = ((): SettingsScopeReadLike | undefined => {
    try {
      // `ctx.get('settingsScope')` yields the kernel's BINDER, not a scope:
      // only `bind({ namespace })` mints the read face (getSnapshot). Using
      // the binder directly made every describe throw a TypeError.
      const binder = ctx.get?.('settingsScope') as SettingsScopeBinderLike | undefined
      return binder?.bind?.({ namespace: PI_AI_NS })
    } catch {
      return undefined
    }
  })()
  const settingsApi: RemoteApi = settingsScope === undefined
    ? { settings: ctx.remote.settings }
    : { settings: ctx.remote.settings, scope: settingsScope }
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

  // ---- The five injection seams ----
  // Each owns its own state now; see the module list in this file's header.
  const configuredEfforts = createConfiguredEfforts({ api: settingsApi })
  const sessionDirectory = createSessionDirectoryTracker({
    ctx,
    configuredEffort: configuredEfforts.of,
  })
  const composerMenu = createComposerMenu({
    menuOf: modelMenuOf,
    t,
    refreshed,
    sliderEnabled,
    directory: sessionDirectory.ensure,
  })
  // The running auto-fill complement (issue #7): the host fills once at boot,
  // everything a session adds afterwards is filled on the idle pass.
  const autofill = createIdleAutofill({ api: settingsApi })
  const modelsPage = createModelsPage({
    ctx, api: settingsApi, t, onIdle: autofill.run, refreshed,
  })

  /**
   * The composer path, run on every mutation burst and on every debounced
   * scan. It LEADS both for two reasons: the slider/search body must land
   * before the first paint, and a session switch must have its directory
   * watched before the new session's projection can read as Default.
   */
  const onComposerMutation = (): void => {
    sessionDirectory.ensure()
    composerMenu.reconcile()
  }

  ctx.effect(() => {
    modelsPage.start(onComposerMutation)
    return () => {
      // Land what the session held back, unmount the editors, stop observing.
      modelsPage.teardown()
      // Orphaned foreign roots must not outlive the fiber: on plugin disable
      // or HMR they would keep rendering with a stale face.
      composerMenu.dispose()
      // Restore every wrapped directory's original select (the instances
      // outlive the fiber on disable/HMR and must submit officially again).
      sessionDirectory.dispose()
    }
  }, 'dsh-better-reasoning-effort: DOM injector')

  // A page unload is the last moment the committed ledgers can be landed, and
  // the moment the rest must be DISCARDED: a reload drops the official card's
  // own draft, so the plugin's uncommitted edits go with it. (The dispose
  // effect above keeps the ledger for a same-document fiber cycle, where the
  // card survives.)
  ctx.effect(() => {
    const onPageHide = (): void => { modelsPage.flushOnUnload() }
    window.addEventListener('pagehide', onPageHide)
    return () => { window.removeEventListener('pagehide', onPageHide) }
  }, 'dsh-better-reasoning-effort: ledger flush on unload')

  // Refresh the injection when the settings document changes (an apply from
  // either the official page or this plugin re-renders the rows). The folded
  // describe snapshot is invalidated first: without that, every later scan —
  // and every editor mounted from it — would keep reading the revision and
  // providers as of the very first scan, making Apply conflict forever until
  // a full page reload.
  ctx.effect(() => {
    const refresh = (): void => {
      modelsPage.state.describePromise = undefined
      // The configured-pick cache rides the same invalidations: a document
      // update (or a fresh connection) must not leave stale picks behind.
      configuredEfforts.invalidate()
      modelsPage.schedule()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns: unknown) => {
        if (ns === PI_AI_NS) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-better-reasoning-effort: pushed invalidations')

  // Refresh the composer the moment the preference flips (the toggle and the
  // menu can be open at the same time), and follow other tabs' changes.
  ctx.effect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SLIDER_PREF_KEY) syncSliderEnabled(event.newValue !== 'false')
    }
    window.addEventListener('storage', onStorage)
    const dispose = subscribeSliderEnabled(() => { modelsPage.schedule() })
    return () => {
      window.removeEventListener('storage', onStorage)
      void dispose()
    }
  }, 'dsh-better-reasoning-effort: slider preference')

  ctx.effect(() => {
    registerSliderToggleSlot(ctx, t)
  }, 'dsh-better-reasoning-effort: footer slot activation')
}

export type { BreKey }
export { EffortEditor } from './EffortEditor.tsx'
export type { EffortEditorProps, EffortModel } from './EffortEditor.tsx'
export { findModelMenu } from './injection/model-menu.js'
export type { InjectorDeps, EditorMountProps, ScanState } from './injection/models-page-editor.js'
export * from './ops.ts'
export * from './types.ts'
