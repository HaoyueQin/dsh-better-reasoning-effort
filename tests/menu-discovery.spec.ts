/**
 * Model-menu discovery tests: the composer slider mounts inside the OFFICIAL
 * model menu, whose DOM shape changed in DeepSeek Harness 0.1.5-alpha.1.
 *
 *   - pre-portal: the menu renders inline inside [data-composer-card], right
 *     after its trigger button (previousElementSibling is the trigger).
 *   - 0.1.5: the menu is portaled to document.body; the seat trigger keeps it
 *     linked via aria-controls="<menu id>".
 *
 * Both shapes keep aria-haspopup="menu" on the trigger and role="menu" + a
 * stable id on the menu, so the controls link is the primary route and the
 * sibling check stays as the fallback. Only 0.1.5+ is supported, but the
 * finder stays shape-tolerant so a host rendering either shape keeps working.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { findModelMenu } from '../src/client/index.js'

/** A seat trigger wired to a menu id, as the host renders it. */
function trigger(menuId: string | null): HTMLButtonElement {
  const button = document.createElement('button')
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'true')
  if (menuId !== null) button.setAttribute('aria-controls', menuId)
  return button
}

function menu(id: string): HTMLElement {
  const el = document.createElement('div')
  el.id = id
  el.setAttribute('role', 'menu')
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findModelMenu', () => {
  it('finds the portaled 0.1.5 menu via the trigger aria-controls link', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    card.appendChild(trigger('tid-menu'))
    document.body.appendChild(card)
    const portaled = menu('tid-menu')
    document.body.appendChild(portaled)

    expect(findModelMenu()).toBe(portaled)
  })

  it('finds the pre-portal inline menu next to its trigger', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const inline = menu('tid-menu')
    card.appendChild(trigger('tid-menu'))
    card.appendChild(inline)
    document.body.appendChild(card)

    expect(findModelMenu()).toBe(inline)
  })

  it('returns undefined when the linked menu id names nothing', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    card.appendChild(trigger('ghost-menu'))
    document.body.appendChild(card)

    expect(findModelMenu()).toBeUndefined()
  })

  it('ignores a linked element that is not a menu', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    card.appendChild(trigger('not-a-menu'))
    document.body.appendChild(card)
    const impostor = document.createElement('div')
    impostor.id = 'not-a-menu'
    document.body.appendChild(impostor)

    expect(findModelMenu()).toBeUndefined()
  })

  it('returns undefined when no menu is open', () => {
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const closed = trigger(null)
    closed.removeAttribute('aria-expanded')
    card.appendChild(closed)
    document.body.appendChild(card)

    expect(findModelMenu()).toBeUndefined()
  })
})
