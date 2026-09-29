/**
 * Composer menu injection tests, driven through the plugin's real entry point
 * (apply) against a fixture that reproduces DSH 0.2.0-rc.2's own ModelSelect
 * shapes: the root pane and the effort pane keep role="menu" and render the
 * official cells, while the model list pane swaps the popover's role to
 * `group` — its inner list box takes role="menu" — and mounts its own search
 * row. The pane switch is therefore also the role switch.
 *
 * Timing note: the plugin mounts its React root from a MutationObserver
 * microtask, so the wrapper element shows up one React commit BEFORE the
 * slider input inside it. Every helper waits for the element it is about to
 * use, never for an ancestor.
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { directoryFixture, fakeApi, JOIN_FIXTURE, makeCtx, makeJoin, waitFor } from './support/composer-fixture.js'

/** The `apply()` context shape, mirroring tests/client.spec.tsx. */
type Ctx = Parameters<typeof import('../src/client/index.js').apply>[0]

/** Which official pane the open popover shows. */
type Pane = 'root' | 'model' | 'effort'

/** The official markup of one pane, as 0.2.0-rc.2 renders it. */
const PANE_HTML: Readonly<Record<Pane, string>> = {
  root: `
    <button role="menuitem">Model<span>DeepSeek V4</span></button>
    <button role="menuitem">Effort<span>High</span></button>`,
  model: `
    <div class="searchRow"><input role="searchbox" aria-label="Search models…" /></div>
    <div role="menu" class="Uc5hea_groups scrollable">
      <section role="group" aria-labelledby="g-ds" data-menu-group>
        <span data-menu-group-start></span>
        <div id="g-ds" data-menu-group-heading>DeepSeek</div>
        <button role="menuitemradio" aria-checked="true" title="DeepSeek V4.1 Flash">DeepSeek V4.1 Flash</button>
      </section>
    </div>`,
  effort: `
    <button role="menuitemradio" aria-checked="false" title="High">High</button>
    <button role="menuitemradio" aria-checked="false" title="Low">Low</button>`,
}

/** Build the composer card and return its open popover carrying one pane. */
function buildMenu(pane: Pane): HTMLElement {
  document.body.insertAdjacentHTML('beforeend', `
    <div data-composer-card>
      <button aria-haspopup="menu" aria-controls="seat-menu">DeepSeek V4 · High</button>
      <div id="seat-menu"></div>
    </div>
  `)
  const menu = document.querySelector<HTMLElement>('#seat-menu')!
  replacePane(menu, pane)
  return menu
}

/**
 * Swap the popover to another pane the way React does: only the official
 * children are replaced — the plugin's foreign wrapper is not one of them and
 * survives the swap — and the popover's role follows the pane.
 */
function replacePane(menu: HTMLElement, pane: Pane): void {
  for (const child of Array.from(menu.children)) {
    if (child instanceof HTMLElement && child.dataset['breSlider'] === '1') continue
    child.remove()
  }
  menu.setAttribute('role', pane === 'model' ? 'group' : 'menu')
  menu.insertAdjacentHTML('beforeend', PANE_HTML[pane])
}

/** The official root cells of the popover, in document order. */
function rootCells(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.children).filter((el): el is HTMLButtonElement =>
    el instanceof HTMLButtonElement && el.getAttribute('role') === 'menuitem')
}

/** Apply the plugin against a fresh fixture and tear everything down after. */
async function withAppliedMenu(
  pane: Pane,
  body: (menu: HTMLElement, handlers: { dispose: () => void }) => Promise<void>,
): Promise<void> {
  const { apply } = await import('../src/client/index.js')
  const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
  const h = makeCtx(api, {
    services: {
      sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
      modelDirectories: { directoryFor: () => directoryFixture() },
    },
  })
  try {
    const menu = buildMenu(pane)
    apply(h.ctx as unknown as Ctx)
    await body(menu, { dispose: () => { h.disposeAll() } })
  } finally {
    h.disposeAll()
    document.body.innerHTML = ''
  }
}

describe('the replica across the official panes', () => {
  it('mounts the replica first and hides the official root cells', async () => {
    await withAppliedMenu('root', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = menu.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      expect(menu.firstChild).toBe(wrapper)
      // The hosted menu takes the upstream .re-model-menu width.
      expect(menu.classList.contains('bre-model-menu-host')).toBe(true)
      expect(rootCells(menu)).toHaveLength(2)
      for (const cell of rootCells(menu)) expect(cell.style.display).toBe('none')
    })
  })

  it('retires the replica while the rc.2 model list pane is open, then restores it', async () => {
    await withAppliedMenu('root', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = menu.querySelector<HTMLElement>('[data-bre-slider="1"]')!

      // rc.2 keeps the popover a plain group in this pane. Were the finder
      // still role="menu"-only, the injection would lose the menu and UNMOUNT
      // the wrapper instead of hiding it.
      replacePane(menu, 'model')
      await waitFor(() => wrapper.style.display === 'none')
      expect(menu.getAttribute('role')).toBe('group')
      expect(wrapper.parentElement).toBe(menu)

      replacePane(menu, 'root')
      await waitFor(() => wrapper.style.display === '')
      expect(menu.firstChild).toBe(wrapper)
      for (const cell of rootCells(menu)) expect(cell.style.display).toBe('none')
    })
  })

  it('retires the replica while the effort pane is open', async () => {
    await withAppliedMenu('effort', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = menu.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      await waitFor(() => wrapper.style.display === 'none')
    })
  })

  it('unmounts the replica when the fiber goes away', async () => {
    await withAppliedMenu('root', async (menu, handlers) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      handlers.dispose()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(menu.querySelector('[data-bre-slider="1"]')).toBeNull()
    })
  })
})

describe('official card re-place after injection', () => {
  it('re-places the card once per pane change, in the same turn as the edit', async () => {
    await withAppliedMenu('root', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      const wrapper = menu.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      let resizes = 0
      const onResize = (): void => { resizes += 1 }
      window.addEventListener('resize', onResize)
      try {
        let resizesWhenRetired: number | null = null
        const observer = new MutationObserver(() => {
          if (resizesWhenRetired !== null) return
          if (wrapper.style.display === 'none') resizesWhenRetired = resizes
        })
        observer.observe(wrapper, { attributes: true, attributeFilter: ['style'] })
        try {
          replacePane(menu, 'model')
          await waitFor(() => resizesWhenRetired !== null)
          // The re-place must have happened by the time the replica is hidden:
          // one frame later is exactly the visible jump this fixes.
          expect(resizesWhenRetired).toBeGreaterThan(0)
          expect(resizes).toBe(1)
        } finally {
          observer.disconnect()
        }
      } finally {
        window.removeEventListener('resize', onResize)
      }
    })
  })

  it('stays put while the pane is unchanged', async () => {
    await withAppliedMenu('model', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      // Let the initial pane injection settle before counting.
      await new Promise(resolve => setTimeout(resolve, 200))
      let resizes = 0
      const onResize = (): void => { resizes += 1 }
      window.addEventListener('resize', onResize)
      try {
        // The official list re-renders a row (a catalog push): no pane switch.
        menu.insertAdjacentHTML('beforeend', '<button role="menuitemradio" title="Late">Late</button>')
        await new Promise(resolve => setTimeout(resolve, 200))
        expect(resizes).toBe(0)
      } finally {
        window.removeEventListener('resize', onResize)
      }
    })
  })

  it('mounts a foreign root synchronously when asked (the input cannot lag a frame)', async () => {
    const { mountReact, unmountReact } = await import('../src/client/injection/mount.js')
    const { createElement } = await import('react')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountReact(host, createElement('input', { className: 'sync-probe' }), { sync: true })
    try {
      expect(host.querySelector('input.sync-probe')).not.toBeNull()
    } finally {
      unmountReact(mount)
    }
  })
})
