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
 * and display names are editable and never unique. Two delivery paths share
 * one fallback chain (the SESSION'S own sighting of a level the user picked
 * in it, else the per-model configured pick from the settings document, else
 * the last cross-session memory from localStorage, else the last
 * PROVIDER-NATIVE sighting from a replay when it names an advertised
 * level, else the VENDOR'S documented default from the knowledge base, else
 * the official no-effort behaviour):
 *   - the wrapped `select`: a model switch submitted without a level rides
 *     the remembered level in ONE atomic commit — no "Default" flash, and
 *     every surface shows the re-applied level;
 *   - the projection watcher: a RESTORED session's durable selection arrives
 *     from session history without going through `select` at all, so the
 *     watcher re-applies the chain to a level-less projection (one successful
 *     attempt per model per directory lifetime; a REFUSED attempt is refunded
 *     and retried on the next store update, up to a small ceiling — which
 *     also keeps an explicit provider-default pick from being fought).
 * Discipline both paths keep:
 *   - an EXPLICIT level (slider drag, any effort row) always wins: it is
 *     remembered for that exact model and submitted untouched — and it is
 *     recorded as a SESSION sighting, which outranks the configured pick for
 *     the rest of the session (switching away and back must not lose it);
 *   - an effort-less selection for the CURRENT model is an explicit "follow
 *     the provider default" and must pass through untouched — the session
 *     sighting dies with it;
 *   - nothing is injected while the slider preference (the seat the memory
 *     serves) is switched off.
 *
 * @module dsh-better-reasoning-effort/client/effort-memory
 */
import { sliderEnabled } from './slider-pref.js'
import { suggestEfforts } from '../knowledge.js'
import type { DirectoryCurrentLike, ModelDirectoryLike, ModelDirectoryStateLike } from './types.js'

/**
 * The wiring-provided read of the per-model configured pick (the settings
 * document's `defaultEffort` field). Async because it lives in the pi-ai
 * document, not in localStorage; the wiring owns the caching describe.
 * Absent (tests, or a wiring that does not supply it) skips the layer.
 */
export interface EffortMemoryDeps {
  configuredEffort?: (provider: string, model: string) => Promise<string | undefined>
}

/** localStorage key (same namespace discipline as the slider preference). */
const EFFORT_MEMORY_KEY = 'dsh-better-reasoning-effort.slider.efforts'

/** Marker guarding against double-wrapping one directory instance (HMR re-apply). */
const WIRED_MARKER = 'breSelectWired'

/** Provider-native effort sightings (`providerThinkingLevel` replay): "provider/model-id" → native level. */
const PROVIDER_LEVEL_KEY = 'dsh-better-reasoning-effort.slider.provider-levels'

type ProviderLevelMemory = Record<string, string>

function readProviderLevels(): ProviderLevelMemory {
  try {
    const raw = window.localStorage.getItem(PROVIDER_LEVEL_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const memory: ProviderLevelMemory = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.length > 0 && typeof value === 'string' && value.trim().length > 0) memory[key] = value
    }
    return memory
  } catch {
    return {}
  }
}

/** Record a provider-native effort sighting (e.g. from a replay envelope). */
export function noteProviderLevel(provider: string, model: string, level: string): void {
  const trimmed = level.trim()
  if (trimmed.length === 0) return
  try {
    const memory = readProviderLevels()
    memory[memoryKey(provider, model)] = trimmed
    window.localStorage.setItem(PROVIDER_LEVEL_KEY, JSON.stringify(memory))
  } catch {
  }
}

/** The last provider-native effort sighting for one model, if any. */
export function providerLevel(provider: string, model: string): string | undefined {
  return readProviderLevels()[memoryKey(provider, model)]
}

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
}/** The effort level ids one model's entry advertises in a directory snapshot. */
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
 * Resolve the level the memory chain lands on for one model of a snapshot:
 * the SESSION'S own sighting (a level the user picked in this session --
 * switching away and back must not lose it), else the per-model configured
 * pick from the settings document, else the cross-session memory, else the
 * vendor's documented default from the knowledge base — always validated
 * against the ADVERTISED ladder, and undefined when nothing legitimate lands.
 * Async only because the configured pick reads the settings document; every
 * other layer is synchronous.
 */
async function resolveFallback(
  snapshot: ModelDirectoryStateLike,
  provider: string,
  model: string,
  sessionSightings: ReadonlyMap<string, string>,
  deps: EffortMemoryDeps | undefined,
): Promise<string | undefined> {
  const supported = effortIdsOf(snapshot, provider, model)
  if (supported.length === 0) return undefined
  const key = memoryKey(provider, model)
  const sighted = sessionSightings.get(key)
  if (sighted !== undefined && supported.includes(sighted)) return sighted
  const configured = await deps?.configuredEffort?.(provider, model)
  if (configured !== undefined && supported.includes(configured)) return configured
  const memory = rememberedEffort(provider, model)
  if (memory !== undefined && supported.includes(memory)) return memory
  const native = providerLevel(provider, model)
  if (native !== undefined && supported.includes(native)) return native
  const fallback = suggestEfforts(model, {}).defaultEffort
  return fallback !== undefined && supported.includes(fallback) ? fallback : undefined
}

/**
 * Wire one directory with the effort-memory discipline: wrap its `select`
 * (model-switch path) and watch its store (projection-restore path).
 * Idempotent: an already-wired directory is left alone and the returned
 * disposer is a no-op. The disposer unsubscribes the watcher and restores
 * the original `select` (the directory instance outlives the plugin fiber
 * on disable/HMR).
 * @param directory - the shared per-session directory to wire.
 * @param deps - optional wiring face (the configured-pick read).
 * @returns the disposer restoring the original `select` and the watcher.
 */
export function wireEffortMemory(directory: ModelDirectoryLike, deps?: EffortMemoryDeps): () => void {
  const target = directory as unknown as Record<string, unknown>
  if (target[WIRED_MARKER] === true) return () => {}
  // Whether `select` was an OWN property at wire time decides the restore:
  // real directories carry it on the prototype, so the disposer removes the
  // instance shadow entirely instead of freezing a copy of today's method
  // onto the instance (which would keep shadowing a hot-swapped prototype).
  const hadOwnSelect = Object.prototype.hasOwnProperty.call(target, 'select')
  const original = directory.select
  // Levels the user picked IN THIS SESSION, per model. The directory (and
  // this closure) is a per-session instance, so the map is session-scoped by
  // construction: it outranks the configured pick for the rest of the
  // session — switching away and back must not lose the user's pick — and
  // dies with the session instead of leaking into the next one.
  const sessionSightings = new Map<string, string>()
  // One successful restore per model per directory lifetime: spent attempts
  // are never retried, which bounds the watcher (no loop on a refused write)
  // and keeps an explicit provider-default pick from being fought. A REFUSED
  // submission refunds its attempt -- a brand-new session's host may refuse
  // the first selectModel while the session is still initializing -- up to a
  // small ceiling, beyond which the model is given up on for this directory.
  // A chain MISS refunds too: the configured layer reads live settings, so a
  // later document change can answer differently.
  const attemptedRestores = new Set<string>()
  const restoreFailures = new Map<string, number>()

  /** Stop retrying one model after this many refused restores (per directory). */
  const RESTORE_RETRY_LIMIT = 3

  const wrapped = async (
    selection: Parameters<ModelDirectoryLike['select']>[0],
  ): Promise<unknown> => {
    // An explicit level is the memory's source of truth — but only an
    // ACCEPTED one: a refused selection (host validation failed) must not
    // poison the memory and re-fail every later switch.
    if (selection.reasoningEffort !== undefined) {
      const result = await original.call(directory, selection)
      sessionSightings.set(memoryKey(selection.provider, selection.model), selection.reasoningEffort)
      rememberEffort(selection.provider, selection.model, selection.reasoningEffort)
      return result
    }
    const snapshot = directory.store.getSnapshot()
    // Same model, no level: an explicit "follow the provider default" —
    // the session sighting dies with it, so this session keeps honouring
    // the user's pick for the rest of its life. The model's restore attempt
    // is spent with it: the confirmed selection re-notifies the watcher with
    // a level-less projection, and the chain must not answer it by fighting
    // the pick the user just made.
    if (!isModelSwitch(snapshot.current, selection)) {
      const key = memoryKey(selection.provider, selection.model)
      sessionSightings.delete(key)
      attemptedRestores.add(key)
      return original.call(directory, selection)
    }
    // A switch without a level: re-apply the session's sighting, the
    // configured pick, the model's own memory, or the vendor's documented
    // default from the knowledge base — never a guess. A model with no
    // advertised ladder cannot be spoken to at all.
    if (!sliderEnabled()) return original.call(directory, selection)
    const fallback = await resolveFallback(snapshot, selection.provider, selection.model, sessionSightings, deps)
    if (fallback === undefined) return original.call(directory, selection)
    return original.call(directory, { ...selection, reasoningEffort: fallback })
  }

  /** Re-apply the chain to a level-less durable projection (session restore). */
  const restoreProjection = (): void => {
    const snapshot = directory.store.getSnapshot()
    const current = snapshot.current
    if (current === null || current.reasoningEffort !== undefined) return
    // The gate comes BEFORE the attempt is spent: with the slider off the
    // plugin is absent, and absence must not burn the model's one attempt.
    if (!sliderEnabled()) return
    const key = memoryKey(current.provider, current.model)
    if (attemptedRestores.has(key)) return
    // A model with no advertised ladder cannot be spoken to at all: a
    // deterministic miss — spend the attempt so the watcher does not
    // re-resolve the same dead end on every store update.
    if (effortIdsOf(snapshot, current.provider, current.model).length === 0) {
      attemptedRestores.add(key)
      return
    }
    attemptedRestores.add(key)
    // Directly through the ORIGINAL select: the watcher's own re-apply is a
    // memory READ, not a user pick, and must not be remembered as one.
    void resolveFallback(snapshot, current.provider, current.model, sessionSightings, deps)
      .then(async (fallback) => {
        if (fallback === undefined) {
          // The chain lands nowhere for now — refund: the configured layer
          // reads live settings, so a later document change may answer.
          attemptedRestores.delete(key)
          return
        }
        // The chain took an await: re-verify against the CURRENT store
        // before speaking, so a selection that landed meanwhile stands.
        const fresh = directory.store.getSnapshot()
        const freshCurrent = fresh.current
        if (freshCurrent === null || freshCurrent.reasoningEffort !== undefined
          || memoryKey(freshCurrent.provider, freshCurrent.model) !== key) {
          attemptedRestores.delete(key)
          return
        }
        await original
          .call(directory, { provider: freshCurrent.provider, model: freshCurrent.model, reasoningEffort: fallback })
      })
      .catch(() => {
        // A refusal is transient (a session mid-initialization), not a
        // decision: refund the attempt so the next store update retries --
        // but stop at the ceiling so a persistently rejected submission
        // cannot turn the watcher into a loop.
        const failures = (restoreFailures.get(key) ?? 0) + 1
        restoreFailures.set(key, failures)
        if (failures < RESTORE_RETRY_LIMIT) attemptedRestores.delete(key)
      })
  }

  const unsubscribe = directory.store.subscribe(restoreProjection)
  // The projection may already be resident when the directory gets wired.
  restoreProjection()

  target[WIRED_MARKER] = true
  directory.select = wrapped as typeof directory.select
  return () => {
    delete target[WIRED_MARKER]
    unsubscribe()
    if (hadOwnSelect) directory.select = original
    else delete target['select']
  }
}
