/**
 * Shape guards and settings-dict readers shared by the host and browser
 * halves. Pure data logic only: esbuild inlines this module into both
 * bundles, so it must never import a harness package or touch DOM/node APIs.
 *
 * @module dsh-better-reasoning-effort/shared
 */

import type { RouteFacts } from './knowledge.js'

/** Whether a value is a plain-ish object (not null, not an array). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The models array of one route in a providers dict, as records. */
export function modelsOf(providers: unknown, route: string): Record<string, unknown>[] {
  if (!isRecord(providers)) return []
  const profile = providers[route]
  if (!isRecord(profile) || !Array.isArray(profile['models'])) return []
  return profile['models'].filter(isRecord)
}

/** One provider profile's route facts, as suggestion inference reads them. */
export function routeFactsOf(providers: unknown, route: string): RouteFacts {
  if (!isRecord(providers)) return {}
  const profile = providers[route]
  if (!isRecord(profile)) return {}
  const api = typeof profile['api'] === 'string' ? profile['api'] : undefined
  const baseURL = typeof profile['baseURL'] === 'string' ? profile['baseURL'] : undefined
  const displayName = typeof profile['displayName'] === 'string' ? profile['displayName'] : undefined
  return { api, baseURL, displayName }
}
