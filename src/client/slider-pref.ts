/**
 * The reasoning-effort slider preference: a session-scoped localStorage-backed
 * enable flag, deliberately NOT settings.yaml (it is a UI preference, like the
 * upstream plugin's toggle it replaces). Defaults to enabled, but the initial
 * read migrates the UPSTREAM plugin's keys (dsh-reasoning-effort.enabled / the
 * @dsh-external legacy one) so a user who had switched the upstream slider off
 * does not suddenly get it back.
 *
 * @module dsh-better-reasoning-effort/client/slider-pref
 */

/** localStorage key (own namespace; the upstream plugin's keys stay untouched). */
export const SLIDER_PREF_KEY = 'dsh-better-reasoning-effort.slider.enabled'

/** Upstream plugin keys, consulted as a one-time migration fallback. */
const UPSTREAM_KEYS = ['dsh-reasoning-effort.enabled', '@dsh-external/dsh-reasoning-effort.enabled']

let enabled = read()

function read(): boolean {
  try {
    const own = window.localStorage.getItem(SLIDER_PREF_KEY)
    const migrated = own === null
      ? UPSTREAM_KEYS.map(key => window.localStorage.getItem(key)).find(value => value !== null)
      : null
    return (own ?? migrated ?? null) !== 'false'
  } catch {
    return true
  }
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** Snapshot the current preference. */
export function sliderEnabled(): boolean {
  return enabled
}

/** Save the preference (persisted immediately; a failed write keeps the session value). */
export function setSliderEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  try {
    window.localStorage.setItem(SLIDER_PREF_KEY, String(next))
  } catch {
    // The current page still follows the choice when storage is unavailable.
  }
  notify()
}

/** Apply a value incoming from another tab (no persist: the writer already stored it). */
export function syncSliderEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  notify()
}

/** Subscribe to preference changes; returns the disposer. */
export function subscribeSliderEnabled(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
