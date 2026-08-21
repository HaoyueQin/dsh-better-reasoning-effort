/**
 * Client-side reasoning-effort write seam over `settings.mutate`, plus the
 * knowledge-base / protocol suggestions. Pure logic —
 * no React, no DOM — so it stays unit-testable in isolation.
 *
 * @module dsh-better-reasoning-effort/client/ops
 */

import {
  suggestEfforts,
  type ReasoningEfforts,
  type RouteFacts,
} from '../knowledge.js'
import { PI_AI_NS, PROBE_PATH } from '../constants.js'
import { analyzeListingEntry, findListingEntry, type EndpointSignal } from '../detection.js'
import type {
  RemoteApi,
  SettingsNamespaceView,
  SuggestReply,
  WriteEffortsReply,
} from './types.js'

/** The user-layer providers dict of the pi-ai namespace, as records. */
export function providersOf(namespace: SettingsNamespaceView | undefined): Record<string, Record<string, unknown>> {
  const value = namespace?.value as { providers?: unknown } | undefined
  const providers = value?.providers
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return {}
  return Object.fromEntries(
    Object.entries(providers as Record<string, unknown>).filter(([, profile]) =>
      typeof profile === 'object' && profile !== null && !Array.isArray(profile)),
  ) as Record<string, Record<string, unknown>>
}

/** The models array of one route, as records preserving unknown fields. */
export function modelsOf(providers: Record<string, Record<string, unknown>>, route: string): Record<string, unknown>[] {
  const models = providers[route]?.['models']
  return Array.isArray(models)
    ? models.filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    : []
}

/** Route facts for one route (used by suggestion inference). */
export function routeFactsOf(providers: Record<string, Record<string, unknown>>, route: string): RouteFacts {
  const profile = providers[route] ?? {}
  const api = typeof profile['api'] === 'string' ? profile['api'] as string : undefined
  const baseURL = typeof profile['baseURL'] === 'string' ? profile['baseURL'] as string : undefined
  const displayName = typeof profile['displayName'] === 'string' ? profile['displayName'] as string : undefined
  return { api, baseURL, displayName }
}

/** The reasoningEfforts of one model in a route's models. */
export function effortsOf(models: Record<string, unknown>[], modelId: string): false | ReasoningEfforts | undefined {
  const entry = models.find(model => model['id'] === modelId)
  if (entry === undefined) return undefined
  const efforts = entry['reasoningEfforts']
  if (efforts === false) return false
  if (typeof efforts === 'object' && efforts !== null && !Array.isArray(efforts)) {
    return efforts as ReasoningEfforts
  }
  return undefined
}

/** The display name of one model in a route's models. */
export function nameOf(models: Record<string, unknown>[], modelId: string): string | undefined {
  const entry = models.find(model => model['id'] === modelId)
  const name = entry?.['name']
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/**
 * Ask the host's same-origin probe route for this model's raw-listing
 * reasoning signal. Any failure — route absent, endpoint unreachable, listing
 * shape unexpected — degrades to an explicit 'unknown' signal ("asked, no
 * answer"), never to a thrown error: suggestions must not break because the
 * endpoint would not talk.
 */
async function probeEndpoint(route: string, modelId: string): Promise<EndpointSignal> {
  try {
    const response = await fetch(`${PROBE_PATH}?route=${encodeURIComponent(route)}`, { method: 'GET' })
    if (!response.ok) return { reasoning: 'unknown', source: null }
    const body = (await response.json()) as { ok?: boolean; data?: unknown }
    if (!body?.ok) return { reasoning: 'unknown', source: null }
    return analyzeListingEntry(findListingEntry(body.data, modelId))
  } catch {
    return { reasoning: 'unknown', source: null }
  }
}

/**
 * Build the write seam over a settings Remote face.
 * @param api - the settings Remote methods.
 * @param describe - how to obtain the pi-ai namespace view (injectable for tests).
 */
export function createEditorApi(
  api: RemoteApi,
  describe: () => Promise<SettingsNamespaceView | undefined> = () => describeNamespace(api),
): {
  suggest(route: string, modelId: string, name?: string): Promise<SuggestReply>
  writeEfforts(route: string, modelId: string, efforts: ReasoningEfforts | false | undefined): Promise<WriteEffortsReply>
} {
  return {
    async suggest(route, modelId, name) {
      const providers = providersOf(await describe())
      const facts = routeFactsOf(providers, route)
      // L1 first: the endpoint's own word about this model. The fusion in
      // suggestEfforts keeps wire values knowledge-base-only.
      const endpoint = await probeEndpoint(route, modelId)
      const suggestion = suggestEfforts(modelId, { ...facts, displayName: name ?? facts.displayName }, endpoint)
      if (suggestion.efforts === undefined) return { ok: false, error: 'no-suggestion' }
      return {
        ok: true,
        suggestion: {
          efforts: suggestion.efforts,
          matched: suggestion.matched,
          source: suggestion.source,
          confidence: suggestion.confidence,
          ...(suggestion.endpoint === undefined ? {} : { endpoint: suggestion.endpoint }),
        },
      }
    },
    async writeEfforts(route, modelId, efforts) {
      // Retry once on a revision conflict: a concurrent writer (this plugin's
      // own autofill, or the official page) moved the namespace between our
      // describe and mutate. Re-reading and retrying with the fresh revision
      // is the same recovery the official settings form uses; anything else
      // surfaces as-is.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const namespace = await describe()
          if (namespace === undefined) return { ok: false, error: 'no-namespace' }
          const providers = providersOf(namespace)
          const models = modelsOf(providers, route)
          const index = models.findIndex(model => model['id'] === modelId)
          if (index < 0) return { ok: false, error: 'model-not-found' }
          const nextModels = models.map((model, at) => {
            if (at !== index) return model
            const copy = { ...model }
            if (efforts === undefined) {
              // Unset the declaration: the model goes back to inheriting.
              delete copy['reasoningEfforts']
            } else if (efforts === false) {
              copy['reasoningEfforts'] = false
            } else {
              copy['reasoningEfforts'] = { ...efforts }
            }
            return copy
          })
          const response = await api.settings.mutate({
            ns: PI_AI_NS,
            ops: [{ op: 'set', path: ['providers', route, 'models'], value: nextModels }],
            expectedRevision: namespace.revision,
          })
          if (!response.result.ok) {
            // The stable wire code, not the message prose: 'settings-conflict'
            // means a concurrent writer moved the namespace between our describe
            // and mutate. Re-reading and retrying with the fresh revision is the
            // same recovery the official settings form uses; anything else
            // surfaces as-is.
            if (attempt === 0 && response.result.error.code === 'settings-conflict') continue
            return { ok: false, error: response.result.error.message }
          }
          return { ok: true }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      return { ok: false, error: 'conflict' }
    },
  }
}

/** Describe the pi-ai namespace through the settings Remote. */
async function describeNamespace(api: RemoteApi): Promise<SettingsNamespaceView | undefined> {
  const response = await api.settings.describe({})
  if (!response.result.ok) return undefined
  return response.result.value.namespaces.find(ns => ns.ns === PI_AI_NS)
}
