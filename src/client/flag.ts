/**
 * A minimal boolean flag store (getSnapshot/subscribe/set) used to publish the
 * DOM-injector liveness to the fallback section. Kept dependency-free so the
 * browser half never imports a harness store abstraction it does not need.
 *
 * @module dsh-better-reasoning-effort/flag
 */

export interface FlagStore {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
  set(value: boolean): void
}

export function createFlagStore(initial: boolean): FlagStore {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}
