/**
 * Endpoint reasoning-signal detection over a provider's RAW /models listing.
 *
 * The sanctioned `llm.discoverModels` wire call strips reasoning signals
 * host-side, so the host half proxies the raw listing through a same-origin
 * route; this module is the pure half both ends share. Detection approach
 * follows the format survey proven by dsh-reasoning-efforts (MIT): listings
 * disclose reasoning support under several field conventions, and "no
 * signal" must stay distinct from "explicitly unsupported".
 *
 * @module dsh-better-reasoning-effort/detection
 */

/** One raw /models listing entry: pass through unknown fields untouched. */
export type RawModelEntry = Record<string, unknown>

/** Tri-state endpoint signal: true reasons, false explicitly does not, 'unknown' = the listing never said. */
export type EndpointReasoning = boolean | 'unknown'

/** What the endpoint disclosed about one model's reasoning support. */
export interface EndpointSignal {
  reasoning: EndpointReasoning
  /** The listing field that produced the signal, null when none did. */
  source: string | null
}

import { isRecord } from './shared.js'

const hasString = (entry: Record<string, unknown>, key: string): boolean => {
  const value = entry[key]
  return typeof value === 'string' && value.length > 0
}

const hasBoolean = (entry: Record<string, unknown>, key: string): boolean =>
  typeof entry[key] === 'boolean'

/** Find the raw listing entry for one model id. */
export function findListingEntry(
  listing: unknown,
  modelId: string,
): RawModelEntry | undefined {
  if (!Array.isArray(listing)) return undefined
  for (const entry of listing) {
    if (isRecord(entry) && entry['id'] === modelId) return entry
  }
  return undefined
}

/**
 * Read one listing entry's reasoning signal. Field conventions covered:
 *   - `supported_features: [..., "reasoning"]`        (rich feature arrays)
 *   - `supported_parameters: [..., "reasoning" | "include_reasoning" |
 *      "reasoning_effort"]`                           (OpenRouter-style)
 *   - `supports_reasoning` / `supportsReasoning`      (boolean flags)
 *   - `can_reason` / `reasoning`                      (boolean flags)
 *   - top-level `reasoning_effort` / `supports_reasoning_effort`
 *
 * A bare `{id, object, owned_by}` listing yields 'unknown' — that is NOT
 * "unsupported": the endpoint simply never said.
 */
export function analyzeListingEntry(entry: unknown): EndpointSignal {
  if (!isRecord(entry)) return { reasoning: 'unknown', source: null }
  const features = entry['supported_features']
  if (Array.isArray(features) && features.includes('reasoning')) {
    return { reasoning: true, source: 'supported_features' }
  }
  const parameters = entry['supported_parameters']
  if (
    Array.isArray(parameters) &&
    (parameters.includes('reasoning') ||
      parameters.includes('include_reasoning') ||
      parameters.includes('reasoning_effort'))
  ) {
    return { reasoning: true, source: 'supported_parameters' }
  }
  if (hasBoolean(entry, 'supports_reasoning')) {
    return { reasoning: entry['supports_reasoning'] as boolean, source: 'supports_reasoning' }
  }
  if (hasBoolean(entry, 'supportsReasoning')) {
    return { reasoning: entry['supportsReasoning'] as boolean, source: 'supportsReasoning' }
  }
  if (hasBoolean(entry, 'can_reason')) {
    return { reasoning: entry['can_reason'] as boolean, source: 'can_reason' }
  }
  if (hasBoolean(entry, 'reasoning')) {
    return { reasoning: entry['reasoning'] as boolean, source: 'reasoning' }
  }
  if (entry['reasoning_effort'] !== undefined || entry['supports_reasoning_effort'] === true) {
    return { reasoning: true, source: 'reasoning_effort' }
  }
  return { reasoning: 'unknown', source: null }
}

/**
 * Detect one model's endpoint signal from a raw listing.
 * @returns the signal, plus whether the model appeared in the listing at all.
 */
export function detectModelSignal(
  listing: unknown,
  modelId: string,
): { found: boolean; signal: EndpointSignal } {
  const entry = findListingEntry(listing, modelId)
  if (entry === undefined) return { found: false, signal: { reasoning: 'unknown', source: null } }
  return { found: true, signal: analyzeListingEntry(entry) }
}
