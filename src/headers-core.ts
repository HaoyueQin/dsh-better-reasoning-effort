/**
 * Provider request-header overlay, PURE half: the origin index and the header
 * value rules shared by the fetch-layer installer and the conflict report.
 *
 * Why this exists at all (issue #12): a route's `headers` dict reaches the wire
 * through the official adapter, but `user-agent` does not. The pi-ai adapter
 * merges `attributionHeaders()` over the profile's dict and drops the profile's
 * own `user-agent` first, so a gateway that fingerprints the client identity
 * (agentrouter and claude-code-router style relays) never sees the configured
 * value. No configuration field can express that override, so the plugin takes
 * it over at the fetch layer.
 *
 * The index is keyed by ORIGIN, deliberately: the fetch seam sees a URL and
 * nothing else, and unlike a substring match an origin compare cannot be
 * fooled by `http://host` matching `http://host.example` or by two loopback
 * ports bleeding into each other.
 *
 * @module dsh-better-reasoning-effort/headers-core
 */

import { isRecord } from './shared.js'

/**
 * Upper bound on one header value the plugin will send. Fetch itself refuses
 * newline-bearing values (a header-injection guard); this plugin additionally
 * refuses anything unreasonable long rather than letting a paste of a whole
 * certificate turn every request into an upstream 400.
 */
const MAX_UA_LENGTH = 512

/** One origin's user-agent override, with the route that produced it. */
export interface UserAgentOverride {
  /** `scheme://host:port` of the route's endpoint, exactly as Fetch would print it. */
  origin: string
  /** The configured `user-agent` value. */
  userAgent: string
  /** The route key that declared it (diagnostics and the UI's own labelling). */
  route: string
}

/** The origin index plus what could not be indexed. */
export interface UserAgentIndex {
  /** origin → override, first declarer wins (see {@link conflicts}). */
  byOrigin: Map<string, UserAgentOverride>
  /**
   * Origins two or more routes claim with DIFFERENT values. The index keeps the
   * first and reports the rest: silently picking one would make the other
   * route's UA a coin flip, and the fetch layer has no way to tell the two
   * requests apart.
   */
  conflicts: { origin: string; routes: string[]; values: string[] }[]
}

/** An empty index, for the "no route declares a UA" case. */
export function emptyIndex(): UserAgentIndex {
  return { byOrigin: new Map(), conflicts: [] }
}

/** The `scheme://host:port` of a URL string, or undefined when unparseable. */
export function originOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim().length === 0) return undefined
  try {
    return new URL(url).origin
  } catch {
    // A relative or malformed endpoint is not an origin this seam can match.
    return undefined
  }
}

/**
 * Whether a configured value can ride a Fetch `user-agent` field. Refused
 * rather than sanitized: a header carrying a newline is a request-splitting
 * hazard, and quietly rewriting the user's value would send something they
 * never asked for.
 * @param value - the configured header value.
 * @returns whether it is safe to `Headers.set()`.
 */
export function isSendableUserAgent(value: string): boolean {
  if (value.length === 0 || value.length > MAX_UA_LENGTH) return false
  // CR/LF and NUL are what Fetch's own guard rejects; refusing them here keeps
  // the refusal at configuration time instead of on every request.
  return !/[\r\n\0]/.test(value)
}

/** The `headers` dict of one route profile, as string pairs, or undefined. */
export function headersOf(profile: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (profile === undefined) return undefined
  const headers = profile['headers']
  if (!isRecord(headers)) return undefined
  const pairs: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') pairs[name] = value
  }
  return Object.keys(pairs).length === 0 ? undefined : pairs
}

/**
 * The `user-agent` a route's `headers` dict declares, case-insensitively.
 *
 * A `user-agent` stored here is the user's DECLARATION of the identity their
 * gateway wants, even though the official adapter discards it; the plugin reads
 * the same key so the settings document stays the single source of truth.
 * @param profile - one route's profile record.
 * @returns the value, or undefined when the route declares none.
 */
export function declaredUserAgent(profile: Record<string, unknown> | undefined): string | undefined {
  const headers = headersOf(profile)
  if (headers === undefined) return undefined
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'user-agent') return isSendableUserAgent(value) ? value : undefined
  }
  return undefined
}

/**
 * Build the origin index from the resolved `providers` dict of the pi-ai
 * namespace.
 *
 * Only routes that both name an endpoint and declare a sendable `user-agent`
 * enter the index: a route with no `baseURL` resolves to a catalog endpoint the
 * plugin cannot know from settings, and inventing a value for it would rewrite
 * requests the user never configured.
 * @param providers - the `llm-pi-ai` providers dict, as stored.
 * @returns the index plus any same-origin disagreements.
 */
export function buildUserAgentIndex(
  providers: Record<string, Record<string, unknown>>,
): UserAgentIndex {
  const index = emptyIndex()
  const claimed = new Map<string, { routes: string[]; values: string[] }>()
  for (const [route, profile] of Object.entries(providers)) {
    const userAgent = declaredUserAgent(profile)
    if (userAgent === undefined) continue
    const origin = originOf(typeof profile['baseURL'] === 'string' ? profile['baseURL'] : undefined)
    if (origin === undefined) continue
    const existing = index.byOrigin.get(origin)
    if (existing === undefined) {
      index.byOrigin.set(origin, { origin, userAgent, route })
      claimed.set(origin, { routes: [route], values: [userAgent] })
      continue
    }
    const group = claimed.get(origin)!
    group.routes.push(route)
    group.values.push(userAgent)
    // Idempotent declaration (two routes, same identity) is not a conflict:
    // nothing is ambiguous about which value to send.
    if (existing.userAgent === userAgent) continue
    const reported = index.conflicts.find(entry => entry.origin === origin)
    if (reported === undefined) index.conflicts.push({ origin, routes: group.routes, values: group.values })
  }
  return index
}

/**
 * The request URL a Fetch call is aimed at, or undefined when it cannot be
 * classified. A `Request` from another realm fails the `instanceof` test and is
 * reported as unclassifiable rather than mis-read — the same conservative
 * posture the official fetch seam takes.
 * @param input - the fetch input.
 * @returns the URL string, when one can be read.
 */
export function requestUrlOf(input: unknown): string | undefined {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return undefined
}
