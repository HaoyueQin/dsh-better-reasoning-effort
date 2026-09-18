/**
 * Real-time search filter for the composer model selection panel.
 *
 * Mounted at the top of the official model menu while the drilled-in model
 * list is open (pane === 'model'). Filters the official option buttons and
 * provider groups via zero-dependency DOM visibility toggles without mutating
 * the underlying ModelDirectory store.
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

/**
 * Filter official model option buttons and provider groups by search query.
 * @returns number of visible model buttons across all groups.
 */
export function filterMenuModels(menu: HTMLElement, query: string): number {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = Array.from(menu.querySelectorAll<HTMLElement>('section[role="group"]'))
  let totalVisible = 0

  if (tokens.length === 0) {
    for (const group of groups) {
      group.style.display = ''
      const buttons = Array.from(group.querySelectorAll<HTMLElement>('button[role="menuitemradio"]'))
      for (const btn of buttons) {
        btn.style.display = ''
      }
      totalVisible += buttons.length
    }
    return totalVisible
  }

  for (const group of groups) {
    const headingEl = group.querySelector<HTMLElement>('[id]') ?? (group.firstElementChild as HTMLElement | null)
    const groupName = headingEl?.textContent?.toLowerCase() ?? ''
    const buttons = Array.from(group.querySelectorAll<HTMLElement>('button[role="menuitemradio"]'))
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
  const [totalVisible, setTotalVisible] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)

  const runFilter = useCallback((nextQuery: string): void => {
    const count = filterMenuModels(menu, nextQuery)
    setTotalVisible(count)
  }, [menu])

  // Reset and restore filter on mount and unmount
  useEffect(() => {
    runFilter('')
    return () => {
      // Restore all hidden models on unmount
      filterMenuModels(menu, '')
    }
  }, [menu, runFilter])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // Move roving focus to the first visible model option
      const firstVisible = Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]'))
        .find(btn => btn.style.display !== 'none' && !btn.disabled)
      firstVisible?.focus()
    } else if (event.key === 'Escape') {
      if (query.length > 0) {
        event.stopPropagation()
        event.preventDefault()
        setQuery('')
        runFilter('')
      }
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
    { className: 'bre-model-search-box', 'data-bre-search': '1' },
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
        value: query,
        spellCheck: false,
        autoComplete: 'off',
        onInput: (e: { currentTarget: HTMLInputElement }) => {
          const val = e.currentTarget.value
          setQuery(val)
          runFilter(val)
        },
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
