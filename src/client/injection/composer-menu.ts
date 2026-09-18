/**
 * The composer model menu injection: the reasoning-effort slider AND the model
 * search box, both mounted inside the OFFICIAL model menu opened from the
 * bottom-right seat. The seat's trigger is never touched — the official
 * "model · effort" display stays.
 *
 * This module is the single place that decides which pane the menu is showing,
 * where each foreign body sits, and when each one retires. The two pane probes
 * look alike but answer different questions, and must NOT be merged:
 *
 *   - the slider's probe — `[role="menuitemradio"]` — asks "did the official
 *     drill-in replace my replica body?". The effort pane matches too, which
 *     is fine: our body belongs to the root pane either way.
 *   - the search's probe — `section[role="group"]` — asks "is there a
 *     filterable model list here?". The effort pane has no groups, so a
 *     role-based probe would mount a search box over a list it cannot filter.
 *
 * @module dsh-better-reasoning-effort/client/injection/composer-menu
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { PLUGIN_ID } from '../../constants.js'
import { ComposerSlider } from '../ComposerSlider.js'
import { ModelSearch, isModelPane } from '../ModelSearch.js'
import type { ModelDirectoryLike } from '../types.js'
import { EffortBoundary, mountReact, unmountReact, type ForeignMount } from './mount.js'
import { modelMenuOf } from './model-menu.js'

/** Everything the composer injection needs from its host. */
export interface ComposerMenuDeps {
  /** The official menu element, or undefined while it is closed. */
  menuOf: () => HTMLElement | undefined
  /** The plugin's locale-bound translator. */
  t: Translate
  /** Wrap a subtree so it re-translates on a language switch. */
  refreshed: (children: () => ReactNode) => ReactNode
  /** Whether the composer slider preference is on. */
  sliderEnabled: () => boolean
  /** The current session's model directory, or undefined in the boot window. */
  directory: () => ModelDirectoryLike | undefined
}

/** The composer injection's face: one reconcile per scan, one dispose per fiber. */
export interface ComposerMenuInjection {
  /** Mount/reposition/retire both foreign roots (idempotent, mutation-cheap). */
  reconcile: () => void
  /** Unmount both roots; the fiber is going away. */
  dispose: () => void
}

/**
 * Build the composer menu injection.
 * @param deps - menu lookup, copy, locale refresh, preference and directory.
 * @returns the injection's {@link ComposerMenuInjection} face.
 */
export function createComposerMenu(deps: ComposerMenuDeps): ComposerMenuInjection {
  const { menuOf, t, refreshed, sliderEnabled, directory } = deps
  let sliderMount: ForeignMount | undefined
  let searchMount: ForeignMount | undefined

  const unmountSearch = (): void => {
    unmountReact(searchMount)
    searchMount = undefined
  }

  /**
   * Reconcile the search box into the official model menu (idempotent).
   *
   * Deliberately NO class on the menu and NO width/height of our own: the
   * official card measures itself in a layout effect whose deps
   * ([open, pane, state], ModelSelect.tsx:163-188) a later injection cannot
   * invalidate, so any resize from here would leave the card anchored to its
   * pre-injection height (and no longer right-aligned with its trigger). The
   * official box already caps itself (max-height) and scrolls its groups
   * container, so it needs no help.
   */
  const reconcileSearch = (menu: HTMLElement): void => {
    // Positioned from STRUCTURE, not class names: the group sections' parent
    // IS the official scrolling container, while the `groups` class on it is a
    // CSS-module hash (`Uc5hea_groups`) that a literal `.groups` selector never
    // matches. Inserting before that container keeps the official load notices
    // on top and leaves the slider wrapper as the menu's first child.
    const group = menu.querySelector<HTMLElement>('section[role="group"]')
    const container = group?.parentElement
    const referenceNode = (container !== null && container !== undefined && container.parentElement === menu)
      ? container
      : group

    if (searchMount === undefined) {
      const wrapper = document.createElement('div')
      wrapper.dataset['plugin'] = PLUGIN_ID
      wrapper.dataset['breSearch'] = '1'
      menu.insertBefore(wrapper, referenceNode)
      searchMount = mountReact(
        wrapper,
        createElement(EffortBoundary, {
          fallbackText: t('modelSearchFailed'),
          children: refreshed(() => createElement(ModelSearch, { menu, t })),
        }),
      )
      return
    }
    if (searchMount.wrapper.parentElement !== menu) {
      menu.insertBefore(searchMount.wrapper, referenceNode)
      return
    }
    if (referenceNode !== null && searchMount.wrapper.nextSibling !== referenceNode) {
      menu.insertBefore(searchMount.wrapper, referenceNode)
    }
  }

  /** Reconcile the slider into the official model menu (idempotent). */
  const reconcileSliderInto = (menu: HTMLElement): void => {
    if (!sliderEnabled()) {
      unmountReact(sliderMount)
      sliderMount = undefined
      // The preference flipped off while the menu stayed open: the host menu
      // must go back to the official content-sized box AND its root cells
      // must become visible again (the active branch hides them inline).
      menu.classList.remove('bre-model-menu-host')
      for (const el of Array.from(menu.children)) {
        if (el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem') {
          el.style.display = ''
        }
      }
      return
    }
    const resolved = directory()
    if (resolved === undefined) {
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
            directory: resolved,
            t,
            // Our model row replicates upstream's: clicking it opens the
            // OFFICIAL model list. The official cells are the menu's DIRECT
            // children (role=menuitem); this replicated row is nested inside
            // the wrapper, so a document-order querySelector would find our
            // OWN row first and recurse — the direct-child scope is what
            // keeps the click on the official "Model" cell. The drill-in
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

  const reconcile = (): void => {
    const menu = menuOf()
    if (menu === undefined) {
      unmountReact(sliderMount)
      sliderMount = undefined
      unmountSearch()
      return
    }
    // The search box is unconditional: it does not follow the slider
    // preference (see the spec's "搜索恒开" decision).
    if (isModelPane(menu)) reconcileSearch(menu)
    else unmountSearch()

    reconcileSliderInto(menu)
  }

  const dispose = (): void => {
    unmountReact(sliderMount)
    sliderMount = undefined
    unmountSearch()
  }

  return { reconcile, dispose }
}
