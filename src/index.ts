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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer service merge into this program's Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Runtime helper + the `declare module '@deepseek-ai/cordis'` merge that types
// `ctx.settings` as `SettingsProvider` (describe() returns one descriptor per
// registered namespace — an ARRAY, not the wire `{namespaces}` envelope).
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { PI_AI_NS, PLUGIN_ID, PROBE_PATH, UNSET_MARKER } from './constants.js'
import { suggestEfforts } from './knowledge.js'
import { isRecord, modelsOf, routeFactsOf } from './shared.js'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Hard dependencies: the loader waits for these before calling apply. */
export const inject = ['settings']

/** The branded settings namespace this plugin reads and fills. */
const PI_NS = settingsNamespace(PI_AI_NS)

type JsonObject = Record<string, unknown>

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
      // Declared models are untouched — and so are models the user
      // deliberately unset: the durable marker records that absence as a
      // decision, so auto-fill never reads it back as a gap (the bug this
      // guards: a refill one event after every user "unset").
      if (model['reasoningEfforts'] !== undefined || model[UNSET_MARKER] === true) {
        nextModels.push(model)
        continue
      }
      const id = typeof model['id'] === 'string' ? model['id'] : ''
      if (id.length === 0) {
        nextModels.push(model)
        continue
      }
      const routeInfo = routeFactsOf(providers, route)
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

/** Probe fetch budget: a gateway that cannot answer /models in 15s will not answer the composer either. */
const PROBE_TIMEOUT_MS = 15_000

interface CredentialsService {
  resolve(ref: string): Promise<{ value?: string } | undefined>
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * Browser trust fence for the probe route, mirroring the /api route's
 * semantics: reject declared cross-site requests, reject mismatched Origins,
 * and require some same-origin/same-site browser signal before a non-loopback
 * Host is answered. The route proxies only endpoints the user's own settings
 * already name, but it does so with the stored credential attached — so it
 * must not be callable from elsewhere.
 */
function isTrustedRequest(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  const secFetchSite = req.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  const hostname = host.split(':')[0]!.toLowerCase()
  if (isLoopbackHostname(hostname)) return true
  if (secFetchSite === 'same-origin' || secFetchSite === 'same-site') return true
  return typeof origin === 'string'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/**
 * Apply the plugin: autofill undeclared models on boot and after every commit
 * that touches the pi-ai namespace.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  // The probe route (registered below, possibly before the settings injection
  // runs) reads the pi-ai section through this closure slot.
  let piSection: unknown = undefined

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    piSection = () => settings.get(PI_NS)

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

  // Same-origin probe route: the browser half's Auto-adapt asks the endpoint's
  // RAW /models listing through here, because the sanctioned llm wire call
  // strips reasoning signals host-side. The credential resolves server-side
  // and never echoes back; only routes the user's own settings name are
  // reachable, and the trust fence rejects cross-site callers.
  ctx.inject(['webServer'], (webServerCtx) => {
    ctx.effect(
      () =>
        webServerCtx.webServer.register({
          kind: 'exact',
          path: PROBE_PATH,
          handler: async (req, res) => {
            if (!isTrustedRequest(req)) {
              sendJson(res, 403, { ok: false, error: 'forbidden' })
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            const url = new URL(req.url ?? '/', 'http://x')
            const route = url.searchParams.get('route') ?? ''
            const readSection = typeof piSection === 'function' ? piSection : () => undefined
            const section = readSection()
            const profile = isRecord(section) && isRecord(section['providers'])
              ? section['providers'][route]
              : undefined
            if (!isRecord(profile)) {
              sendJson(res, 400, { ok: false, error: `no llm-pi-ai provider route "${route}"` })
              return
            }
            const baseURL = typeof profile['baseURL'] === 'string' ? profile['baseURL'] : ''
            if (baseURL.length === 0) {
              sendJson(res, 400, { ok: false, error: `provider route "${route}" has no baseURL` })
              return
            }
            const apiKeyEnv = typeof profile['apiKeyEnv'] === 'string' ? profile['apiKeyEnv'] : undefined
            const listingURL = `${baseURL.replace(/\/+$/, '')}/models`
            let apiKey: string | undefined
            if (apiKeyEnv !== undefined) {
              try {
                const credentials = ctx.get('credentials') as CredentialsService | undefined
                const hit = credentials === undefined ? undefined : await credentials.resolve(apiKeyEnv)
                apiKey = hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0
                  ? hit.value
                  : undefined
              } catch {
                // Unresolvable credential: probe unauthenticated rather than fail.
              }
            }
            try {
              const upstream = await fetch(listingURL, {
                method: 'GET',
                headers: { accept: 'application/json', ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }) },
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
              })
              if (!upstream.ok) {
                const hint = upstream.status === 401 || upstream.status === 403 ? '; check the API key' : ''
                sendJson(res, 200, { ok: false, error: `${listingURL} answered ${upstream.status}${hint}` })
                return
              }
              const body = (await upstream.json()) as { data?: unknown }
              if (body === null || !Array.isArray(body['data'])) {
                sendJson(res, 200, { ok: false, error: `${listingURL} model listing has no "data" array` })
                return
              }
              sendJson(res, 200, { ok: true, url: listingURL, data: body['data'] })
            } catch (error) {
              sendJson(res, 200, {
                ok: false,
                error: `could not reach ${listingURL}: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          },
        }),
      'dsh-better-reasoning-effort: raw-models probe route',
    )
  })
}
