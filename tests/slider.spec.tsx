/**
 * ComposerSlider unit tests: level resolution against the directory snapshot
 * and the commit path (optimistic select via the upstream key/drag contract,
 * plus rejection rollback), without the DOM injector.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ComposerSlider, effectiveEffortIndex, sliderLevels } from '../src/client/ComposerSlider.js'
import type { ModelDirectoryLike, ModelDirectoryStateLike } from '../src/client/types.js'

/** A directory fixture with a five-level ladder around 'medium'. */
function fixture(state?: Partial<ModelDirectoryStateLike>): {
  directory: ModelDirectoryLike
  selectSpy: ReturnType<typeof vi.fn>
  update: (next: ModelDirectoryStateLike) => void
} {
  let base: ModelDirectoryStateLike = {
    current: { provider: 'aliyun', model: 'qwen-max', reasoningEffort: 'medium' },
    groups: [{
      id: 'aliyun',
      name: 'Aliyun',
      models: [{
        id: 'qwen-max',
        name: 'Qwen Max',
        reasoning: {
          defaultEffort: 'medium',
          efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
        },
      }],
    }],
    status: 'ready',
    error: null,
    ...state,
  }
  const listeners = new Set<() => void>()
  const selectSpy = vi.fn(async (selection: { provider: string; model: string; reasoningEffort?: string }) => {
    base = { ...base, current: { provider: selection.provider, model: selection.model, ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort } } }
    for (const listener of [...listeners]) listener()
  })
  return {
    directory: {
      store: {
        getSnapshot: () => base,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      load: vi.fn(async () => ({ current: base.current, routable: true, groups: base.groups, failures: [] })),
      select: selectSpy,
    },
    selectSpy,
    update: (next: ModelDirectoryStateLike) => {
      base = next
      for (const listener of [...listeners]) listener()
    },
  }
}

async function mount(directory: ModelDirectoryLike): Promise<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(createElement(ComposerSlider, { directory, t: (key: string) => key }))
  // createRoot renders are scheduled; give the initial commit a tick.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { root, container }
}

function pressKey(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('effectiveEffortIndex', () => {
  const levels = [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }]
  it('prefers the session effort, then the adapter default, then the middle', () => {
    expect(effectiveEffortIndex(levels, { current: { provider: 'a', model: 'm', reasoningEffort: 'high' }, groups: [], status: 'ready', error: null })).toBe(3)
    expect(effectiveEffortIndex(levels, { current: { provider: 'a', model: 'm' }, groups: [{ id: 'a', name: 'A', models: [{ id: 'm', reasoning: { defaultEffort: 'low', efforts: levels } }] }], status: 'ready', error: null })).toBe(1)
    expect(effectiveEffortIndex(levels, { current: { provider: 'a', model: 'm' }, groups: [{ id: 'a', name: 'A', models: [{ id: 'm' }] }], status: 'ready', error: null })).toBe(2)
  })
  it('hides the slider for models with fewer than two levels', async () => {
    const one = fixture({ current: { provider: 'aliyun', model: 'qwen-max' }, groups: [{ id: 'aliyun', name: 'Aliyun', models: [{ id: 'qwen-max', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }] }] })
    expect(sliderLevels(one.directory.store.getSnapshot())).toHaveLength(0)
    const { root, container } = await mount(one.directory)
    expect(container.querySelector('.bre-slider-hint')).not.toBeNull()
    expect(container.querySelector('input[type="range"]')).toBeNull()
    // The model row still replicates upstream (with the default effort label).
    expect(container.querySelector('.bre-model-row')).not.toBeNull()
    root.unmount()
  })
})

describe('ComposerSlider commit', () => {
  it('renders the upstream visual skeleton (track, fx canvas, flare, white knob) and rests on medium', async () => {
    const { directory } = fixture()
    const { root, container } = await mount(directory)
    expect(container.querySelector('.bre-effort-track')).not.toBeNull()
    expect(container.querySelector('canvas.bre-effort-canvas')).not.toBeNull()
    expect(container.querySelector('.bre-effort-flare')).not.toBeNull()
    const knob = container.querySelector<HTMLElement>('.bre-effort-knob')
    expect(knob).not.toBeNull()
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
    // The rest position lands in the mount-sync effect (passive effects flush
    // asynchronously); wait for it instead of racing the commit.
    await vi.waitFor(() => expect(range.value).toBe('2'))
    // The popover body replicates upstream: separator + model row after the slider.
    expect(container.querySelector('.bre-menu-separator')).not.toBeNull()
    const row = container.querySelector<HTMLButtonElement>('.bre-model-row')
    expect(row).not.toBeNull()
    expect(row?.querySelector('.bre-model-row-name')?.textContent).toBe('Qwen Max')
    expect(row?.querySelector('.bre-model-row-effort')?.textContent).toBe('Medium')
    root.unmount()
  })

  it('commits a selection through directory.select via the keyboard contract', async () => {
    const { directory, selectSpy } = fixture()
    const { root, container } = await mount(directory)
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
    // Arrow keys move one step per press: 2 (medium) → 3 (high) → 4 (max).
    pressKey(range, 'ArrowRight')
    await vi.waitFor(() => expect(selectSpy).toHaveBeenCalledWith({ provider: 'aliyun', model: 'qwen-max', reasoningEffort: 'high' }))
    pressKey(range, 'ArrowRight')
    await vi.waitFor(() => expect(selectSpy).toHaveBeenCalledWith({ provider: 'aliyun', model: 'qwen-max', reasoningEffort: 'max' }))
    root.unmount()
  })

  it('rolls back to the committed level when the select rejects', async () => {
    const { directory, selectSpy, update } = fixture()
    // Faithful to the real ModelDirectory: a refused selection surfaces on the
    // store (status/error) and rethrows — the slider rests on the committed
    // level while the store's error line shows.
    selectSpy.mockImplementationOnce(async () => {
      update({
        ...directory.store.getSnapshot(),
        status: 'error',
        error: 'refused',
      })
      throw new Error('refused')
    })
    const { root, container } = await mount(directory)
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!
    // Rest on the failure's announcement first (the optimistic snap moves the
    // thumb before the rejection settles), then check the rollback position.
    pressKey(range, 'ArrowRight')
    // Both the announcement and the rollback position inside one waitFor —
    // the thumb moves optimistically before the rejection settles.
    await vi.waitFor(() => {
      expect(container.querySelector('.bre-effort-sr')?.textContent).toContain('refused')
      expect(range.value).toBe('2')
    })
    root.unmount()
  })
})
