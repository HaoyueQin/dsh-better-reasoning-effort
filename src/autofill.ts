/**
 * The knowledge-base auto-fill: build the settings patch that declares
 * `reasoningEfforts` -- and, unless declined, the input-modality declaration --
 * on every undeclared model of a providers dict.
 *
 * Shared by BOTH halves on purpose. The host builds its boot fill with it, and
 * the browser half builds the very same patch from its own read, so one
 * suggestion can never produce two different documents. Pure data logic: no
 * harness package, no node or DOM API.
 *
 * @module dsh-better-reasoning-effort/autofill
 */

import { AUTOFILL_MARKER, INPUT_UNSET_MARKER, UNSET_MARKER } from './constants.js'
import { isSelfHostedRelay, NEW_COMPAT_KEYS, suggestEfforts } from './knowledge.js'
import { isRecord, routeFactsOf } from './shared.js'

/** A JSON object patch. */
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
 * @param revision - settings revision this read is based on; recorded as the
 *   provenance marker of every ladder filled here (see {@link AUTOFILL_MARKER}).
 */
export function buildAutofillPatch(
  providers: unknown,
  routeFilter: (route: string) => boolean = () => true,
  options: { efforts?: boolean; modalities?: boolean } = {},
  revision = 0,
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
        // Versioned exception to never-touch-declared (issue #2): a declared
        // ladder whose compat lacks the role pin on a self-hosted relay gets
        // exactly that field merged in -- the declaration itself is untouched.
        const backfilled = backfillRolePin(model, providers, route)
        if (backfilled !== undefined) {
          changed = true
          nextModels.push(backfilled)
        } else {
          nextModels.push(model)
        }
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
        // Provenance: the browser flush has to be able to tell this knowledge
        // base suggestion apart from a declaration the user made, or a staged
        // intent that differs in one spelling is dropped as a takeover (see
        // AUTOFILL_MARKER). The value is the revision this fill read.
        fill[AUTOFILL_MARKER] = revision
        if (suggestion.compat !== undefined) {
          const stored = isRecord(model['compat']) ? (model['compat'] as JsonObject) : {}
          fill['compat'] = { ...stored, ...(suggestion.compat as JsonObject) }
        }
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

/** Strip newer-only compat keys from an autofill patch (older-kernel downgrade). */
export function stripNewCompatKeysDeep(patch: JsonObject): JsonObject | undefined {
  const providers = isRecord(patch['providers']) ? (patch['providers'] as JsonObject) : undefined
  if (providers === undefined) return undefined
  let strippedAny = false
  const nextProviders: JsonObject = {}
  for (const [route, profile] of Object.entries(providers)) {
    if (!isRecord(profile) || !Array.isArray(profile['models'])) {
      nextProviders[route] = profile as JsonObject
      continue
    }
    nextProviders[route] = {
      ...(profile as JsonObject),
      models: (profile['models'] as JsonObject[]).map(model => {
        if (!isRecord(model) || !isRecord(model['compat'])) return model
        const compat = { ...(model['compat'] as JsonObject) }
        for (const key of NEW_COMPAT_KEYS) {
          if (key in compat) {
            delete compat[key]
            strippedAny = true
          }
        }
        return { ...model, compat }
      }),
    }
  }
  if (!strippedAny) return undefined
  return { providers: nextProviders }
}

/**
 * Merge the role pin into one declared model row, or refuse it.
 *
 * Refusals (all silent, all deliberate): the row carries no ladder dict
 * (`false`, absent, or a deliberate-unset marker -- bare rows keep the bare
 * wire behavior they were chosen for); its compat already names an explicit
 * role value; or the route is not a self-hosted relay. A refusal changes
 * nothing; an acceptance touches exactly one compat field.
 */
function backfillRolePin(
  model: Record<string, unknown>,
  providers: unknown,
  route: string,
): JsonObject | undefined {
  if (!isRecord(model['reasoningEfforts'])) return undefined
  if (model[UNSET_MARKER] === true) return undefined
  const compat = model['compat']
  const base: JsonObject = isRecord(compat) ? { ...compat } : {}
  if (base['supportsDeveloperRole'] !== undefined) return undefined
  if (!isSelfHostedRelay(routeFactsOf(providers, route))) return undefined
  return { ...model, compat: { ...base, supportsDeveloperRole: false } }
}
