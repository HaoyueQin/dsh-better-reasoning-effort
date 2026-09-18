/**
 * Per-session model directory resolution and the effort-memory wiretap ledger.
 *
 * Deliberately menu-INDEPENDENT: the directory is a per-session instance, and a
 * brand-new session's durable projection lands without going through `select`,
 * so the watcher is the only thing that can re-apply the remembered level to it
 * — it must be in place from the session's birth, not from the first time the
 * user opens the model menu (issue #4: every new session otherwise read as
 * Default until a manual pick). The caller therefore drives `ensure()` on every
 * mutation and scan; the per-session cache makes the hot path one snapshot read.
 *
 * @module dsh-better-reasoning-effort/client/injection/session-directory
 */

import { wireEffortMemory } from '../effort-memory.js'
import type { ModelDirectoryLike } from '../types.js'

// ---- Host faces (structural; both kernels expose the same shape, see
// ---- client/types.ts). ----

/**
 * The `sessions` service face this needs: the current session id.
 *
 * Through 0.1.6-alpha.1 the catalog snapshot carried the selection as
 * `current`; 0.1.6-alpha.2 dropped it (navigation moved to the view owner) and
 * reports rows as `byId`, each with its `retainedBy` source counts.
 */
interface SessionsLike {
  list?: {
    getSnapshot(): {
      current?: string
      byId?: Record<string, { id?: string; retainedBy?: Record<string, number> } | undefined>
    }
  }
}

/**
 * The `ui-session` service face (0.1.6-alpha.2+): its scope adapter exposes the
 * main-view binding, whose `key` is the current session id.
 */
interface UiSessionLike {
  adapter?: { current?: { getSnapshot(): { key?: string } } }
}

/** The `modelDirectories` service face this needs. */
interface ModelDirectoriesLike {
  directoryFor(sessionId: string): ModelDirectoryLike
}

/**
 * Resolve the current session id across kernel lines:
 *   1. the list snapshot's `current` (0.1.6-alpha.1 and earlier);
 *   2. the ui-session main binding (0.1.6-alpha.2's authoritative source);
 *   3. the first main-view-retained catalog row — the same preference
 *      ui-session itself applies, used when that service is absent.
 * A non-empty string is required at every step: an empty id would resolve no
 * session scope and only throw inside the resolver.
 * @param sessions - the sessions service face, when mounted.
 * @param uiSession - the ui-session service face, when mounted.
 * @returns the current session id, or undefined in the boot window.
 */
function currentSessionId(
  sessions: SessionsLike | undefined,
  uiSession: UiSessionLike | undefined,
): string | undefined {
  const snapshot = sessions?.list?.getSnapshot()
  const direct = snapshot?.current
  if (typeof direct === 'string' && direct.length > 0) return direct
  const bound = uiSession?.adapter?.current?.getSnapshot?.()?.key
  if (typeof bound === 'string' && bound.length > 0) return bound
  for (const [key, row] of Object.entries(snapshot?.byId ?? {})) {
    if (row === undefined || (row.retainedBy?.['mainView'] ?? 0) <= 0) continue
    return typeof row.id === 'string' && row.id.length > 0 ? row.id : key
  }
  return undefined
}

/** The context seats this probes, lazily (services mount after boot). */
interface SliderContext {
  get?(name: string): unknown
}

/** What the tracker needs from its host. */
export interface SessionDirectoryDeps {
  /** The client root context, probed lazily for its service seats. */
  ctx: unknown
  /** The configured-pick reader layering the effort chain (issue #4). */
  configuredEffort: (provider: string, model: string) => Promise<string | undefined>
}

/** The tracker's face. */
export interface SessionDirectoryTracker {
  /** Resolve (and wire) the current session's directory; undefined in the boot window. */
  ensure: () => ModelDirectoryLike | undefined
  /** Restore every wrapped directory's original select; the fiber is going away. */
  dispose: () => void
}

/**
 * Build the session-directory tracker.
 * @param deps - the client context and the configured-pick reader.
 * @returns the tracker's {@link SessionDirectoryTracker} face.
 */
export function createSessionDirectoryTracker(deps: SessionDirectoryDeps): SessionDirectoryTracker {
  let current: { sessionId: string; directory: ModelDirectoryLike } | undefined
  // One effort-memory wiretap per directory instance, with each original
  // `select` kept for the fiber disposer to restore. Entries record their
  // session id so the sweep below can release the wiretaps of directories whose
  // session scope is gone (a deleted session's directory must not stay
  // referenced and wrapped until fiber dispose).
  interface WiredDirectory {
    sessionId: string
    restore: () => void
  }
  const wiredDirectories = new Map<ModelDirectoryLike, WiredDirectory>()

  /**
   * Release the wiretaps whose session scope is gone. The host resolver
   * deletes a directory's entry when the session scope tears down, and its
   * `directoryFor` then refuses that id (scope and binding are both gone --
   * not the transient unmounted window, which happens before a wiretap can
   * exist): re-resolving that id and comparing identities tells a dead
   * wiretap from one whose session is merely not current. Runs on EVERY
   * directory resolution, cache hits included -- the sweep must not depend
   * on the current session changing.
   */
  const sweepDeadWiretaps = (directories: ModelDirectoriesLike, liveDirectory: ModelDirectoryLike): void => {
    for (const [wired, entry] of wiredDirectories) {
      if (wired === liveDirectory) continue
      let alive: boolean
      try {
        alive = directories.directoryFor(entry.sessionId) === wired
      } catch {
        alive = false
      }
      if (!alive) {
        entry.restore()
        wiredDirectories.delete(wired)
      }
    }
  }

  const ensure = (): ModelDirectoryLike | undefined => {
    const host = deps.ctx as SliderContext
    const sessions = host.get?.('sessions') as SessionsLike | undefined
    const uiSession = host.get?.('uiSession') as UiSessionLike | undefined
    const directories = host.get?.('modelDirectories') as ModelDirectoriesLike | undefined
    const sessionId = currentSessionId(sessions, uiSession)
    if (sessionId === undefined || directories === undefined) return undefined
    try {
      // Resolve FIRST, then compare identities: a session scope can be torn
      // down and re-resolved under the same id, and the cached instance would
      // be a disposed directory serving a frozen snapshot forever.
      const directory = directories.directoryFor(sessionId)
      sweepDeadWiretaps(directories, directory)
      if (current !== undefined && current.sessionId === sessionId
        && current.directory === directory) {
        return directory
      }
      // The effort-memory wiretap rides the shared directory (wrapping its
      // select AND watching for level-less restored projections), so a model
      // switch and a session restore both carry the remembered level.
      // Idempotent per instance. The configured-pick read rides along so the
      // chain's second layer comes from the settings document.
      if (!wiredDirectories.has(directory)) {
        wiredDirectories.set(directory, {
          sessionId,
          restore: wireEffortMemory(directory, { configuredEffort: deps.configuredEffort }),
        })
      }
      current = { sessionId, directory }
      return directory
    } catch {
      // Unknown session (a scope not mounted yet): transient — retry next scan.
      current = undefined
      return undefined
    }
  }

  const dispose = (): void => {
    for (const [, entry] of wiredDirectories) entry.restore()
    wiredDirectories.clear()
  }

  return { ensure, dispose }
}
