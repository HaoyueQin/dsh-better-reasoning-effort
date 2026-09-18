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
 * (`section[role="group"][aria-labelledby]`, ModelSelect.tsx:415-416) rather
 * than "the first descendant carrying an id".
 */
function groupNameOf(group: HTMLElement): string {
  const labelledBy = group.getAttribute('aria-labelledby')
  const heading = labelledBy === null ? null : group.ownerDocument.getElementById(labelledBy)
  const source = heading ?? (group.firstElementChild instanceof HTMLElement ? group.firstElementChild : null)
  return source?.textContent?.toLowerCase() ?? ''
}

/**
 * Filter official model option buttons and provider groups by search query.
 * @returns number of visible model buttons across all groups.
 */
export function filterMenuModels(menu: HTMLElement, query: string): number {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = Array.from(menu.querySelectorAll<HTMLElement>(GROUP_SELECTOR))
  let totalVisible = 0

  // An empty query restores EVERYTHING unconditionally — including a group
  // that carries a heading but no options at all, which the matching branch
  // below would otherwise hide.
  if (tokens.length === 0) {
    for (const group of groups) {
      group.style.display = ''
      const buttons = Array.from(group.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
      for (const btn of buttons) {
        btn.style.display = ''
      }
      totalVisible += buttons.length
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

      const matches = tokens.every(token => combined.includes(token))
      if (matches) {
        btn.style.display = ''
        visibleInGroup += 1
      } else {
        btn.style.display = 'none'
      }
    }

    if (visibleInGroup > 0) {
      group.style.display = ''
      totalVisible += visibleInGroup
    } else {
      group.style.display = 'none'
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

  const runFilter = useCallback((nextQuery: string): void => {
    queryRef.current = nextQuery
    const count = filterMenuModels(menu, nextQuery)
    setTotalVisible(count)
  }, [menu])

  // Restore every row this filter hid when the box goes away (pane switch,
  // menu close, plugin dispose). There is deliberately NO mount-time pass: the
  // initial query is empty, so the list is already unfiltered — and a mount
  // pass would run from a PASSIVE effect, i.e. it can land AFTER a keystroke
  // the user already made and silently wipe the filter with it.
  useEffect(() => () => {
    filterMenuModels(menu, '')
  }, [menu])

  // While a filter is active the plugin owns the arrow keys for rows INSIDE
  // the list. Reason: the official roving focus (ModelSelect.tsx:215-226)
  // walks every ref'd row, including the ones this filter hid — focus() on a
  // display:none node is a no-op, so the official handler would stick on the
  // same item forever. A CAPTURE-phase native listener stops the event before
  // the official bubble-phase handler (delegated to the portaled container, an
  // ancestor of this plugin's own root container) ever sees it.
  //
  // It must NOT touch keys aimed at the input: the input lives inside this
  // plugin's own React root, whose container is a DESCENDANT of the menu, so
  // capturing here and stopping would swallow the key before the input's own
  // React handler could run.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (queryRef.current.trim().length === 0) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.target === inputRef.current) return
      if (event.target instanceof Node && !menu.contains(event.target)) return
      const options = visibleOptions(menu)
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      const current = options.findIndex(option => option === document.activeElement)
      const next = current === -1
        ? (step > 0 ? 0 : options.length - 1)
        : (current + step + options.length) % options.length
      event.preventDefault()
      event.stopPropagation()
      options[next]?.focus()
    }
    menu.addEventListener('keydown', onKeyDown, true)
    return () => { menu.removeEventListener('keydown', onKeyDown, true) }
  }, [menu])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // The official handler runs later in this same dispatch (from an
      // ancestor container) and would step one row PAST the one focused here,
      // so the keystroke is consumed instead.
      event.stopPropagation()
      visibleOptions(menu)[0]?.focus()
      return
    }
    if (event.key === 'Escape' && query.length > 0) {
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
