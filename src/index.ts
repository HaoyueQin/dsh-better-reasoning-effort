/**
 * Host half of dsh-better-reasoning-effort.
 *
 * One job: settings auto-adaptation. Whenever the `llm-pi-ai` section gains a
 * hand-declared model that carries no `reasoningEfforts`, fill one in from the
 * knowledge base + protocol inference (see {@link suggestEfforts}). The fill
 * is a *suggestion* written to the user layer — the user can still edit it on
 * the Models page — and a model that already declares efforts, or an explicit
 * `false`, is never touched. All interactive editing (per-model editors and
 * per-model auto-adapt) lives in the browser half, which reuses the same
 * knowledge base as a pure module.
 *
 * @module dsh-better-reasoning-effort
 */

import type { Context } from '@deepseek-ai/cordis'
// Runtime helper + the `declare module '@deepseek-ai/cordis'` merge that types
// `ctx.settings` as `SettingsProvider` (describe() returns one descriptor per
// registered namespace — an ARRAY, not the wire `{namespaces}` envelope).
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PI_AI_NS, PLUGIN_ID } from './constants.js'
import { suggestEfforts, type RouteFacts } from './knowledge.js'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Hard dependencies: the loader waits for these before calling apply. */
export const inject = ['settings']

/** The branded settings namespace this plugin reads and fills. */
const PI_NS = settingsNamespace(PI_AI_NS)

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

/**
 * Boot-fill retry budget: llm-pi-ai registers its namespace in its own apply,
 * and cordis gives this plugin no ordering guarantee against it. If the
 * namespace is not up yet at boot, retry on this bounded schedule before
 * leaving the rest to the next `settings/updated`.
 */
const BOOT_RETRY_MS = 1000
const BOOT_RETRY_MAX = 5

/**
 * Apply the plugin: autofill undeclared models on boot and after every commit
 * that touches the pi-ai namespace.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings

    /** One autofill pass; resolves false while the pi-ai namespace is unregistered. */
    const autofillOnce = async (): Promise<boolean> => {
      const value = settings.get(PI_NS)
      if (!isRecord(value)) return false
      const patch = buildAutofillPatch(value['providers'])
      if (patch === undefined) return true
      // Optimistic lock: only write while the namespace has not moved past
      // this read. The fill is a background suggestion — losing the race to a
      // user edit is fine, the next `settings/updated` retries it. Without
      // the lock, every fill bumps the revision and invalidates the revision
      // the settings page read, surfacing as SettingsConflictError on the
      // next user save.
      const revision = settings.describe().find(entry => entry.ns === PI_NS)?.revision
      await settings.update(PI_NS, patch, revision)
      return true
    }

    /** Auto-fill must never break the settings pipeline; log and move on. */
    const logFailure = (error: unknown): void => {
      console.error(`[dsh-better-reasoning-effort] autofill failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Pending boot-retry timers, cleared with the fiber (a disposed plugin
    // must not fire into a torn-down service graph).
    const timers = new Set<ReturnType<typeof setTimeout>>()
    ctx.effect(() => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }, 'dsh-better-reasoning-effort: boot-fill retries')

    // Fill once at boot for models declared before this plugin was installed.
    const bootFill = (attempt: number): void => {
      void autofillOnce().then((ready) => {
        if (ready || attempt >= BOOT_RETRY_MAX) return
        const timer = setTimeout(() => {
          timers.delete(timer)
          bootFill(attempt + 1)
        }, BOOT_RETRY_MS)
        timers.add(timer)
      }, logFailure)
    }
    bootFill(0)

    // Then after every commit that touches the pi-ai namespace.
    ctx.on('settings/updated', (ns) => {
      if (ns === PI_NS) void autofillOnce().catch(logFailure)
    })
  })
}
