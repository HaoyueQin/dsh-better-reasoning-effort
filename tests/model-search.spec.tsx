/**
 * ModelSearch unit tests: real-time filtering, empty state, and keyboard navigation.
 */

// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ModelSearch, filterMenuModels } from '../src/client/ModelSearch.js'
import { en } from '../src/client/locales.js'

;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

function t(key: string): string {
  return (en as Record<string, string>)[key] ?? key
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function createMenuDom(): HTMLElement {
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.className = 'menu'

  const groupsContainer = document.createElement('div')
  // The official build ships a CSS-module class here (`Uc5hea_groups`), so a
  // literal `.groups` selector must not be what the plugin relies on.
  groupsContainer.className = 'Uc5hea_groups scrollable'

  // Group 1: DeepSeek
  const group1 = document.createElement('section')
  group1.setAttribute('role', 'group')
  group1.setAttribute('aria-labelledby', 'group-ds')

  const title1 = document.createElement('div')
  title1.id = 'group-ds'
  title1.textContent = 'DeepSeek'
  group1.appendChild(title1)

  const m1 = document.createElement('button')
  m1.setAttribute('role', 'menuitemradio')
  m1.setAttribute('title', 'DeepSeek V4.1 Flash')
  m1.innerHTML = '<span class="modelName">DeepSeek V4.1 Flash</span>'
  group1.appendChild(m1)

  const m2 = document.createElement('button')
  m2.setAttribute('role', 'menuitemradio')
  m2.setAttribute('title', 'DeepSeek R1 Pro')
  m2.innerHTML = '<span class="modelName">DeepSeek R1 Pro</span>'
  group1.appendChild(m2)

  // Group 2: OpenAI
  const group2 = document.createElement('section')
  group2.setAttribute('role', 'group')
  group2.setAttribute('aria-labelledby', 'group-openai')

  const title2 = document.createElement('div')
  title2.id = 'group-openai'
  title2.textContent = 'OpenAI'
  group2.appendChild(title2)

  const m3 = document.createElement('button')
  m3.setAttribute('role', 'menuitemradio')
  m3.setAttribute('title', 'GPT-4o')
  m3.innerHTML = '<span class="modelName">GPT-4o</span>'
  group2.appendChild(m3)

  groupsContainer.appendChild(group1)
  groupsContainer.appendChild(group2)
  menu.appendChild(groupsContainer)
  document.body.appendChild(menu)

  return menu
}

describe('filterMenuModels', () => {
  it('returns all models when query is empty and keeps everything visible', () => {
    const menu = createMenuDom()
    const count = filterMenuModels(menu, '')
    expect(count).toBe(3)

    const buttons = menu.querySelectorAll('button[role="menuitemradio"]')
    buttons.forEach((btn) => {
      expect((btn as HTMLElement).style.display).toBe('')
    })
    const groups = menu.querySelectorAll('section[role="group"]')
    groups.forEach((g) => {
      expect((g as HTMLElement).style.display).toBe('')
    })
    menu.remove()
  })

  it('filters models matching query case-insensitively', () => {
    const menu = createMenuDom()
    const count = filterMenuModels(menu, 'flash')
    expect(count).toBe(1)

    const dsGroup = menu.querySelectorAll('section[role="group"]')[0] as HTMLElement
    const openaiGroup = menu.querySelectorAll('section[role="group"]')[1] as HTMLElement

    expect(dsGroup.style.display).toBe('')
    expect(openaiGroup.style.display).toBe('none')

    const m1 = dsGroup.querySelector('button[title="DeepSeek V4.1 Flash"]') as HTMLElement
    const m2 = dsGroup.querySelector('button[title="DeepSeek R1 Pro"]') as HTMLElement
    expect(m1.style.display).toBe('')
    expect(m2.style.display).toBe('none')

    menu.remove()
  })

  it('matches multiple space-separated tokens', () => {
    const menu = createMenuDom()
    const count = filterMenuModels(menu, 'deepseek r1')
    expect(count).toBe(1)

    const m2 = menu.querySelector('button[title="DeepSeek R1 Pro"]') as HTMLElement
    expect(m2.style.display).toBe('')

    menu.remove()
  })

  it('matches provider group name', () => {
    const menu = createMenuDom()
    const count = filterMenuModels(menu, 'openai')
    expect(count).toBe(1)

    const m3 = menu.querySelector('button[title="GPT-4o"]') as HTMLElement
    expect(m3.style.display).toBe('')

    menu.remove()
  })

  it('hides all groups when nothing matches', () => {
    const menu = createMenuDom()
    const count = filterMenuModels(menu, 'nonexistent-model')
    expect(count).toBe(0)

    const groups = menu.querySelectorAll('section[role="group"]')
    groups.forEach((g) => {
      expect((g as HTMLElement).style.display).toBe('none')
    })

    menu.remove()
  })
})

describe('ModelSearch component', () => {
  it('renders input, triggers filter on typing, and shows clear button', async () => {
    const menu = createMenuDom()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(ModelSearch, { menu, t }))
    })

    const input = container.querySelector('input.bre-search-input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.placeholder).toBe('Search models…')

    // Initially no clear button
    expect(container.querySelector('.bre-search-clear')).toBeNull()

    // Type "gpt"
    await act(async () => {
      setInputValue(input, 'gpt')
    })

    // Now clear button appears
    const clearBtn = container.querySelector('.bre-search-clear') as HTMLButtonElement
    expect(clearBtn).not.toBeNull()

    // OpenAI group should be visible, DeepSeek group hidden
    const dsGroup = menu.querySelectorAll('section[role="group"]')[0] as HTMLElement
    const openaiGroup = menu.querySelectorAll('section[role="group"]')[1] as HTMLElement
    expect(dsGroup.style.display).toBe('none')
    expect(openaiGroup.style.display).toBe('')

    // Click clear button
    await act(async () => {
      clearBtn.click()
    })

    expect(input.value).toBe('')
    expect(dsGroup.style.display).toBe('')
    expect(openaiGroup.style.display).toBe('')

    await act(async () => {
      root.unmount()
    })
    container.remove()
    menu.remove()
  })

  it('shows empty state message when no models match', async () => {
    const menu = createMenuDom()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(ModelSearch, { menu, t }))
    })

    const input = container.querySelector('input.bre-search-input') as HTMLInputElement
    await act(async () => {
      setInputValue(input, 'xyz404')
    })

    const empty = container.querySelector('.bre-search-empty')
    expect(empty).not.toBeNull()
    expect(empty?.textContent).toBe('No matching models')

    await act(async () => {
      root.unmount()
    })
    container.remove()
    menu.remove()
  })
})

describe('filter lifecycle', () => {
  it('restores only the nodes it hid, leaving the menu\'s own inline display alone', () => {
    const menu = createMenuDom()
    const group = menu.querySelectorAll('section[role="group"]')[0] as HTMLElement
    // A value the OFFICIAL menu set itself; the plugin must never clear it.
    group.style.display = 'contents'

    const touched = new Map<HTMLElement, string>()
    filterMenuModels(menu, 'gpt', touched)
    filterMenuModels(menu, '', touched)

    expect(group.style.display).toBe('contents')
    expect(touched.size).toBe(0)
    menu.remove()
  })

  it('re-applies the filter when the official list re-renders underneath it', async () => {
    const menu = createMenuDom()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(ModelSearch, { menu, t }))
    })
    const input = container.querySelector('input.bre-search-input') as HTMLInputElement
    await act(async () => {
      setInputValue(input, 'deepseek')
    })

    // The official directory pushes a fresh catalog while the menu is open:
    // React appends a brand-new group + row, which must not come back visible.
    const fresh = document.createElement('section')
    fresh.setAttribute('role', 'group')
    fresh.setAttribute('aria-labelledby', 'group-fresh')
    const heading = document.createElement('div')
    heading.id = 'group-fresh'
    heading.textContent = 'Fresh'
    const row = document.createElement('button')
    row.setAttribute('role', 'menuitemradio')
    row.setAttribute('title', 'Fresh Model')
    fresh.append(heading, row)
    menu.appendChild(fresh)

    await act(async () => {
      await new Promise(resolve => { setTimeout(resolve, 0) })
    })

    expect(fresh.style.display).toBe('none')
    expect(row.style.display).toBe('none')

    await act(async () => {
      root.unmount()
    })
    container.remove()
    menu.remove()
  })

  it('moves focus to the first/last VISIBLE row on Home and End while filtering', async () => {
    const menu = createMenuDom()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(ModelSearch, { menu, t }))
    })
    const input = container.querySelector('input.bre-search-input') as HTMLInputElement
    await act(async () => {
      setInputValue(input, 'deepseek')
    })

    const visible = Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]'))
      .filter(button => button.style.display !== 'none')
    expect(visible).toHaveLength(2)

    await act(async () => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(visible[1])

    await act(async () => {
      visible[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(visible[0])

    await act(async () => {
      root.unmount()
    })
    container.remove()
    menu.remove()
  })
})
