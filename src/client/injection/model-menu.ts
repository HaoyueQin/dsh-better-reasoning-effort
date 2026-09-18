/**
 * Locating the official composer model menu — the seat root's open popover.
 *
 * @module dsh-better-reasoning-effort/client/injection/model-menu
 */

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
export function modelMenuOf(): HTMLElement | undefined {
  return findModelMenu()
}
