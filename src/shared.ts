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

/**
 * Whether a settings refusal reads like "this kernel does not know the newer
 * compat keys". The host autofill and the browser write path each downgrade
 * once on this signal, so they must answer identically.
 */
export function looksLikeCompatRefusal(message: string): boolean {
  const msg = message.toLowerCase()
  return msg.includes('compat')
    || msg.includes('thinkingtokenbudget')
    || msg.includes('vllmpriority')
    || msg.includes('supportsmaxoutput')
}

/**
 * Whether a route profile's `models` value actually declares rows.
 *
 * An empty array is NOT a declaration. Schemastery materializes an absent,
 * non-required array field with the array schema's `meta.default`, which is
 * always `[]`, so every schema-resolved profile carries `models: []` for a
 * route that declares none -- and the settings namespace's resolved `value`
 * and its composition `base` are both schema-resolved. Testing merely
 * `Array.isArray(models)` therefore reports "declared" for a route that
 * declares only `modelOverrides`, which silently hides every catalog row.
 */
export function declaresModels(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

/** The models array of one route in a providers dict, as records. */
export function modelsOf(providers: unknown, route: string): Record<string, unknown>[] {
  if (!isRecord(providers)) return []
  const profile = providers[route]
  if (!isRecord(profile)) return []
  if (declaresModels(profile['models'])) return profile['models'].filter(isRecord)
  // Installed catalog routes keep per-model customizations under the official
  // `modelOverrides` map. Materialize the map key as the row id so the client
  // editor can use the same pure row logic as an explicit `models` list.
  if (isRecord(profile['modelOverrides'])) {
    return Object.entries(profile['modelOverrides'])
      .filter(([, value]) => isRecord(value))
      .map(([id, value]) => ({ ...(value as Record<string, unknown>), id }))
  }
  return []
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
