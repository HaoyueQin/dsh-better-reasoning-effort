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
 * aria-haspopup="menu" on the trigger, so the controls link is the primary
 * route and the sibling check stays as the fallback. Trigger search stays
 * scoped to the composer card, so other seats' menus never match; no copy
 * text is read, so every locale matches.
 *
 * The seat is the composer card itself: a document without one carries no
 * seat at all (a settings-only page or window, a detached render). The finder
 * returns undefined rather than widening to the document, because that
 * surface's OWN linked menus — the settings header's restart dropdown, for
 * one — are not the model menu, and the slider would replace their body
 * (issue #24).
 *
 * The popover's ROLE is shape-tolerant too: `menu` on every pane but the
 * 0.2.0-rc.2 model list, which swaps in `group` because its own list box
 * takes role="menu" (ModelSelect.tsx:484). There the menu rows identify the
 * popover instead -- see {@link isSeatPopup}.
 */

/**
 * Whether an element is the seat's popover rather than some other linked or
 * grouped node.
 *
 * A role of `menu` is enough. A role of `group` is the 0.2.0-rc.2 model
 * list pane: the popover itself becomes a plain group, so the honest probe is
 * "does it carry menu rows?" — which also keeps unrelated groups (a settings
 * fieldset, the pane's inner sections' wrapper) from matching.
 */
function isSeatPopup(element: HTMLElement): boolean {
  const role = element.getAttribute('role')
  if (role === 'menu') return true
  return role === 'group'
    && element.querySelector('[role="menuitem"], [role="menuitemradio"]') !== null
}

export function findModelMenu(doc: Document = document): HTMLElement | undefined {
  // The seat lives only inside the composer card. Without one this surface has
  // no seat: return early instead of scanning the document, whose unrelated
  // menus would otherwise be adopted as the model menu (issue #24).
  const card = doc.querySelector('[data-composer-card]')
  if (card === null) return undefined
  for (const trigger of Array.from(card.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"][aria-controls]'))) {
    const id = trigger.getAttribute('aria-controls')
    if (id === null || id.length === 0) continue
    const menu = doc.getElementById(id)
    if (menu !== null && isSeatPopup(menu)) return menu
  }
  // Fallback: the pre-portal inline shape — the popover sits right after its
  // trigger button, which disambiguates it from other popovers in the card.
  const popovers = Array.from(card.querySelectorAll<HTMLElement>('[role="menu"], [role="group"]'))
  for (const popover of popovers) {
    if (popover.previousElementSibling?.matches('button[aria-haspopup="menu"]') && isSeatPopup(popover)) return popover
  }
  return undefined
}

/** The official composer model menu: the seat root's open popover. */
export function modelMenuOf(): HTMLElement | undefined {
  return findModelMenu()
}
