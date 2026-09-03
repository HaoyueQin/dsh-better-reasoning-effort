/**
 * The reasoning-effort slider contributed to the OFFICIAL composer model
 * menu. The official seat keeps its own trigger — the "model · effort" display
 * at the composer's bottom-right stays untouched — and this slider is mounted
 * by the DOM injector inside the seat's open menu (the popover is the part the
 * plugin is allowed to change).
 *
 * Ported from HanaAyane's dsh-reasoning-effort EffortSlider (MIT) with ONE
 * deliberate difference: the chibi-runner "big fish" knob is dropped, so the
 * thumb is always the white circle. Everything else — the gradient pill
 * track, the radiation canvas effect, the flare, the drag/keyboard contract,
 * the optimistic commit with rollback — is upstream's, values included. See
 * README.md's Acknowledgements for the upstream credit.
 *
 * The control follows DSH's own session model-selection contract: the shared
 * per-session directory supplies the current route and its adapter-owned
 * effort metadata, and selecting a level submits the complete selection the
 * same way the official list rows do, so both surfaces stay in sync.
 *
 * @module dsh-better-reasoning-effort/client/ComposerSlider
 */
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type {
  DirectoryCurrentLike,
  DirectoryGroupLike,
  EffortLevelLike,
  ModelDirectoryLike,
  ModelDirectoryStateLike,
} from './types.js'

/** Whether the model exposes at least two effort levels (a slider is meaningful only then). */
export function sliderLevels(state: ModelDirectoryStateLike): readonly EffortLevelLike[] {
  if (state.current === null) return []
  const group = state.groups.find(candidate => candidate.id === state.current?.provider)
  const model = group?.models.find(candidate => candidate.id === state.current?.model)
  const efforts = model?.reasoning?.efforts
  return efforts !== undefined && efforts.length >= 2 ? efforts : []
}

/** The current model of a directory snapshot. */
export function currentModelOf(state: ModelDirectoryStateLike): DirectoryCurrentLike | null {
  return state.current
}

/**
 * Level index the slider should rest at: the session's current effort when
 * the model still offers it, else the adapter default, else the middle level.
 */
export function effectiveEffortIndex(
  levels: readonly EffortLevelLike[],
  state: ModelDirectoryStateLike,
): number {
  const model = currentModelOf(state)
  const current = levels.findIndex(level => level.id === model?.reasoningEffort)
  if (current >= 0) return current
  const group = state.groups.find(candidate => candidate.id === model?.provider)
  const fallback = group?.models.find(candidate => candidate.id === model?.model)
    ?.reasoning?.defaultEffort
  const at = fallback === undefined ? -1 : levels.findIndex(level => level.id === fallback)
  if (at >= 0) return at
  return Math.floor((levels.length - 1) / 2)
}

/** Props of {@link ComposerSlider}. */
export interface ComposerSliderProps {
  /** The session's shared model directory (load + select ride the official seam). */
  directory: ModelDirectoryLike
  /** Localized copy (the plugin's bound translator). */
  t: (key: string, params?: Record<string, string | number>) => string
  /** Open the official model list (upstream's row function); injected by the mount. */
  pickModel?: () => void
}

interface RadiationState {
  progress: number
  dragging: boolean
}

/**
 * The left-clipped radiation effect drawn behind the track's filled run.
 * Verbatim from upstream (the knob-side glow, the wave columns, the
 * particles) — the knob itself stays the white circle.
 */
function drawRadiation(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: RadiationState,
): void {
  const origin = state.progress * width
  const isDark = document.body.hasAttribute('data-ds-dark-theme')
  const cell = 4
  const speed = state.dragging ? 2.8 : 1

  context.clearRect(0, 0, width, height)
  if (origin <= 0) return

  context.save()
  context.beginPath()
  context.rect(0, 0, origin, height)
  context.clip()

  for (let x = 0; x < origin; x += cell) {
    const delta = x + cell * 0.5 - origin
    const distance = Math.abs(delta)
    const phaseA = distance / 10 - time * 0.0074 * speed
    const phaseB = distance / 23 - time * 0.0041 * speed + 1.7
    const phaseC = distance / 40 - time * 0.0022 * speed + 3.4
    const sinA = Math.max(0, Math.sin(phaseA))
    const sinB = Math.max(0, Math.sin(phaseB))
    const sinC = Math.max(0, Math.sin(phaseC))
    const waveA = Math.pow(sinA, 2.6)
    const waveB = Math.pow(sinB, 3.2)
    const waveC = Math.pow(sinC, 4)
    const crest = Math.pow(sinA, 15) + Math.pow(sinB, 18) * 0.78
    const wave = Math.min(1, waveA * 0.76 + waveB * 0.58 + waveC * 0.32)
    const trail = 0.38 + 0.62 * Math.exp(-distance / Math.max(55, width * 0.72))
    const pillar = Math.pow(Math.max(0, Math.sin(x / 20 + time * 0.0016)), 3) * 0.27
    const columnEnergy = trail * (wave * 1.04 + pillar + crest * 0.32)

    if (columnEnergy > 0.012) {
      const nearness = Math.max(0, 1 - distance / Math.max(1, width * 0.78))
      const red = isDark
        ? Math.round(42 + 124 * nearness + 75 * wave)
        : Math.round(28 + 58 * nearness + 15 * wave)
      const green = isDark
        ? Math.round(56 + 58 * nearness + 44 * crest)
        : Math.round(88 + 72 * nearness + 30 * crest)
      const blue = isDark
        ? Math.round(175 + 72 * nearness + 8 * wave)
        : Math.round(182 + 62 * nearness)
      const alpha = isDark
        ? Math.min(0.88, columnEnergy * 0.72)
        : Math.min(0.62, columnEnergy * 0.54)
      context.fillStyle = 'rgba(' + String(red) + ', ' + String(green) + ', ' + String(blue) + ', ' + String(alpha) + ')'
      context.fillRect(x, 0, cell - 1, height)
    }

    for (let y = 0; y < height; y += cell) {
      const deltaY = y + cell * 0.5 - height * 0.5
      const radial = Math.hypot(delta / 38, deltaY / 11)
      const halo = Math.exp(-radial * 0.96) * 1.08
      const verticalShape = 0.58 + 0.42 * Math.cos((deltaY / height) * Math.PI)
      const grain = 0.72 + 0.28 * Math.sin(x * 0.73 + y * 1.31 + time * 0.006)
      const alpha = Math.min(0.96, (columnEnergy * 0.88 + halo + crest * 0.19) * verticalShape * grain)
      if (alpha < 0.035) continue

      const hot = Math.max(0, 1 - radial / 2.4)
      const red = isDark
        ? Math.round(54 + 148 * hot + 42 * wave + 35 * crest)
        : Math.round(25 + 72 * hot + 12 * wave)
      const green = isDark
        ? Math.round(68 + 78 * hot + 46 * crest)
        : Math.round(98 + 72 * hot + 24 * crest)
      const blue = isDark
        ? Math.round(186 + 64 * hot)
        : Math.round(194 + 56 * hot)
      context.fillStyle = 'rgba(' + String(red) + ', ' + String(green) + ', ' + String(blue) + ', ' + String(isDark ? alpha : alpha * 0.72) + ')'
      context.fillRect(x, y, cell - 1, cell - 1)
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const travel = (time * (state.dragging ? 0.16 : 0.065) * (0.78 + (i % 5) * 0.09) + i * 23) % Math.max(30, origin + 64)
    const particleX = origin - travel
    if (particleX < -24 || particleX > width + 16) continue
    const particleY = 3 + ((i * 13 + Math.sin(time * 0.003 + i) * 5) % Math.max(7, height - 6))
    const length = 4 + (i % 4) * 4 + (state.dragging ? 6 : 0)
    const alpha = 0.28 + (i % 5) * 0.1
    const streak = context.createLinearGradient(particleX, 0, particleX + length, 0)
    streak.addColorStop(0, isDark ? 'rgba(72,118,255,0)' : 'rgba(24,94,184,0)')
    streak.addColorStop(0.68, isDark ? 'rgba(112,135,255,' + String(alpha) + ')' : 'rgba(36,108,202,' + String(alpha * 0.72) + ')')
    streak.addColorStop(1, isDark ? 'rgba(236,222,255,' + String(Math.min(1, alpha + 0.26)) + ')' : 'rgba(103,175,248,' + String(Math.min(0.82, alpha + 0.18)) + ')')
    context.fillStyle = streak
    context.fillRect(particleX, particleY, length, i % 3 === 0 ? 2 : 1)
  }

  const glow = context.createRadialGradient(origin, height / 2, 0, origin, height / 2, 24)
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.86)')
  glow.addColorStop(0.14, isDark ? 'rgba(183,190,255,.54)' : 'rgba(162,210,255,.48)')
  glow.addColorStop(0.44, isDark ? 'rgba(103,74,255,.28)' : 'rgba(37,112,207,.22)')
  glow.addColorStop(1, isDark ? 'rgba(86,31,210,0)' : 'rgba(25,91,181,0)')
  context.fillStyle = glow
  context.fillRect(origin - 26, 0, 52, height)
  context.restore()
}

/**
 * Render the upstream visual slider for the current model. The draft index is
 * held locally so dragging never flickers against the store; the commit
 * travels through {@link ModelDirectoryLike.select} (optimistic, rolled back
 * on refusal).
 */
export function ComposerSlider(props: ComposerSliderProps): ReactNode {
  const { directory, t } = props
  const state = useSyncExternalStore(
    (notify: () => void) => directory.store.subscribe(notify),
    () => directory.store.getSnapshot(),
  )
  const levels = sliderLevels(state)
  const [effort, setEffort] = useState('')
  const [preview, setPreview] = useState(0)
  const [committing, setCommitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef('')
  const committingRef = useRef(false)
  const previewRef = useRef(0)
  const draggingRef = useRef(false)
  const pointerActiveRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const globalPointerMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerEndRef = useRef<((event: PointerEvent) => void) | null>(null)
  const globalPointerCancelRef = useRef<((event: PointerEvent) => void) | null>(null)
  const radiationRef = useRef<RadiationState>({ progress: 0.5, dragging: false })
  const redrawRef = useRef<(() => void) | null>(null)
  const available = state.current !== null && levels.length >= 2
  const busy = committing || state.status === 'selecting'
  const error = localError ?? state.error

  useEffect(() => {
    if (!available || committingRef.current || draggingRef.current) return
    const index = effectiveEffortIndex(levels, state)
    const next = levels[index]?.id ?? ''
    committedRef.current = next
    previewRef.current = index
    setEffort(next)
    setPreview(index)
    setLocalError(null)
  }, [available, levels, state])

  useEffect(() => {
    directory.load().catch(() => undefined)
  }, [directory])

  useEffect(() => {
    previewRef.current = preview
    radiationRef.current.progress = levels.length >= 2 ? preview / (levels.length - 1) : 0.5
    redrawRef.current?.()
  }, [preview, levels.length])

  useEffect(() => {
    radiationRef.current.dragging = dragging
    redrawRef.current?.()
  }, [dragging])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    // jsdom exposes none of these; degradation mirrors the reduced-motion
    // path (a static draw) so the component stays testable.
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined
    const reducedMotion = mq ?? { matches: false }
    let width = 1
    let height = 1
    let frame = 0

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = (time = performance.now()): void => {
      drawRadiation(context, width, height, time, radiationRef.current)
    }

    const loop = (time: number): void => {
      draw(time)
      frame = window.requestAnimationFrame(loop)
    }

    const redraw = (): void => {
      if (reducedMotion.matches) draw()
    }

    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        resize()
        draw()
      })
      resizeObserver.observe(canvas)
    }
    const themeObserver = new MutationObserver(() => draw())
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    redrawRef.current = redraw
    resize()
    draw()
    if (!reducedMotion.matches && typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(loop)
    }

    return () => {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      themeObserver.disconnect()
      redrawRef.current = null
    }
  }, [])

  const effortIndex = (levels: readonly EffortLevelLike[], id: string | undefined): number => {
    return levels.findIndex((level) => level.id === id)
  }

  const rollback = useCallback((): void => {
    const previous = committedRef.current
    previewRef.current = Math.max(0, effortIndex(levels, previous))
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    setEffort(previous)
    setPreview(Math.max(0, effortIndex(levels, previous)))
    setDragging(false)
  }, [levels])

  const commit = useCallback(async (raw: number): Promise<void> => {
    if (committingRef.current) return
    committingRef.current = true
    const previous = committedRef.current

    setDragging(false)
    setCommitting(true)
    setLocalError(null)

    // Optimistic snap from the rendered levels keeps the thumb responsive
    // while the directory round-trip revalidates against fresh data below.
    const clampIndex = (value: number, count: number): number => Math.max(0, Math.min(count - 1, Math.round(value)))
    const optimisticIndex = clampIndex(raw, levels.length)
    const optimistic = levels[optimisticIndex]?.id
    if (optimistic !== undefined) {
      previewRef.current = optimisticIndex
      setPreview(optimisticIndex)
      setEffort(optimistic)
    }

    try {
      const models = await directory.load()
      // Upstream contract: the fresh directory is the load RETURNS (current /
      // routable / groups / failures), not an ad-hoc store snapshot.
      const loaded = models as {
        current?: DirectoryCurrentLike | null
        routable?: boolean | null
        groups?: readonly DirectoryGroupLike[]
        failures?: readonly unknown[]
      }
      const current = loaded.current ?? null
      const fresh: ModelDirectoryStateLike = {
        current,
        routable: loaded.routable ?? state.routable,
        groups: loaded.groups ?? state.groups,
        failures: (loaded.failures ?? state.failures) as ModelDirectoryStateLike['failures'],
        status: 'ready',
        error: null,
      }
      const freshLevels = sliderLevels(fresh)
      const index = clampIndex(raw, freshLevels.length)
      const next = freshLevels[index]?.id
      if (next === undefined) throw new Error(t('sliderNoLevels'))

      previewRef.current = index
      setPreview(index)
      setEffort(next)

      if (current === null) throw new Error(t('sliderNoCurrent'))
      await directory.select({
        provider: current.provider,
        model: current.model,
        reasoningEffort: next,
      })

      const snapshot = directory.store.getSnapshot()
      const accepted = effortIndex(freshLevels, snapshot.current?.reasoningEffort)
      const settled = accepted >= 0 ? accepted : index
      const settledId = freshLevels[settled]?.id ?? next
      committedRef.current = settledId
      previewRef.current = settled
      setEffort(settledId)
      setPreview(settled)
    } catch (cause) {
      const restore = Math.max(0, effortIndex(levels, previous))
      committedRef.current = previous
      previewRef.current = restore
      setEffort(previous)
      setPreview(restore)
      setLocalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
  }, [directory, levels, state.groups])

  const rawFromPointer = (input: HTMLInputElement, clientX: number): number => {
    const bounds = input.getBoundingClientRect()
    if (bounds.width <= 0 || levels.length < 2) return previewRef.current
    return Math.max(
      0,
      Math.min(levels.length - 1, (clientX - bounds.left) / bounds.width * (levels.length - 1)),
    )
  }

  const showPointerPreview = (raw: number): void => {
    const clamp = (value: number, count: number): number => Math.max(0, Math.min(count - 1, Math.round(value)))
    previewRef.current = raw
    setPreview(raw)
    setEffort(levels[clamp(raw, levels.length)]?.id ?? '')
  }

  const beginDragging = (input: HTMLInputElement, pointerId: number, clientX: number): void => {
    pointerActiveRef.current = true
    activePointerIdRef.current = pointerId
    draggingRef.current = true
    setDragging(true)
    showPointerPreview(rawFromPointer(input, clientX))
    try {
      if (!input.hasPointerCapture(pointerId)) input.setPointerCapture(pointerId)
    } catch {
      // The window-level pointer listeners below remain the reliable fallback.
    }
  }

  const moveDragging = (input: HTMLInputElement, pointerId: number, clientX: number): void => {
    if (!pointerActiveRef.current || activePointerIdRef.current !== pointerId) return
    showPointerPreview(rawFromPointer(input, clientX))
  }

  const stopDragging = (input: HTMLInputElement, pointerId?: number, clientX?: number): void => {
    if (!pointerActiveRef.current) return
    if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return
    const raw = clientX === undefined ? previewRef.current : rawFromPointer(input, clientX)
    pointerActiveRef.current = false
    activePointerIdRef.current = null
    draggingRef.current = false
    if (pointerId !== undefined && input.hasPointerCapture(pointerId)) {
      input.releasePointerCapture(pointerId)
    }
    showPointerPreview(raw)
    void commit(raw)
  }

  globalPointerMoveRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) moveDragging(input, event.pointerId, event.clientX)
  }
  globalPointerEndRef.current = (event) => {
    const input = inputRef.current
    if (input !== null) stopDragging(input, event.pointerId, event.clientX)
  }
  globalPointerCancelRef.current = (event) => {
    if (activePointerIdRef.current !== event.pointerId) return
    rollback()
  }

  useEffect(() => {
    const move = (event: PointerEvent) => globalPointerMoveRef.current?.(event)
    const end = (event: PointerEvent) => globalPointerEndRef.current?.(event)
    const cancel = (event: PointerEvent) => globalPointerCancelRef.current?.(event)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    const count = levels.length
    const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, Math.round(value)))
    const current = clamp(Number(event.currentTarget.value), count - 1)
    let target: number | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      target = Math.max(0, current - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      target = Math.min(count - 1, current + 1)
    } else if (event.key === 'Home') {
      target = 0
    } else if (event.key === 'End') {
      target = count - 1
    }
    if (target === undefined) return
    // The official menu roams focus with the same keys: keep them on the
    // slider while it owns the gesture.
    event.stopPropagation()
    event.preventDefault()
    void commit(target)
  }

  // The popover body is replicated from upstream: the slider (or the no-levels
  // hint), a separator, then ONE model row (name · current effort ›) whose
  // click opens the official model list. The official menu's two root cells
  // are hidden by the mount — the slider IS the effort control, so the
  // "Effort" drill-in is gone, and the model row is this replication.
  const current = state.current
  const group = state.groups.find(candidate => candidate.id === current?.provider)
  const model = group?.models.find(candidate => candidate.id === current?.model)
  // Labels follow the upstream row contract: the model text is the display
  // name or the bare model id, and the effort text reads the STORE's settled
  // value (an in-flight drag preview stays in the slider, not in the row).
  const modelLabel = model?.name ?? (current === null ? t('triggerFallback') : current.model)
  const effortLabel = levels[effectiveEffortIndex(levels, state)]?.name ?? t('effortDefault')

  if (!available) {
    return createElement('div', { className: 'bre-slider-body' },
      createElement('div', { className: 'bre-slider-advanced' },
        createElement('span', { className: 'bre-slider-hint' }, t('sliderNoLevels')),
      ),
      createElement('div', { className: 'bre-menu-separator', 'aria-hidden': true }),
      createElement('button', {
        type: 'button',
        role: 'menuitem',
        className: 'bre-model-row',
        disabled: busy,
        onClick: () => { props.pickModel?.() },
      },
        createElement('span', { className: 'bre-model-row-name' }, modelLabel),
        createElement('span', { className: 'bre-model-row-effort' }, effortLabel),
        createElement('span', { className: 'bre-row-chevron', 'aria-hidden': true }, '›'),
      ),
      error === null
        ? null
        : createElement('div', { className: 'bre-model-error', role: 'status' }, error),
    )
  }

  const count = levels.length
  const effortName = levels[effortIndex(levels, effort)]?.name ?? effort
  const isTop = effortIndex(levels, effort) === count - 1
  const progress = preview / (count - 1) * 100
  const style = { '--bre-progress': String(progress) + '%' } as CSSProperties
  const title = error === null
    ? t('sliderEffortTitle', { name: effortName })
    : t('sliderEffortTitleError', { error })

  return createElement(
    'div',
    { className: 'bre-slider-body' },
    createElement(
      'div',
      { className: 'bre-slider-advanced' },
      createElement(
        'div',
        { className: 'bre-effort' + (dragging ? ' is-dragging' : '') + (busy ? ' is-busy' : '') + (error === null ? '' : ' is-error'), title },
        createElement(
          'div',
          { className: 'bre-effort-slider', 'data-top': isTop ? 'true' : undefined, style },
          createElement('div', { className: 'bre-effort-track', 'aria-hidden': true }),
          createElement('div', { className: 'bre-effort-fx', 'aria-hidden': true },
            createElement('canvas', { ref: canvasRef, className: 'bre-effort-canvas' }),
            createElement('span', { className: 'bre-effort-flare' }),
          ),
          createElement('input', {
            ref: inputRef,
            type: 'range',
            className: 'bre-effort-input',
            min: 0,
            max: count - 1,
            step: '0.01',
            value: preview,
            disabled: busy,
            'aria-label': t('sliderEffortAria'),
            'aria-valuetext': effortName,
            onChange: (event: { currentTarget: HTMLInputElement }) => {
              const raw = Number(event.currentTarget.value)
              showPointerPreview(raw)
            },
            onPointerDown: (event: { currentTarget: HTMLInputElement; pointerId: number; clientX: number; preventDefault: () => void }) => {
              event.preventDefault()
              event.currentTarget.focus()
              beginDragging(event.currentTarget, event.pointerId, event.clientX)
            },
            onPointerMove: (event: { currentTarget: HTMLInputElement; pointerId: number; clientX: number }) => moveDragging(event.currentTarget, event.pointerId, event.clientX),
            onPointerUp: (event: { currentTarget: HTMLInputElement; pointerId: number; clientX: number }) => stopDragging(event.currentTarget, event.pointerId, event.clientX),
            onPointerCancel: (event: { currentTarget: HTMLInputElement; pointerId: number }) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              rollback()
            },
            onBlur: (event: { currentTarget: HTMLInputElement }) => {
              stopDragging(event.currentTarget)
            },
            onKeyDown: onKeyDown,
          }),
          createElement('span', { className: 'bre-effort-knob', 'aria-hidden': true }),
        ),
        error === null
          ? null
          : createElement('span', { className: 'bre-effort-sr', role: 'status' }, error),
      ),
    ),
    createElement('div', { className: 'bre-menu-separator', 'aria-hidden': true }),
    createElement('button', {
      type: 'button',
      role: 'menuitem',
      className: 'bre-model-row',
      disabled: busy,
      onClick: () => { props.pickModel?.() },
    },
      createElement('span', { className: 'bre-model-row-name' }, modelLabel),
      createElement('span', { className: 'bre-model-row-effort' }, effortLabel),
      createElement('span', { className: 'bre-row-chevron', 'aria-hidden': true }, '›'),
    ),
    error === null
      ? null
      : createElement('div', { className: 'bre-model-error', role: 'status' }, error),
  )
}
