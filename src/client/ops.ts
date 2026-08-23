/**
 * Client-side reasoning-effort write seam over `settings.mutate`, plus the
 * knowledge-base / protocol suggestions. Pure logic —
 * no React, no DOM — so it stays unit-testable in isolation.
 *
 * @module dsh-better-reasoning-effort/client/ops
 */

import {
  suggestEfforts,
  type CompatSuggestion,
  type ReasoningEfforts,
} from '../knowledge.js'
import { PI_AI_NS, PROBE_PATH, UNSET_MARKER } from '../constants.js'
import { detectModelSignal, type EndpointSignal } from '../detection.js'
import { isRecord, routeFactsOf } from '../shared.js'
import type {
  EffortEditorApi,
  RemoteApi,
  SettingsJoin,
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
    return detectModelSignal(body.data, modelId).signal
  } catch {
    return { reasoning: 'unknown', source: null }
  }
}

/**
 * Build the write seam over a settings Remote face.
 * @param api - the settings Remote methods.
 * @param describe - how to obtain the pi-ai namespace join (injectable for tests).
 * @param stage - sink for declarations staged against a route that is not
 * saved yet; the injector owns the store and flushes it once the route exists.
 */
export function createEditorApi(
  api: RemoteApi,
  describe: () => Promise<SettingsJoin> = () => describeNamespace(api),
  stage?: (
    route: string,
    modelId: string,
    efforts: ReasoningEfforts | false | undefined,
    compat?: CompatSuggestion,
  ) => void,
): EffortEditorApi {
  return {
    async suggest(route, modelId, name, stagedFacts) {
      const providers = providersOf((await describe()).namespace)
      const stored = routeFactsOf(providers, route)
      // A saved route's stored profile is authoritative; the staged facts only
      // fill what the settings document does not hold yet (the create card).
      const facts = {
        api: stored.api ?? stagedFacts?.api,
        baseURL: stored.baseURL ?? stagedFacts?.baseURL,
        displayName: name ?? stored.displayName,
      }
      // L1 first: the endpoint's own word about this model. The fusion in
      // suggestEfforts keeps wire values knowledge-base-only. A staged route
      // cannot be probed (the host resolves routes from the settings), so the
      // signal stays 'unknown' until the route is saved.
      const endpoint = await probeEndpoint(route, modelId)
      const suggestion = suggestEfforts(modelId, facts, endpoint)
      if (suggestion.efforts === undefined) return { ok: false, error: 'no-suggestion' }
      return {
        ok: true,
        suggestion: {
          efforts: suggestion.efforts,
          // The host autofill writes the suggestion's compat block beside the
          // declaration; the browser seam must write the SAME bytes so one
          // suggestion never produces two different documents. (thinkingFormat
          // is what makes off/thinking dispatch work on deepseek/qwen/zai
          // endpoints.)
          ...(suggestion.compat === undefined ? {} : { compat: suggestion.compat }),
          matched: suggestion.matched,
          source: suggestion.source,
          confidence: suggestion.confidence,
          ...(suggestion.endpoint === undefined ? {} : { endpoint: suggestion.endpoint }),
        },
      }
    },
    stageEfforts(route, modelId, efforts, compat) {
      stage?.(route, modelId, efforts, compat)
    },
    async writeEfforts(route, modelId, efforts, compat) {
      // Retry once on a revision conflict: a concurrent writer (this plugin's
      // own autofill, or the official page) moved the namespace between our
      // describe and mutate. Re-reading and retrying with the fresh revision
      // is the same recovery the official settings form uses; anything else
      // surfaces as-is.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const join = await describe()
          if (join.namespace === undefined) return { ok: false, error: 'no-namespace' }
          const providers = providersOf(join.namespace)
          // The write rebuilds the models array verbatim; a row this code
          // cannot represent must refuse the write rather than silently
          // drop the row.
          const rawModels = providers[route]?.['models']
          if (!Array.isArray(rawModels)) return { ok: false, error: 'model-not-found' }
          if (!rawModels.every(isRecord)) return { ok: false, error: 'invalid-models' }
          const models = rawModels as Record<string, unknown>[]
          const index = models.findIndex(model => model['id'] === modelId)
          if (index < 0) return { ok: false, error: 'model-not-found' }
          const nextModels = models.map((model, at) => {
            if (at !== index) return model
            const copy = { ...model }
            if (efforts === undefined) {
              // Unset the declaration durably: the marker records the absence
              // as a decision, so the host's auto-fill never reads it back as
              // a gap to fill — not now, and not after the next restart.
              delete copy['reasoningEfforts']
              copy[UNSET_MARKER] = true
            } else {
              // A real declaration supersedes any earlier unset marker.
              delete copy[UNSET_MARKER]
              if (efforts === false) {
                copy['reasoningEfforts'] = false
              } else {
                copy['reasoningEfforts'] = { ...efforts }
                // The compat belongs to the declaration: write it only when
                // one was supplied (a hand-tuned compat already in the
                // document survives a declaration edit that carries none).
                if (compat !== undefined) copy['compat'] = { ...compat }
              }
            }
            return copy
          })
          const response = await api.settings.mutate({
            ns: PI_AI_NS,
            ops: [{ op: 'set', path: ['providers', route, 'models'], value: nextModels }],
            expectedRevision: join.namespace.revision,
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

/**
 * Describe the pi-ai namespace plus writability through the settings Remote.
 * The single describe seam for the browser half: both the injector's scan
 * join and the editor's write seam read through it.
 */
export async function describeNamespace(api: RemoteApi): Promise<SettingsJoin> {
  const response = await api.settings.describe({})
  if (!response.result.ok) return { namespace: undefined, writable: false }
  const namespace = response.result.value.namespaces.find(ns => ns.ns === PI_AI_NS)
  return { namespace, writable: response.result.value.writable }
}
