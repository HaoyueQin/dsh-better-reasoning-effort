/**
 * Host half of dsh-better-reasoning-effort.
 *
 * One job: settings auto-adaptation. Whenever the `llm-pi-ai` section gains a
 * hand-declared model that carries no `reasoningEfforts`, fill one in from the
 * knowledge base + protocol inference (see {@link suggestEfforts}). The fill
 * is a *suggestion* written to the user layer — the user can still edit it on
 * the Models page — and a model that already declares efforts, or an explicit
 * `false`, is never touched. All interactive editing (per-model editors, the
 * preset one-click apply, per-model auto-adapt) lives in the browser half,
 * which reuses the same knowledge base as a pure module.
 *
 * @module dsh-better-reasoning-effort
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { suggestEfforts, type RouteFacts } from './knowledge.js'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = 'dsh-better-reasoning-effort'

/** The settings namespace this plugin edits: pi-ai custom provider routes. */
export const PI_AI_NS = 'llm-pi-ai'

/** Plugin-owned settings namespace: reserved for future user knowledge rows. */
const STORE_NS = 'dsh-better-reasoning-effort'

/** Hard dependencies: the loader waits for these before calling apply. */
export const inject = ['settings']

/** Schema for the plugin's own store namespace. */
const StoreSchema = z.object({
  entries: z.array(z.any()).default([]),
})

type JsonObject = Record<string, unknown>

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Read one provider profile's route facts from a resolved settings value. */
function routeFacts(providers: unknown, route: string): RouteFacts {
  if (!isRecord(providers)) return {}
  const profile = providers[route]
  if (!isRecord(profile)) return {}
  const api = typeof profile['api'] === 'string' ? profile['api'] : undefined
  const baseURL = typeof profile['baseURL'] === 'string' ? profile['baseURL'] : undefined
  const displayName = typeof profile['displayName'] === 'string' ? profile['displayName'] : undefined
  return { api, baseURL, displayName }
}

/** The models array of one route, as records (preserving unknown fields). */
function modelsOf(providers: unknown, route: string): JsonObject[] {
  if (!isRecord(providers)) return []
  const profile = providers[route]
  if (!isRecord(profile) || !Array.isArray(profile['models'])) return []
  return profile['models'].filter(isRecord)
}

/**
 * Build a patch that adds reasoningEfforts to every undeclared model of the
 * given routes, from the knowledge base / protocol inference. Returns the
 * partial providers patch, or undefined when nothing needs filling.
 * @param providers - the resolved providers dict.
 * @param routeFilter - optional route filter (defaults to all routes).
 */
export function buildAutofillPatch(
  providers: unknown,
  routeFilter: (route: string) => boolean = () => true,
): JsonObject | undefined {
  if (!isRecord(providers)) return undefined
  const patchRoutes: JsonObject = {}
  for (const route of Object.keys(providers)) {
    if (!routeFilter(route)) continue
    const models = modelsOf(providers, route)
    if (models.length === 0) continue
    const nextModels: JsonObject[] = []
    let changed = false
    for (const model of models) {
      if (model['reasoningEfforts'] !== undefined) {
        nextModels.push(model)
        continue
      }
      const id = typeof model['id'] === 'string' ? model['id'] : ''
      if (id.length === 0) {
        nextModels.push(model)
        continue
      }
      const routeInfo = routeFacts(providers, route)
      const name = typeof model['name'] === 'string' ? model['name'] : undefined
      const suggestion = suggestEfforts(id, { ...routeInfo, displayName: name ?? routeInfo.displayName })
      if (suggestion.efforts === undefined) {
        nextModels.push(model)
        continue
      }
      changed = true
      nextModels.push({
        ...model,
        reasoningEfforts: suggestion.efforts,
        ...suggestion.compat === undefined ? {} : { compat: suggestion.compat },
      })
    }
    if (changed) patchRoutes[route] = { models: nextModels }
  }
  return Object.keys(patchRoutes).length === 0 ? undefined : { providers: patchRoutes }
}

/** Host-side settings service face (narrowed). */
interface HostSettingsService {
  get(ns: string): unknown
  register<T>(ns: string, schema: z<T>, options?: { validate?: boolean }): unknown
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * Apply the plugin: register the store namespace and autofill undeclared
 * models on every `llm-pi-ai` update.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  const settings = ctx.get('settings') as HostSettingsService | undefined
  if (settings === undefined) return
  const settingsService = settings

  settingsService.register(STORE_NS, StoreSchema)

  /** Fill undeclared models across every configured pi-ai route. */
  const autofill = async (): Promise<void> => {
    try {
      const value = settingsService.get(PI_AI_NS)
      if (!isRecord(value)) return
      const patch = buildAutofillPatch(value['providers'])
      if (patch === undefined) return
      await settingsService.update(PI_AI_NS, patch)
    } catch (error) {
      // Auto-fill must never break the settings pipeline; log and move on.
      console.error(`[dsh-better-reasoning-effort] autofill failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Fill once at boot for models declared before this plugin was installed,
  // then after every commit that touches the pi-ai namespace.
  void autofill()
  ctx.on('settings/updated', (ns: unknown) => {
    if (ns === PI_AI_NS) void autofill()
  })
}
