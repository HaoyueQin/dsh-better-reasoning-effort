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
import Schema from '@deepseek-ai/schemastery'
import { INPUT_UNSET_MARKER, PI_AI_NS, PLUGIN_ID, PROBE_PATH, UNSET_MARKER } from './constants.js'
import { suggestEfforts } from './knowledge.js'
import { isRecord, routeFactsOf } from './shared.js'

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const name = PLUGIN_ID

/** Hard dependencies: the loader waits for these before calling apply. */
export const inject = ['settings']

/** The branded settings namespace this plugin reads and fills. */
const PI_NS = settingsNamespace(PI_AI_NS)

type JsonObject = Record<string, unknown>

/**
 * Whether a model row carries an input-modality declaration the document
 * already answers with. An absent key and an empty array both read as "no
 * answer here" -- mirroring how llm-pi-ai's own resolution treats them.
 */
function declaresInput(model: JsonObject): boolean {
  const input = model['input']
  return Array.isArray(input) && input.length > 0
}

/**
 * Build a patch that adds reasoningEfforts -- and, unless declined, the
 * input-modality declaration -- to every undeclared model of the given
 * routes, from the knowledge base / protocol inference. Returns the partial
 * providers patch, or undefined when nothing needs filling.
 * @param providers - the resolved providers dict.
 * @param routeFilter - optional route filter (defaults to all routes).
 * @param options - fill switches; both default on.
 */
export function buildAutofillPatch(
  providers: unknown,
  routeFilter: (route: string) => boolean = () => true,
  options: { efforts?: boolean; modalities?: boolean } = {},
): JsonObject | undefined {
  const fillEfforts = options.efforts !== false
  const fillModalities = options.modalities !== false
  if (!isRecord(providers)) return undefined
  const patchRoutes: JsonObject = {}
  for (const route of Object.keys(providers)) {
    if (!routeFilter(route)) continue
    // Read the RAW models array: this builder rebuilds the array verbatim,
    // so a route carrying a row it cannot represent (non-record) is left
    // alone — a filtered rebuild would silently DELETE that row.
    const profile = providers[route]
    const rawModels = isRecord(profile) && Array.isArray(profile['models']) ? profile['models'] : undefined
    if (rawModels === undefined || rawModels.length === 0) continue
    if (!rawModels.every(isRecord)) continue
    const models = rawModels as Record<string, unknown>[]
    const nextModels: JsonObject[] = []
    let changed = false
    for (const model of models) {
      // Declared parts are untouched — and so are parts the user
      // deliberately unset: the durable markers record those absences as
      // decisions, so auto-fill never reads them back as gaps (the bug this
      // guards: a refill one event after every user "unset").
      const effortsDeclared = model['reasoningEfforts'] !== undefined || model[UNSET_MARKER] === true
      const inputDeclared = declaresInput(model) || model[INPUT_UNSET_MARKER] === true
      if ((effortsDeclared || !fillEfforts) && (inputDeclared || !fillModalities)) {
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
      const fill: JsonObject = { ...model }
      let touched = false
      // Capacities are never filled here: contextWindow / maxTokens are
      // display-only reference values in the browser half, and writing them
      // host-side would silently override the route defaults.
      // Reaching this branch means neither part was declared and no durable
      // unset marker stands on the row -- so there is no stale marker inside
      // `fill` to scrub; the guards above already excluded it.
      if (!effortsDeclared && fillEfforts) {
        touched = true
        fill['reasoningEfforts'] = suggestion.efforts as JsonObject
        if (suggestion.compat !== undefined) fill['compat'] = suggestion.compat as JsonObject
      }
      if (!inputDeclared && fillModalities && suggestion.input !== undefined) {
        touched = true
        fill['input'] = [...suggestion.input]
      }
      if (!touched) {
        nextModels.push(model)
        continue
      }
      changed = true
      nextModels.push(fill)
    }
    if (changed) patchRoutes[route] = { models: nextModels }
  }
  return Object.keys(patchRoutes).length === 0 ? undefined : { providers: patchRoutes }
}

/**
 * Exponential backoff for the boot fill: llm-pi-ai may register its namespace
 * well after this plugin on a slow start, and registration emits no event of
 * its own — the schedule must outlast a realistically slow profile instead of
 * giving up after a few flat seconds.
 */
const BOOT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

/** Probe fetch budget: a gateway that cannot answer /models in 15s will not answer the composer either. */
const PROBE_TIMEOUT_MS = 15_000

/**
 * Plugin configuration, supplied through the profile's cordis layer
 * (the row's `config:` block). Every tunable two deployments may want
 * to set differently lives here rather than as a code constant.
 */
export interface Config {
  /** Auto-fill undeclared pi-ai models on boot and after settings updates (default true). */
  autofill?: boolean
  /**
   * Whether the auto-fill above also fills the input-modality declaration
   * (default true). Effort auto-fill is governed by {@link autofill} alone.
   */
  modalityAutofill?: boolean
  /** Upstream fetch timeout for the raw /models probe route, in milliseconds (default 15000). */
  probeTimeoutMs?: number
  /**
   * Boot-fill retry backoff schedule in milliseconds; an empty list means
   * "try exactly once" (default [1000, 2000, 4000, 8000, 16000, 30000]).
   */
  bootRetryDelaysMs?: number[]
}

/** Schemastery schema: Cordis validates the row config and fills defaults before apply(). */
export const Config: Schema<Config> = Schema.object({
  autofill: Schema.boolean().default(true),
  modalityAutofill: Schema.boolean().default(true),
  probeTimeoutMs: Schema.natural().min(1).default(PROBE_TIMEOUT_MS),
  bootRetryDelaysMs: Schema.array(Schema.natural().min(1)).default([...BOOT_RETRY_DELAYS_MS]),
})

interface CredentialsService {
  resolve(ref: string): Promise<{ value?: string } | undefined>
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/** WHATWG-parse a Host/Origin authority (`host` or `host:port`). */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG special scheme: parsing yields a hostname or throws,
    // and normalizes casing the raw header keeps. Note the hostname of an
    // IPv6 authority KEEPS its brackets (`[::1]`) — the literal check below
    // deliberately matches on the colon.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Whether a parsed hostname is an IP literal (IPv4 dotted quad, or IPv6 whose
 * brackets URL parsing already stripped). A browser fills Host from the URL it
 * believes it is talking to, so a DNS-rebound page ALWAYS carries the
 * attacker's domain here — it can never produce an IP-literal Host short of
 * the user genuinely navigating to that IP.
 */
function isIpLiteralHostname(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
}

/**
 * Browser trust fence for the probe route. It mirrors the core /api fence's
 * DEFENSE (packages/client/connection/src/api-request-trust.ts) minus one
 * feature: there is no `trustedHosts` escape hatch yet.
 *
 *   - Cross-site requests are refused outright; a same-origin/same-site
 *     marker never ADMITS anything by itself.
 *   - An attached Origin must name exactly this authority; the literal
 *     `null` (sandboxed iframe, file: page) is refused.
 *   - The Host fence binds every request and is the rebinding defense:
 *     only loopback names and IP literals are answered. A rebound page
 *     names the attacker's DOMAIN in Host even though the socket lands on
 *     this server, so named hosts are always 403.
 *
 * The route proxies only endpoints the user's own settings already name, but
 * it does so with the stored credential attached — so it must not be callable
 * from elsewhere. LAN deployments serving the GUI under a DOMAIN name get 403
 * here by design (IP-literal LAN hosts keep working); see README known
 * limitations until a trustedHosts seam exists.
 */
function isTrustedRequest(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  const secFetchSite = req.headers['sec-fetch-site']
  if (secFetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    if (origin === 'null') return false
    try {
      if (new URL(origin).host !== hostUrl.host) return false
    } catch {
      return false
    }
  }
  const hostname = hostUrl.hostname.toLowerCase()
  return isLoopbackHostname(hostname) || isIpLiteralHostname(hostname)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/**
 * A URL safe to echo in responses: a baseURL may carry userinfo
 * (https://user:pass@host), and failure messages must never repeat it.
 */
function displayUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return raw
  }
}

/**
 * Apply the plugin: autofill undeclared models on boot and after every commit
 * that touches the pi-ai namespace.
 * @param ctx - host context.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Cordis fills schema defaults; direct calls (tests) may omit fields.
  const resolved = {
    autofill: config.autofill !== false,
    modalityAutofill: config.modalityAutofill !== false,
    probeTimeoutMs: config.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
    bootRetryDelaysMs: config.bootRetryDelaysMs ?? [...BOOT_RETRY_DELAYS_MS],
  }

  // Module-level `inject` already guarantees the settings service; using it
  // directly (instead of a redundant inner ctx.inject) keeps one dependency
  // declaration as the single source of truth.
  const settings = ctx.settings

  // The probe route (registered below) reads the pi-ai section through this
  // closure slot.
  const piSection = (): unknown => settings.get(PI_NS)

  if (resolved.autofill) {
    /** One autofill pass; resolves false while the pi-ai namespace is unregistered. */
    const autofillOnce = async (): Promise<boolean> => {
      const value = settings.get(PI_NS)
      if (!isRecord(value)) return false
      // Build the patch from the RAW USER layer, never the resolved value:
      // the fill merges into the user document, and building from the
      // resolved view would materialize schema defaults / composition-base
      // models into it wholesale the moment pi-ai grows such layers for its
      // profile. A namespace whose user section holds no providers has
      // nothing this plugin may fill.
      const descriptor = settings.describe().find(entry => entry.ns === PI_NS)
      const user = descriptor?.user
      const userProviders = isRecord(user) && isRecord(user['providers']) ? user['providers'] : undefined
      if (userProviders === undefined) return true
      const patch = buildAutofillPatch(userProviders, () => true, { modalities: resolved.modalityAutofill })
      if (patch === undefined) return true
      // Optimistic lock: only write while the namespace has not moved past
      // this read. The fill is a background suggestion — losing the race to a
      // user edit is fine, the next `settings/updated` retries it. Without
      // the lock, every fill bumps the revision and invalidates the revision
      // the settings page read, surfacing as SettingsConflictError on the
      // next user save.
      await settings.update(PI_NS, patch, descriptor?.revision)
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

    // Fill once at boot for models declared before this plugin was installed,
    // backing off exponentially while llm-pi-ai has not registered yet.
    const bootFill = (attempt: number): void => {
      void autofillOnce().then((ready) => {
        if (ready || attempt >= resolved.bootRetryDelaysMs.length) return
        const timer = setTimeout(() => {
          timers.delete(timer)
          bootFill(attempt + 1)
        }, resolved.bootRetryDelaysMs[attempt])
        timers.add(timer)
      }, logFailure)
    }
    bootFill(0)

    // Then after every commit that touches the pi-ai namespace.
    ctx.on('settings/updated', (ns) => {
      if (ns === PI_NS) void autofillOnce().catch(logFailure)
    })
  }

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
            const section = piSection()
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
                signal: AbortSignal.timeout(resolved.probeTimeoutMs),
              })
              if (!upstream.ok) {
                const hint = upstream.status === 401 || upstream.status === 403 ? '; check the API key' : ''
                sendJson(res, 502, { ok: false, error: `${displayUrl(listingURL)} answered ${upstream.status}${hint}` })
                return
              }
              const body = (await upstream.json()) as { data?: unknown }
              if (body === null || !Array.isArray(body['data'])) {
                sendJson(res, 502, { ok: false, error: `${displayUrl(listingURL)} model listing has no "data" array` })
                return
              }
              sendJson(res, 200, { ok: true, url: displayUrl(listingURL), data: body['data'] })
            } catch (error) {
              sendJson(res, 502, {
                ok: false,
                error: `could not reach ${displayUrl(listingURL)}: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          },
        }),
      'dsh-better-reasoning-effort: raw-models probe route',
    )
  })
}
