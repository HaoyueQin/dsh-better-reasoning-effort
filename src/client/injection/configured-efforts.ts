/**
 * The browser-side cache of the settings document's per-model `defaultEffort`
 * field (issue #4).
 *
 * The composer effort chain reads it through {@link ConfiguredEfforts.of}; a
 * pushed document update or a connection reset invalidates it and the next read
 * re-describes. A refused or empty read is deliberately NOT cached, so a
 * gateway hiccup cannot silently disable the configured layer until the next
 * invalidation.
 *
 * @module dsh-better-reasoning-effort/client/injection/configured-efforts
 */

import { DEFAULT_EFFORT_FIELD } from '../../constants.js'
import { describeNamespace, providersOf } from '../ops.js'
import type { RemoteApi } from '../types.js'

/** What the cache reads through. */
export interface ConfiguredEffortsDeps {
  /** The settings remote. */
  api: RemoteApi
}

/** The cache's face. */
export interface ConfiguredEfforts {
  /** The configured pick for one model, after the cache has settled. */
  of: (provider: string, model: string) => Promise<string | undefined>
  /** Drop the cache; the next read re-describes. */
  invalidate: () => void
}

/**
 * Build the configured-pick cache.
 * @param deps - the settings remote.
 * @returns the cache's {@link ConfiguredEfforts} face.
 */
export function createConfiguredEfforts(deps: ConfiguredEffortsDeps): ConfiguredEfforts {
  let configuredEfforts: Map<string, string> | undefined
  let configuredEffortsInflight: Promise<void> | undefined
  let configuredEffortsGeneration = 0

  const ensureConfiguredEfforts = (): Promise<void> => {
    if (configuredEfforts !== undefined) return Promise.resolve()
    const generation = configuredEffortsGeneration
    configuredEffortsInflight ??= describeNamespace(deps.api)
      .then((join) => {
        if (join.namespace === undefined) {
          // The namespace is unregistered, or the read was refused (a
          // gateway hiccup): do NOT cache the empty answer — the next chain
          // read re-describes, instead of silently disabling the configured
          // layer until the next invalidation.
          configuredEffortsInflight = undefined
          return
        }
        const map = new Map<string, string>()
        for (const [route, profile] of Object.entries(providersOf(join.namespace))) {
          const rawModels = Array.isArray(profile['models']) ? profile['models'] : []
          for (const model of rawModels) {
            if (typeof model !== 'object' || model === null || Array.isArray(model)) continue
            const id = (model as Record<string, unknown>)['id']
            const effort = (model as Record<string, unknown>)[DEFAULT_EFFORT_FIELD]
            if (typeof id === 'string' && typeof effort === 'string' && effort.length > 0) {
              map.set(`${route}/${id}`, effort)
            }
          }
        }
        // An invalidation during the flight must not land a stale snapshot:
        // the caller re-describes on the next read instead.
        if (generation === configuredEffortsGeneration) configuredEfforts = map
        else configuredEffortsInflight = undefined
      })
      .catch(() => {
        // A failed read leaves the cache empty: the next read re-describes.
        if (generation === configuredEffortsGeneration) configuredEffortsInflight = undefined
      })
    return configuredEffortsInflight
  }

  const of = async (provider: string, model: string): Promise<string | undefined> => {
    await ensureConfiguredEfforts()
    return configuredEfforts?.get(`${provider}/${model}`)
  }

  const invalidate = (): void => {
    configuredEffortsGeneration += 1
    configuredEfforts = undefined
    configuredEffortsInflight = undefined
  }

  return { of, invalidate }
}
