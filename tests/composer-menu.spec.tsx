/**
 * Composer model-search integration tests: the plugin is driven through its
 * real entry point (apply) against a menu fixture that reproduces the official
 * ModelSelect structure per pane — root cells (menuitem), the model pane
 * (section[role="group"] + menuitemradio) and the effort pane (menuitemradio
 * WITHOUT any group section).
 *
 * Timing note: the plugin mounts its React roots from a MutationObserver
 * microtask, so the wrapper element shows up one React commit BEFORE the input
 * inside it. Every helper therefore waits for the element it is about to use,
 * never for an ancestor.
 */

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { directoryFixture, fakeApi, JOIN_FIXTURE, makeCtx, makeJoin, waitFor } from './support/composer-fixture.js'

/** The `apply()` context shape, mirroring tests/client.spec.tsx. */
type Ctx = Parameters<typeof import('../src/client/index.js').apply>[0]

/** Build the composer card + the given official pane, and return the menu. */
function buildMenu(pane: 'root' | 'model' | 'effort'): HTMLElement {
  document.body.insertAdjacentHTML('beforeend', `
    <div data-composer-card>
      <button aria-haspopup="menu" aria-controls="seat-menu">DeepSeek V4 · High</button>
    </div>
  `)
  const card = document.querySelector('[data-composer-card]')!
  card.insertAdjacentHTML('beforeend', `<div id="seat-menu" role="menu"></div>`)
  const menu = card.querySelector<HTMLElement>('#seat-menu')!
  if (pane === 'root') {
    menu.insertAdjacentHTML('beforeend', `
      <button role="menuitem">Model<span>DeepSeek V4</span></button>
      <button role="menuitem">Effort<span>High</span></button>
    `)
  }
  if (pane === 'model') {
    menu.insertAdjacentHTML('beforeend', `
      <div class="Uc5hea_groups scrollable">
        <section role="group" aria-labelledby="g-ds">
          <div id="g-ds">DeepSeek</div>
          <button role="menuitemradio" aria-checked="true" title="DeepSeek V4.1 Flash"><span>DeepSeek V4.1 Flash</span></button>
          <button role="menuitemradio" aria-checked="false" title="DeepSeek R1 Pro"><span>DeepSeek R1 Pro</span></button>
        </section>
        <section role="group" aria-labelledby="g-oa">
          <div id="g-oa">OpenAI</div>
          <button role="menuitemradio" aria-checked="false" title="GPT-4o"><span>GPT-4o</span></button>
        </section>
      </div>
    `)
  }
  if (pane === 'effort') {
    menu.insertAdjacentHTML('beforeend', `
      <button role="menuitemradio" aria-checked="false" title="High"><span>High</span></button>
      <button role="menuitemradio" aria-checked="false" title="Low"><span>Low</span></button>
    `)
  }
  return menu
}

/** Apply the plugin against a fresh fixture and tear everything down after. */
async function withAppliedMenu(
  pane: 'root' | 'model' | 'effort',
  body: (menu: HTMLElement, handlers: { calls: () => number; dispose: () => void }) => Promise<void>,
): Promise<void> {
  const { apply } = await import('../src/client/index.js')
  const api = fakeApi(() => Promise.resolve(makeJoin(structuredClone(JOIN_FIXTURE))))
  const h = makeCtx(api, {
    services: {
      sessions: { list: { getSnapshot: () => ({ current: 's1' }) } },
      modelDirectories: { directoryFor: () => directoryFixture() },
    },
  })
  // Probes standing in for the official bubble-phase handler: React 18
  // delegates to the portaled container, so both the menu and the body are
  // watched. Neither may see a key the plugin consumed.
  let calls = 0
  const probe = (): void => { calls += 1 }
  try {
    const menu = buildMenu(pane)
    menu.addEventListener('keydown', probe)
    document.body.addEventListener('keydown', probe)
    apply(h.ctx as unknown as Ctx)
    await body(menu, { calls: () => calls, dispose: () => { h.disposeAll() } })
  } finally {
    document.body.removeEventListener('keydown', probe)
    h.disposeAll()
    document.body.innerHTML = ''
  }
}

/** All official option buttons of the fixture, in document order. */
function optionsOf(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('section[role="group"] button[role="menuitemradio"]'))
}

/** The rows the filter currently leaves visible. */
function visibleOf(menu: HTMLElement): HTMLButtonElement[] {
  return optionsOf(menu).filter(option => option.style.display !== 'none')
}

/**
 * React-friendly value setter: a controlled input only sees a change when the
 * native setter is used AND an `input` event is dispatched.
 */
function setReactInputValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Wait for the rendered search input, focus it and type a query. */
async function typeQuery(menu: HTMLElement, query: string): Promise<HTMLInputElement> {
  await waitFor(() => menu.querySelector('input.bre-search-input') !== null)
  const input = menu.querySelector<HTMLInputElement>('input.bre-search-input')!
  input.focus()
  setReactInputValue(input, query)
  await new Promise(resolve => setTimeout(resolve, 0))
  return input
}

/** Dispatch a cancelable, bubbling arrow key. */
function pressArrow(target: Element, key: 'ArrowDown' | 'ArrowUp'): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('search mount predicate', () => {
  it('mounts the search box in the model pane and not in the effort pane', async () => {
    for (const pane of ['model', 'effort'] as const) {
      await withAppliedMenu(pane, async (menu) => {
        if (pane === 'model') {
          await waitFor(() => menu.querySelector('[data-bre-search="1"]') !== null)
        } else {
          // Give the debounced scan a chance to (wrongly) mount it, then assert.
          await new Promise(resolve => setTimeout(resolve, 300))
          expect(menu.querySelector('[data-bre-search="1"]')).toBeNull()
        }
      })
    }
  })

  it('does not mount the search box in the root pane', async () => {
    await withAppliedMenu('root', async (menu) => {
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(menu.querySelector('[data-bre-search="1"]')).toBeNull()
    })
  })
})

describe('official sizing is never touched', () => {
  it('adds no sizing class or inline style to the official menu', async () => {
    await withAppliedMenu('model', async (menu) => {
      await waitFor(() => menu.querySelector('[data-bre-search="1"]') !== null)
      expect(menu.classList.contains('bre-model-menu-searching')).toBe(false)
      expect(menu.getAttribute('style')).toBeNull()
    })
  })

  it('ships no stylesheet rule that resizes or rescrolls the official menu', async () => {
    const { STYLES } = await import('../src/client/styles.js')
    expect(STYLES).not.toContain('bre-model-menu-searching')
    expect(STYLES).not.toContain('[data-bre-search]')
  })
})

describe('empty state, clear button and aria', () => {
  it('labels the input, shows the empty state, and restores every inline display', async () => {
    await withAppliedMenu('model', async (menu) => {
      const input = await typeQuery(menu, 'zzz-nothing')
      expect(input.getAttribute('aria-label')).not.toBeNull()

      const box = menu.querySelector('[data-bre-search="1"]')!
      const empty = box.querySelector('.bre-search-empty')
      expect(empty).not.toBeNull()
      expect(empty!.textContent).toBe('No matching models')
      expect(empty!.getAttribute('role')).toBe('status')

      // Clearing the query drops the empty state and restores every row.
      setReactInputValue(input, '')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(box.querySelector('.bre-search-empty')).toBeNull()
      for (const row of [...optionsOf(menu), ...Array.from(menu.querySelectorAll<HTMLElement>('section[role="group"]'))]) {
        expect(row.style.display).toBe('')
      }

      // The clear button does the same and keeps focus on the input.
      setReactInputValue(input, 'zzz-nothing')
      await new Promise(resolve => setTimeout(resolve, 0))
      const clear = box.querySelector<HTMLButtonElement>('.bre-search-clear')!
      expect(clear).not.toBeNull()
      clear.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(input.value).toBe('')
      expect(box.querySelector('.bre-search-empty')).toBeNull()
      expect(document.activeElement).toBe(input)
    })
  })
})

describe('lifecycle and coexistence', () => {
  it('keeps the slider replica as the menu first child, and restores the list on dispose', async () => {
    await withAppliedMenu('model', async (menu, handlers) => {
      await waitFor(() => menu.querySelector('[data-bre-slider="1"]') !== null)
      await waitFor(() => menu.querySelector('[data-bre-search="1"]') !== null)

      const slider = menu.querySelector<HTMLElement>('[data-bre-slider="1"]')!
      const search = menu.querySelector<HTMLElement>('[data-bre-search="1"]')!
      const container = menu.querySelector<HTMLElement>('section[role="group"]')!.parentElement!
      const order = Array.from(menu.children)
      expect(order.indexOf(slider)).toBe(0)
      expect(order.indexOf(search)).toBeLessThan(order.indexOf(container))

      const input = await typeQuery(menu, 'gpt')
      expect(menu.querySelector<HTMLElement>('button[title="GPT-4o"]')!.style.display).toBe('')
      expect(menu.querySelector<HTMLElement>('button[title="DeepSeek V4.1 Flash"]')!.style.display).toBe('none')
      expect(input.value).toBe('gpt')

      // Plugin disable / HMR: no row may stay hidden once the fiber is gone.
      handlers.dispose()
      await new Promise(resolve => setTimeout(resolve, 0))
      for (const row of [...optionsOf(menu), ...Array.from(menu.querySelectorAll<HTMLElement>('section[role="group"]'))]) {
        expect(row.style.display).toBe('')
      }
    })
  })

  it('leaves selection semantics alone: a filtered click still reaches the official handler', async () => {
    await withAppliedMenu('model', async (menu) => {
      let clicked: string | null = null
      menu.addEventListener('click', (event) => {
        const target = event.target
        if (target instanceof HTMLElement) clicked = target.closest('button')?.getAttribute('title') ?? null
      })

      await typeQuery(menu, 'gpt')
      menu.querySelector<HTMLButtonElement>('button[title="GPT-4o"]')!.click()
      expect(clicked).toBe('GPT-4o')
    })
  })
})

describe('arrow keys under an active filter', () => {
  it('moves focus between visible rows only, and stops the official handler', async () => {
    await withAppliedMenu('model', async (menu, handlers) => {
      const input = await typeQuery(menu, 'deepseek')
      // "deepseek" keeps both DeepSeek rows and drops the OpenAI group.
      expect(visibleOf(menu)).toHaveLength(2)
      expect(menu.querySelector<HTMLElement>('button[title="GPT-4o"]')!.style.display).toBe('none')

      const options = optionsOf(menu)
      options[0].focus()
      expect(document.activeElement).toBe(options[0])

      const before = handlers.calls()
      pressArrow(options[0], 'ArrowDown')
      expect(document.activeElement).toBe(options[1])
      expect(handlers.calls()).toBe(before)

      // Cycling wraps back to the first VISIBLE row, never onto the hidden one.
      pressArrow(options[1], 'ArrowDown')
      expect(document.activeElement).toBe(options[0])
      expect(handlers.calls()).toBe(before)

      pressArrow(options[0], 'ArrowUp')
      expect(document.activeElement).toBe(options[1])
      expect(handlers.calls()).toBe(before)

      // Clearing the query hands the arrows back to the official handler.
      input.focus()
      setReactInputValue(input, '')
      await new Promise(resolve => setTimeout(resolve, 0))
      const cleared = handlers.calls()
      pressArrow(options[0], 'ArrowDown')
      expect(handlers.calls()).toBeGreaterThan(cleared)
    })
  })

  it('sends ArrowDown from the input to the FIRST visible row and stops the official handler', async () => {
    await withAppliedMenu('model', async (menu, handlers) => {
      const input = await typeQuery(menu, 'deepseek')
      const first = visibleOf(menu)[0]

      input.focus()
      const before = handlers.calls()
      pressArrow(input, 'ArrowDown')
      expect(document.activeElement).toBe(first)
      expect(handlers.calls()).toBe(before)
    })
  })
})

describe('official card re-place after injection', () => {
  /** The drilled-in model pane markup, as the official drill-in renders it. */
  const MODEL_PANE_HTML = `
    <div class="Uc5hea_groups scrollable">
      <section role="group" aria-labelledby="g-ds">
        <div id="g-ds">DeepSeek</div>
        <button role="menuitemradio" aria-checked="true" title="DeepSeek V4.1 Flash"><span>DeepSeek V4.1 Flash</span></button>
      </section>
    </div>
  `

  it('re-places the official card once when the model pane is injected', async () => {
    await withAppliedMenu('root', async (menu) => {
      let resizes = 0
      const onResize = (): void => { resizes += 1 }
      window.addEventListener('resize', onResize)
      try {
        menu.insertAdjacentHTML('beforeend', MODEL_PANE_HTML)
        await waitFor(() => resizes > 0)
        expect(resizes).toBe(1)
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

  it('re-places the card in the SAME turn as the injection (no frame in between)', async () => {
    await withAppliedMenu('root', async (menu) => {
      let resizes = 0
      const onResize = (): void => { resizes += 1 }
      window.addEventListener('resize', onResize)
      let resizesWhenInjected: number | null = null
      const observer = new MutationObserver(() => {
        if (resizesWhenInjected !== null) return
        if (menu.querySelector('[data-bre-search="1"]') !== null) resizesWhenInjected = resizes
      })
      observer.observe(menu, { childList: true, subtree: true })
      try {
        menu.insertAdjacentHTML('beforeend', MODEL_PANE_HTML)
        await waitFor(() => resizesWhenInjected !== null)
        // The re-place must have happened by the time the injected box exists:
        // one frame later is exactly the visible jump we are fixing.
        expect(resizesWhenInjected).toBeGreaterThan(0)
      } finally {
        observer.disconnect()
        window.removeEventListener('resize', onResize)
      }
    })
  })

  it('stays put while the user filters: no re-place per keystroke', async () => {
    await withAppliedMenu('model', async (menu) => {
      await waitFor(() => menu.querySelector('input.bre-search-input') !== null)
      let resizes = 0
      const onResize = (): void => { resizes += 1 }
      // Attach after the initial pane injection has fired, then filter.
      window.addEventListener('resize', onResize)
      try {
        await new Promise(resolve => setTimeout(resolve, 150))
        const settled = resizes
        await typeQuery(menu, 'gpt')
        await new Promise(resolve => setTimeout(resolve, 150))
        expect(resizes).toBe(settled)
      } finally {
        window.removeEventListener('resize', onResize)
      }
    })
  })
})
