/**
 * The fetch-layer installer for provider `user-agent` overrides (issue #12,
 * MVP-2). The decision of WHAT to override lives in
 * `headers-core.ts`; this module owns the global seam.
 *
 * Shape of the seam: one process-wide wrapper owns `globalThis.fetch`, and
 * every activation is an ENTRY inside it. That is what makes the plugin safe
 * next to itself (an HMR remount, a second composer, two plugin instances) and
 * what makes unloading exact: an entry leaves the registry and the wrapper is
 * restored only once the last entry is gone — never a blind
 * `globalThis.fetch = original` that would clobber a wrapper installed after
 * this one, and never a wrapper left behind holding the process's fetch.
 *
 * The wrapper is deliberately narrow: a request whose URL is not in the index
 * passes through with its ORIGINAL arguments (same object identity), so
 * unconfigured traffic pays exactly one URL classification and one index
 * lookup — no allocation beyond that, and no way for a bug in the merge path
 * to alter a request that never matched.
 *
 * Why fetch rather than the pi-ai `transformHeaders` option, which would be
 * narrower: reaching that option means holding the adapter's private `models`
 * collection, and every sanctioned seam (`llm/stream` waterfall,
 * `registerAdapter`) stops at the stream, above the wire. Fetch is the only
 * public surface that sees the merged headers. Both were probed against the
 * real runtime — see `.tmp-rel/headers-probe/`.
 *
 * @module dsh-better-reasoning-effort/headers-fetch
 */

import { emptyIndex, originOf, requestUrlOf, type UserAgentIndex } from './headers-core.js'

/** Registry key on `globalThis`, so a second plugin load shares the one wrapper. */
const REGISTRY = Symbol.for('dsh-better-reasoning-effort.fetch-overrides')

/** One activation's contribution to the process-wide wrapper. */
interface Entry {
  /**
   * Reads the current index. A source rather than a value because the settings
   * document is live: a route added, edited, or removed on the Models page must
   * reach the next request without a plugin reload.
   */
  index: () => UserAgentIndex
}

/** The process-wide wrapper state. */
interface Registry {
  base: typeof globalThis.fetch
  wrapper: typeof globalThis.fetch
  entries: Map<symbol, Entry>
}

function registryOf(): Registry | undefined {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  return holder[REGISTRY]
}

/** Whether one request's URL is aimed at an origin this index overrides. */
function overrideFor(index: UserAgentIndex, url: string): string | undefined {
  const origin = originOf(url)
  if (origin === undefined) return undefined
  return index.byOrigin.get(origin)?.userAgent
}

/**
 * The caller's request headers as a mutable copy, seeded the way Fetch itself
 * resolves them: an explicit `init.headers` replaces a `Request`'s own headers,
 * and the `Request`'s are inherited only when the init names none. Seeding from
 * the wrong one would either drop the caller's headers or resurrect the ones
 * the caller replaced.
 */
function seedHeaders(input: unknown, init: RequestInit | undefined): Headers {
  if (init?.headers !== undefined && init.headers !== null) return new Headers(init.headers as HeadersInit)
  if (typeof Request !== 'undefined' && input instanceof Request) return new Headers(input.headers)
  return new Headers()
}

/** The wrapper: inject the indexed `user-agent`, delegate everything else. */
function makeWrapper(base: typeof globalThis.fetch, entries: Map<symbol, Entry>): typeof globalThis.fetch {
  return function fetchWithProviderHeaders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrlOf(input)
    if (url === undefined) return base(input, init)
    let userAgent: string | undefined
    for (const entry of entries.values()) {
      userAgent = overrideFor(entry.index(), url)
      if (userAgent !== undefined) break
    }
    if (userAgent === undefined) return base(input, init)
    const headers = seedHeaders(input, init)
    headers.set('user-agent', userAgent)
    return base(input, { ...init, headers })
  }
}

/** Handle one activation keeps; `dispose` is idempotent. */
export interface HeaderOverlayHandle {
  /** Remove this activation's entry, restoring the original fetch when it was the last. */
  dispose(): void
}

/** Handle for tests and the caller to swap the index a live activation reads. */
export interface HeaderOverlay extends HeaderOverlayHandle {
  /** Whether this activation's entry is still installed. */
  readonly active: boolean
}

/** A mutable index source an activation reads on every request. */
export interface OverlaySource {
  current: UserAgentIndex
}

/**
 * Install (or join) the process-wide header wrapper.
 * @param source - the live index this activation contributes.
 * @returns a handle whose `dispose` removes exactly this activation.
 */
export function installHeaderOverlay(source: OverlaySource): HeaderOverlay {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  let registry = holder[REGISTRY]
  const token = Symbol('bre-header-overlay')
  if (registry === undefined) {
    const base = globalThis.fetch
    const entries = new Map<symbol, Entry>()
    const wrapper = makeWrapper(base, entries)
    registry = { base, wrapper, entries }
    holder[REGISTRY] = registry
    globalThis.fetch = wrapper
  }
  registry.entries.set(token, { index: () => source.current })
  const owned = registry
  return {
    get active(): boolean {
      return owned.entries.has(token)
    },
    dispose(): void {
      owned.entries.delete(token)
      if (owned.entries.size > 0) return
      // Last one out restores the ORIGINAL function, and only when this
      // wrapper still holds the global: a later installer's wrapper must not be
      // clobbered by our teardown.
      if (globalThis.fetch === owned.wrapper) globalThis.fetch = owned.base
      if (holder[REGISTRY] === owned) delete holder[REGISTRY]
    },
  }
}

/** Whether this plugin's wrapper currently owns the global fetch (diagnostics). */
export function headerOverlayInstalled(): boolean {
  const registry = registryOf()
  return registry !== undefined && globalThis.fetch === registry.wrapper
}

/** The empty index, re-exported so callers building one need a single import. */
export { emptyIndex }
