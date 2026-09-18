/**
 * Real-time search filter for the composer model selection panel.
 *
 * Injected above the official provider-group list while the drilled-in model
 * pane is open (`section[role="group"]` present). Filters the official option
 * buttons and provider groups via zero-dependency DOM visibility toggles
 * without mutating the underlying ModelDirectory store, and never touches the
 * official card's own sizing or scrolling.
 *
 * @module dsh-better-reasoning-effort/client/ModelSearch
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

/** Props of {@link ModelSearch}. */
export interface ModelSearchProps {
  /** The official menu element containing group sections and model options. */
  menu: HTMLElement
  /** Localized copy translator. */
  t: (key: string, params?: Record<string, string | number>) => string
}

/** The official provider-group sections: also the model pane's own marker. */
const GROUP_SELECTOR = 'section[role="group"]'

/** The official option buttons (model rows AND effort rows share this role). */
const OPTION_SELECTOR = 'button[role="menuitemradio"]'

/**
 * Whether the menu currently shows the drilled-in model list.
 *
 * Deliberately structural: the official effort pane renders
 * `button[role="menuitemradio"]` too (ModelSelect.tsx:464) and would match a
 * role-based probe, while only the model pane renders provider groups. The
 * probe also avoids class names — the groups container's `groups` class is a
 * CSS-module hash (`Uc5hea_groups` in the official build), so a literal
 * `.groups` selector never matches.
 */
export function isModelPane(menu: HTMLElement): boolean {
  return menu.querySelector(GROUP_SELECTOR) !== null
}

/** The visible, enabled option buttons, in document order. */
export function visibleOptions(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(OPTION_SELECTOR))
    .filter(btn => !btn.disabled && btn.style.display !== 'none')
}

/**
 * A provider group's heading text, read through the official aria contract
 * (`section[role="group"][aria-labelledby]`, ModelSelect.tsx:415-416).
 *
 * No structural fallback: "the first descendant carrying an id" would be the
 * first MODEL NAME whenever the heading is missing, which would then match
 * that group on any query containing it.
 */
function groupNameOf(group: HTMLElement): string {
  const labelledBy = group.getAttribute('aria-labelledby')
  const heading = labelledBy === null ? null : group.ownerDocument.getElementById(labelledBy)
  return heading?.textContent?.toLowerCase() ?? ''
}

/**
 * Filter official model option buttons and provider groups by search query.
 *
 * `touched` records the inline `display` each node held BEFORE this filter
 * first changed it, so the restore pass puts back the node's own value instead
 * of blindly clearing an inline style the official menu may have set itself.
 * @param menu - the official menu element.
 * @param query - the raw search text; empty restores everything.
 * @param touched - carry-over map of the nodes this filter currently hides.
 * @returns number of visible model buttons across all groups.
 */
export function filterMenuModels(
  menu: HTMLElement,
  query: string,
  touched: Map<HTMLElement, string> = new Map(),
): number {
  const hide = (element: HTMLElement): void => {
    if (!touched.has(element)) touched.set(element, element.style.display)
    element.style.display = 'none'
  }
  const show = (element: HTMLElement): void => {
    const original = touched.get(element)
    if (original === undefined) return
    element.style.display = original
    touched.delete(element)
  }
  // The official list replaces its rows on a re-render; detached nodes must not
  // accumulate in the map for the lifetime of an open menu.
  for (const element of [...touched.keys()]) {
    if (!element.isConnected) touched.delete(element)
  }

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = Array.from(menu.querySelectorAll<HTMLElement>(GROUP_SELECTOR))
  let totalVisible = 0

  // An empty query restores EVERYTHING unconditionally — including a group
  // that carries a heading but no options at all, which the matching branch
  // below would otherwise hide.
  if (tokens.length === 0) {
    for (const element of [...touched.keys()]) show(element)
    for (const group of groups) {
      totalVisible += group.querySelectorAll(OPTION_SELECTOR).length
    }
    return totalVisible
  }

  for (const group of groups) {
    const groupName = groupNameOf(group)
    const buttons = Array.from(group.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
    let visibleInGroup = 0

    for (const btn of buttons) {
      const titleText = (btn.getAttribute('title') ?? '').toLowerCase()
      const contentText = (btn.textContent ?? '').toLowerCase()
      const combined = `${groupName} ${titleText} ${contentText}`

      if (tokens.every(token => combined.includes(token))) {
        show(btn)
        visibleInGroup += 1
      } else {
        hide(btn)
      }
    }

    if (visibleInGroup > 0) {
      show(group)
      totalVisible += visibleInGroup
    } else {
      hide(group)
    }
  }

  return totalVisible
}

/**
 * Search input and empty-state controller for the model menu.
 */
export function ModelSearch({ menu, t }: ModelSearchProps): ReactNode {
  const [query, setQuery] = useState('')
  // No sentinel needed: an empty query can never show the empty state, so the
  // first frame is correct before any filter has run.
  const [totalVisible, setTotalVisible] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef('')
  // The nodes this filter currently hides, with the inline display each held
  // before this plugin first touched it (see filterMenuModels).
  const touchedRef = useRef(new Map<HTMLElement, string>())

  const runFilter = useCallback((nextQuery: string): void => {
    queryRef.current = nextQuery
    const count = filterMenuModels(menu, nextQuery, touchedRef.current)
    setTotalVisible(count)
  }, [menu])

  // Restore every row this filter hid when the box goes away (pane switch,
  // menu close, plugin dispose). There is deliberately NO mount-time pass: the
  // initial query is empty, so the list is already unfiltered — and a mount
  // pass would run from a PASSIVE effect, i.e. it can land AFTER a keystroke
  // the user already made and silently wipe the filter with it.
  useEffect(() => () => {
    filterMenuModels(menu, '', touchedRef.current)
  }, [menu])

  // Keep the filter applied across the official list's OWN re-renders: the
  // directory store can push a fresh catalog (an edit elsewhere, a connection
  // reset) while the menu is open, and the rows React rebuilds come back
  // visible with the query still in the box. Only childList is observed, so
  // this plugin's own display writes can never re-trigger the observer.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (queryRef.current.trim().length === 0) return
      runFilter(queryRef.current)
    })
    observer.observe(menu, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [menu, runFilter])

  // While a filter is active the plugin owns the list-navigation keys for rows
  // INSIDE the list. Reason: the official roving focus (ModelSelect.tsx:215-226)
  // walks every ref'd row, including the ones this filter hid — focus() on a
  // display:none node is a no-op, so the official handler would stick on the
  // same item forever (and Home/End/PageUp/PageDown would do nothing at all).
  // A CAPTURE-phase native listener stops the event before the official
  // bubble-phase handler (delegated to the portaled container, an ancestor of
  // this plugin's own root container) ever sees it.
  //
  // It must NOT touch keys aimed at the input: the input lives inside this
  // plugin's own React root, whose container is a DESCENDANT of the menu, so
  // capturing here and stopping would swallow the key before the input's own
  // React handler could run.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (queryRef.current.trim().length === 0) return
      const key = event.key
      const arrow = key === 'ArrowDown' || key === 'ArrowUp'
      const jump = key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown'
      if (!arrow && !jump) return
      if (event.target === inputRef.current) return
      if (event.target instanceof Node && !menu.contains(event.target)) return
      const options = visibleOptions(menu)
      if (options.length === 0) return
      const current = options.findIndex(option => option === document.activeElement)
      let next: number
      if (key === 'Home' || key === 'PageUp') next = 0
      else if (key === 'End' || key === 'PageDown') next = options.length - 1
      else if (key === 'ArrowDown') next = current === -1 ? 0 : (current + 1) % options.length
      else next = current === -1 ? options.length - 1 : (current - 1 + options.length) % options.length
      event.preventDefault()
      event.stopPropagation()
      options[next]?.focus()
    }
    menu.addEventListener('keydown', onKeyDown, true)
    return () => { menu.removeEventListener('keydown', onKeyDown, true) }
  }, [menu])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const key = event.key
    if (key === 'ArrowDown') {
      event.preventDefault()
      // The official handler runs later in this same dispatch (from an
      // ancestor container) and would step one row PAST the one focused here,
      // so the keystroke is consumed instead.
      event.stopPropagation()
      visibleOptions(menu)[0]?.focus()
      return
    }
    if (query.trim().length > 0 && (key === 'ArrowUp' || key === 'Home' || key === 'PageUp' || key === 'End' || key === 'PageDown')) {
      const options = visibleOptions(menu)
      if (options.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        const last = key === 'ArrowUp' || key === 'End' || key === 'PageDown'
        options[last ? options.length - 1 : 0]?.focus()
      }
      return
    }
    if (key === 'Escape' && query.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
      runFilter('')
    }
  }

  const handleClear = (): void => {
    setQuery('')
    runFilter('')
    inputRef.current?.focus({ preventScroll: true })
  }

  const hasEmptyState = totalVisible === 0 && query.trim().length > 0

  return createElement(
    'div',
    { className: 'bre-model-search-box' + (hasEmptyState ? ' has-empty' : ''), 'data-bre-search': '1' },
    createElement(
      'div',
      { className: 'bre-search-input-wrapper' },
      createElement(
        'span',
        { className: 'bre-search-icon', 'aria-hidden': 'true' },
        createElement(
          'svg',
          { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' },
          createElement('circle', { cx: '7', cy: '7', r: '4.5' }),
          createElement('path', { d: 'M10.5 10.5L14 14', strokeLinecap: 'round' }),
        ),
      ),
      createElement('input', {
        ref: inputRef,
        type: 'text',
        className: 'bre-search-input',
        // ARIA has no legal textbox inside `role="menu"`; the box is labelled
        // and fully operable, so `searchbox` is the least-wrong role for it —
        // the same documented-tradeoff shape the slider's hidden cells carry.
        role: 'searchbox',
        placeholder: t('modelSearchPlaceholder'),
        'aria-label': t('modelSearchPlaceholder'),
        value: query,
        spellCheck: false,
        autoComplete: 'off',
        onChange: (e: { currentTarget: HTMLInputElement }) => {
          const val = e.currentTarget.value
          setQuery(val)
          runFilter(val)
        },
        onKeyDown: handleKeyDown,
      }),
      query.length > 0
        ? createElement(
            'button',
            {
              type: 'button',
              className: 'bre-search-clear',
              title: t('modelSearchClear'),
              'aria-label': t('modelSearchClear'),
              onClick: handleClear,
            },
            createElement(
              'svg',
              { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' },
              createElement('path', { d: 'M4 4L12 12M12 4L4 12', strokeLinecap: 'round' }),
            ),
          )
        : null,
    ),
    hasEmptyState
      ? createElement(
          'div',
          { className: 'bre-search-empty', role: 'status' },
          t('modelSearchNoMatches'),
        )
      : null,
  )
}
