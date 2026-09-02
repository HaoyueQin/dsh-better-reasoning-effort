/**
 * Effort memory: per-model reasoning-effort levels, re-applied automatically
 * when a model switch lands without one.
 *
 * The official model list submits a model switch as a selection WITHOUT an
 * effort unless the model advertises a default (`ModelSelect` builds its
 * choices from `reasoning.defaultEffort`, which hand-declared models never
 * carry) — and the host replaces the session's whole selection, so the
 * previous level is dropped and the trigger reads "Default". Wrapping the
 * shared per-session directory's `select` (the SAME instance the official
 * seat, the /model popup, and this plugin's slider all submit through) lets
 * the remembered level ride the switch in ONE atomic commit: no "Default"
 * flash, and every surface shows the re-applied level.
 *
 * The memory is keyed by "provider/model-id" — the exact fields a selection
 * carries — because the same model id under two providers names two models,
 * and display names are editable and never unique. The fallback chain for a
 * switch is: the target model's own remembered level, else the VENDOR'S
 * documented default from the knowledge base (the same convention reasonix
 * and opencode ship as a per-model `default_effort`), else the official
 * no-effort behaviour. Discipline the wrapper keeps:
 *   - an EXPLICIT level (slider drag, any effort row) always wins: it is
 *     remembered for that exact model and submitted untouched;
 *   - an effort-less selection for the CURRENT model is an explicit "follow
 *     the provider default" and must pass through untouched — only a model
 *     SWITCH without a level reads the memory;
 *   - nothing is injected while the slider preference (the seat the memory
 *     serves) is switched off.
 *
 * @module dsh-better-reasoning-effort/client/effort-memory
 */
import { sliderEnabled } from './slider-pref.js'
import { suggestEfforts } from '../knowledge.js'
import type { DirectoryCurrentLike, ModelDirectoryLike, ModelDirectoryStateLike } from './types.js'

/** localStorage key (same namespace discipline as the slider preference). */
const EFFORT_MEMORY_KEY = 'dsh-better-reasoning-effort.slider.efforts'

/** Marker guarding against double-wrapping one directory instance (HMR re-apply). */
const WIRED_MARKER = 'breSelectWired'

/** Per-model memory: "provider/model-id" → the last level explicitly picked for it. */
type EffortMemory = Record<string, string>

/** The storage key of one model: the exact fields a selection carries. */
function memoryKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Read the per-model memory, defensively: the value is plain JSON in
 * localStorage, so a malformed or hostile document degrades to "no memory"
 * instead of poisoning the wrapper.
 */
function readMemory(): EffortMemory {
  try {
    const raw = window.localStorage.getItem(EFFORT_MEMORY_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const memory: EffortMemory = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.length > 0 && typeof value === 'string' && value.trim().length > 0) memory[key] = value
    }
    return memory
  } catch {
    return {}
  }
}

function writeMemory(memory: EffortMemory): void {
  try {
    window.localStorage.setItem(EFFORT_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Unavailable storage (quota, privacy mode): this page keeps working with
    // the levels it picked; the switch fallback below does not depend on us.
  }
}

/** Record the level the user explicitly picked for one model. */
export function rememberEffort(provider: string, model: string, id: string): void {
  const memory = readMemory()
  memory[memoryKey(provider, model)] = id
  writeMemory(memory)
}

/** The level explicitly picked for one model, or undefined when none was. */
export function rememberedEffort(provider: string, model: string): string | undefined {
  return readMemory()[memoryKey(provider, model)]
}

/** The effort level ids one model's entry advertises in a directory snapshot. */
function effortIdsOf(
  state: ModelDirectoryStateLike,
  provider: string,
  model: string,
): readonly string[] {
  const group = state.groups.find(candidate => candidate.id === provider)
  const efforts = group?.models.find(candidate => candidate.id === model)?.reasoning?.efforts
  return efforts === undefined ? [] : efforts.map(level => level.id)
}

/** Whether the selection moves to a DIFFERENT model (or picks the first one). */
function isModelSwitch(
  current: DirectoryCurrentLike | null,
  selection: { provider: string; model: string },
): boolean {
  return current === null
    || current.provider !== selection.provider
    || current.model !== selection.model
}

/**
 * Wrap one directory's `select` with the effort-memory discipline. Idempotent:
 * an already-wrapped directory is left alone and the returned disposer is a
 * no-op. The disposer restores the original method (the directory instance
 * outlives the plugin fiber on disable/HMR).
 * @param directory - the shared per-session directory to wire.
 * @returns the disposer restoring the original `select`.
 */
export function wireSelect(directory: ModelDirectoryLike): () => void {
  const target = directory as unknown as Record<string, unknown>
  if (target[WIRED_MARKER] === true) return () => {}
  // Whether `select` was an OWN property at wire time decides the restore:
  // real directories carry it on the prototype, so the disposer removes the
  // instance shadow entirely instead of freezing a copy of today's method
  // onto the instance (which would keep shadowing a hot-swapped prototype).
  const hadOwnSelect = Object.prototype.hasOwnProperty.call(target, 'select')
  const original = directory.select
  const wrapped = async (
    selection: Parameters<ModelDirectoryLike['select']>[0],
  ): Promise<unknown> => {
    // An explicit level is the memory's source of truth — but only an
    // ACCEPTED one: a refused selection (host validation failed) must not
    // poison the memory and re-fail every later switch.
    if (selection.reasoningEffort !== undefined) {
      const result = await original.call(directory, selection)
      rememberEffort(selection.provider, selection.model, selection.reasoningEffort)
      return result
    }
    const snapshot = directory.store.getSnapshot()
    // Same model, no level: an explicit "follow the provider default".
    if (!isModelSwitch(snapshot.current, selection)) return original.call(directory, selection)
    // A switch without a level: re-apply the model's own memory, else the
    // vendor's documented default from the knowledge base — never a guess.
    // A model with no advertised ladder cannot be spoken to at all.
    const supported = effortIdsOf(snapshot, selection.provider, selection.model)
    if (!sliderEnabled() || supported.length === 0) return original.call(directory, selection)
    const memory = rememberedEffort(selection.provider, selection.model)
    // A memory that the target ladder no longer carries falls through to the
    // vendor default, exactly like no memory at all.
    const remembered = memory !== undefined && supported.includes(memory) ? memory : undefined
    const fallback = remembered ?? suggestEfforts(selection.model, {}).defaultEffort
    if (fallback === undefined || !supported.includes(fallback)) return original.call(directory, selection)
    return original.call(directory, { ...selection, reasoningEffort: fallback })
  }
  target[WIRED_MARKER] = true
  directory.select = wrapped as typeof directory.select
  return () => {
    delete target[WIRED_MARKER]
    if (hadOwnSelect) directory.select = original
    else delete target['select']
  }
}
