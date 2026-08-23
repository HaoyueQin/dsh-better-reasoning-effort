/**
 * The DOM bypass injector: the piece that makes reasoning effort editable
 * *inside* the official Models page's model rows.
 *
 * The official settings slot contract exposes no seam into the Models page's
 * editor internals (there is no `settings.model.*` slot), so this plugin
 * mounts its editor as a DOM contribution next to the official per-model
 * capacity disclosure. The anchor is the official "Capacities" (容量) chevron
 * button, found by aria-label in both locales; the editor is inserted into the
 * same disclosure container that holds the official context-window / max
 * tokens fields.
 *
 * Because this walks the official page's rendered DOM (class names and
 * structure that the harness can change), the injector is defensive by
 * construction:
 *   - it re-scans on every DOM mutation (a routed page, an open editor, an
 *     applied form all re-render), and every scan reconciles idempotently;
 *   - a model row that carries no disclosure yet is left alone and picked up
 *     on the next mutation;
 *   - if the official structure it depends on ever stops appearing, it simply
 *     stops injecting — the settings page remains untouched.
 *
 * @module dsh-better-reasoning-effort/injector
 */

import { PLUGIN_MARKER, UNSET_MARKER } from '../constants.js'
import type { CompatSuggestion, ReasoningEfforts } from '../knowledge.js'
import { modelsOf } from '../shared.js'
import { sameEfforts } from './effort.js'
import { createEditorApi, effortsOf, nameOf, providersOf } from './ops.js'
import type { EffortEditorApi, RemoteApi, SettingsJoin } from './types.js'

export type { SettingsJoin }

/**
 * Own-property membership over the providers dict. Plain `in` would answer
 * true for inherited names ('constructor', 'toString', '__proto__'…), so a
 * route typed as one of those in the create card would resolve against
 * prototype members instead of being treated as unsaved.
 */
function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/** Localized aria-labels that identify the official disclosure buttons. */
const CAPACITY_ARIA = ['Capacities', '容量']

/** Official aria-labels of the model-id input, in both locales. */
const MODEL_ID_ARIA = ['Model ID', '模型 ID']

/** Official aria-label of the create card's route-id input (same in both locales). */
const ROUTE_ID_ARIA = ['Provider ID']

/** Official aria-labels of the create card's endpoint and protocol fields. */
const BASE_URL_ARIA = ['Base URL', 'API 地址']
const API_PROTOCOL_ARIA = ['API protocol', 'API 协议']

/** A row's identity as found on the page, resolved from the settings join. */
interface FoundModel {
  /** The official disclosure container that holds the capacity fields. */
  container: HTMLElement
  /** The model id read from the row's "Model ID" input. */
  modelId: string
  /** The nearest card element (for route resolution). */
  card: HTMLElement
}

/** The join the injector renders from. */
export interface InjectorDeps {
  /** settings Remote face. */
  api: RemoteApi
  /** Read the pi-ai namespace plus writability from the settings join. */
  describeNamespace(): Promise<SettingsJoin>
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
  /** Mount one editor into a container (React); render() updates its props in place. */
  mount(container: HTMLElement, props: EditorMountProps): MountedEditor
}

/** One mounted editor: unmount disposes the React root; render swaps props in place. */
export interface MountedEditor {
  unmount(): void
  render(props: EditorMountProps): void
}

/** Props handed to the editor mount for one model row. */
export interface EditorMountProps {
  /** The route being edited. */
  route: string
  /** Route display name (shown in the editor header). */
  routeDisplayName: string
  /** Route wire protocol, when configured. */
  routeApi?: string
  /** Route endpoint, when configured. */
  routeBaseURL?: string
  /** Model id. */
  modelId: string
  /** Model display name, when one is set. */
  modelName?: string
  /** The model's current reasoningEfforts declaration. */
  efforts?: false | ReasoningEfforts
  /** Row ordinal among the models found in this scan (for aria labels). */
  index: number
  /** True on a create card: Apply stages the declaration instead of writing. */
  staged?: boolean
  api: EffortEditorApi
  readOnly: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

/** Mutable scan state kept across reconcile invocations. */
export interface ScanState {
  /** Currently mounted editors, keyed by their container element. */
  mounted: Map<HTMLElement, { editor: MountedEditor; props: EditorMountProps }>
  /** The last describe promise, folded so scans never stack reads. */
  describePromise: Promise<SettingsJoin> | undefined
  /**
   * Declarations staged against routes that do not exist in the settings
   * document yet (the create card's typed route id), keyed route → model id.
   * Flushed automatically once a route appears; lives only in memory, so it
   * dies with the plugin fiber.
   */
  pending: Map<string, Map<string, StagedDeclaration>>
}

/** One staged declaration: the level set plus the suggestion's compat block. */
export interface StagedDeclaration {
  efforts: ReasoningEfforts | false
  compat?: CompatSuggestion
}

export function createScanState(): ScanState {
  return { mounted: new Map(), describePromise: undefined, pending: new Map() }
}

/**
 * Record (or, for `undefined`, withdraw) one staged declaration. A route with
 * no staged models left leaves the store entirely.
 */
export function stageEffortsInto(
  state: ScanState,
  route: string,
  modelId: string,
  efforts: ReasoningEfforts | false | undefined,
  compat?: CompatSuggestion,
): void {
  const models = state.pending.get(route)
  if (efforts === undefined) {
    if (models === undefined) return
    models.delete(modelId)
    if (models.size === 0) state.pending.delete(route)
    return
  }
  state.pending.set(route, (models ?? new Map()).set(modelId, {
    efforts,
    ...(compat === undefined ? {} : { compat }),
  }))
}

/**
 * Flush staged declarations for routes that now exist, writing each model's
 * declaration through the live write seam. A model the saved profile does not
 * carry is dropped (the create card's final rows are the truth); a model with
 * a declaration already present — or an unset marker — is skipped: staging
 * never overwrites what the document already says. A write that still fails
 * (conflict retry exhausted) stays staged; the write's own document-updated
 * invalidation re-scans and re-flushes it.
 */
async function flushRoute(
  deps: InjectorDeps,
  state: ScanState,
  route: string,
  models: ReadonlyMap<string, StagedDeclaration>,
): Promise<void> {
  const api = createEditorApi(deps.api)
  // Snapshot: stageEffortsInto below mutates the stored map as writes land.
  for (const [modelId, declaration] of [...models]) {
    const join = await deps.describeNamespace()
    const providers = providersOf(join.namespace)
    const current = modelsOf(providers, route).find(model => model['id'] === modelId)
    if (current === undefined || current['reasoningEfforts'] !== undefined || current[UNSET_MARKER] === true) {
      stageEffortsInto(state, route, modelId, undefined)
      continue
    }
    const reply = await api.writeEfforts(route, modelId, declaration.efforts, declaration.compat)
    if (reply.ok || reply.error === 'model-not-found') {
      stageEffortsInto(state, route, modelId, undefined)
    }
  }
}

/** Find the first input/select whose aria-label starts with one of the labels. */
function inputValueByLabel(card: HTMLElement, labels: readonly string[]): string {
  for (const label of labels) {
    const input = Array.from(card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[aria-label], select[aria-label]'))
      .find(candidate => (candidate.getAttribute('aria-label') ?? '').startsWith(label))
    if (input !== undefined && input.value.trim().length > 0) return input.value.trim()
  }
  return ''
}

/** The nearest editor card element of a trigger. */
function cardOf(trigger: HTMLButtonElement): HTMLElement | undefined {
  return trigger.closest<HTMLElement>('[class*="editor"], [class*="rowCard"], [class*="addCard"]') ?? undefined
}

/** The official per-row disclosure container (holds the capacity fields). */
function disclosureOf(trigger: HTMLButtonElement): HTMLElement | undefined {
  // The disclosure lives inside the trigger's own model row, not elsewhere in
  // the card: scoping to the row keeps each trigger's container distinct even
  // when several rows are expanded at once.
  const row = trigger.closest<HTMLElement>('[class*="modelEntry"]')
  if (row === null) {
    // Fall back to the card scope (stale or unusual structure).
    const card = cardOf(trigger)
    if (card === undefined) return undefined
    const candidates = Array.from(card.querySelectorAll<HTMLElement>('[class*="modelAdvanced"]'))
    return candidates.find(candidate => candidate.offsetParent !== null) ?? candidates[0]
  }
  const candidates = Array.from(row.querySelectorAll<HTMLElement>('[class*="modelAdvanced"]'))
  return candidates.find(candidate => candidate.offsetParent !== null) ?? candidates[0]
}

/** Whether an editor is already mounted in a container (idempotency guard). */
function hasEditor(container: HTMLElement): boolean {
  return container.querySelector(`[data-plugin="${PLUGIN_MARKER}"]`) !== null
}

/**
 * Semantic equality of two mount-prop sets, so a scan only re-renders an
 * existing editor when the settings document actually moved under it. The
 * guard is what makes refresh safe under the MutationObserver: render mutates
 * DOM, DOM mutations schedule scans, and a no-op comparison ends the cycle.
 */
function sameProps(a: EditorMountProps, b: EditorMountProps): boolean {
  return a.route === b.route
    && a.routeDisplayName === b.routeDisplayName
    && a.routeApi === b.routeApi
    && a.routeBaseURL === b.routeBaseURL
    && a.modelId === b.modelId
    && a.modelName === b.modelName
    && a.index === b.index
    && a.readOnly === b.readOnly
    // A create card's container surviving its own save must flip the editor
    // to write mode: staged changes the Apply button's whole contract, so it
    // participates in the diff like any other prop.
    && a.staged === b.staged
    && sameEfforts(a.efforts, b.efforts)
}

/** Whether the card carries any input/select labeled with one of the labels. */
function hasLabeledInput(card: HTMLElement, labels: readonly string[]): boolean {
  return Array.from(card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[aria-label], select[aria-label]'))
    .some(candidate => labels.some(label => (candidate.getAttribute('aria-label') ?? '').startsWith(label)))
}

/**
 * The route token of a card, resolved against the joined providers. The
 * official edit card prints the route key as the `.editorRoute` tag next to
 * the display-name title; the create card prints a fixed heading with no key,
 * but its "Provider ID" input carries the route id being chosen — a route not
 * in the settings document yet. Match the key first (exact, unambiguous),
 * then the create card's typed id, then the display name (a create card never
 * reaches the name arm: its Provider ID input marks it, and its fixed heading
 * could otherwise collide with a provider's display name).
 */
function routeOfCard(
  card: HTMLElement,
  providers: Record<string, Record<string, unknown>>,
): { route: string; staged: boolean } | undefined {
  const key = card.querySelector<HTMLElement>('[class*="editorRoute"]')?.textContent?.trim()
  if (key !== undefined && key.length > 0 && hasOwn(providers, key)) return { route: key, staged: false }
  if (hasLabeledInput(card, ROUTE_ID_ARIA)) {
    const typed = inputValueByLabel(card, ROUTE_ID_ARIA)
    return typed.length > 0 && !hasOwn(providers, typed) ? { route: typed, staged: true } : undefined
  }
  const title = card.querySelector<HTMLElement>('[class*="editorTitle"], [class*="rowName"]')?.textContent?.trim()
  if (title === undefined || title.length === 0) return undefined
  const byName = Object.entries(providers).find(([, profile]) => profile['displayName'] === title)
  return byName === undefined ? undefined : { route: byName[0], staged: false }
}

/**
 * Scan the settings DOM for official model rows and reconcile the injected
 * editors. Idempotent: existing editors are left alone, new disclosures get
 * one, and removed ones are unmounted.
 * @param root - the settings panel root to scan.
 * @param deps - the injection dependencies.
 * @param state - mutable scan state shared across invocations.
 */
export function reconcile(root: HTMLElement, deps: InjectorDeps, state: ScanState): void {
  // Fold the describe request across scans (one wire read per wave). A
  // promise's .then ALWAYS runs asynchronously (microtask), even when already
  // resolved — the fold just keeps concurrent scans from stacking wire reads.
  // The holder clears this field on rejection (retry the read next scan) and
  // on pushed invalidations (settings/document-updated, connection/reset —
  // see apply()), so a stale snapshot never outlives the change that made it
  // stale.
  state.describePromise ??= deps.describeNamespace()
  const run = (join: SettingsJoin): void => {
    if (!root.isConnected) return
    const namespace = join.namespace
    const providers = providersOf(namespace)

    // Staged declarations whose route has appeared (the create card's save
    // landed) are written before the editors render, so the edit card's
    // editor mounts over the declaration the user staged, not over a gap.
    // flushRoute drops each model as it lands and keeps failed ones staged;
    // a concurrent re-scan re-flushing the same route self-heals — the
    // second pass sees the first pass's declaration and skips.
    if (join.writable === true) {
      for (const [route, models] of state.pending) {
        // An emptied entry can only ever be skipped again — drop it instead
        // of rescanning it on every future pass.
        if (models.size === 0) {
          state.pending.delete(route)
          continue
        }
        if (!hasOwn(providers, route)) continue
        // flushRoute reads the wire through the live describe seam; a
        // transport failure there rejects, and a bare `void` would surface
        // as an unhandled promise rejection. The staged declarations stay
        // staged, and the next scan retries — logging is all the failure
        // owes the user.
        void flushRoute(deps, state, route, models).catch((error: unknown) => {
          console.error(`[bre] staged flush failed for "${route}": ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }

    const found: FoundModel[] = []
    for (const aria of CAPACITY_ARIA) {
      // The official disclosure buttons carry a numbered aria-label
      // ("Capacities 1", "容量 2", …), so match by prefix.
      const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
        .filter(button => (button.getAttribute('aria-label') ?? '').startsWith(aria))
      for (const trigger of triggers) {
        const container = disclosureOf(trigger)
        if (container === undefined) continue
        const card = cardOf(trigger)
        if (card === undefined) continue
        // The model id lives on the trigger's OWN row, not elsewhere in the
        // card: reading the card would return the first row's id for every
        // trigger once more than one model is present.
        const row = trigger.closest<HTMLElement>('[class*="modelEntry"]') ?? card
        const modelId = inputValueByLabel(row, MODEL_ID_ARIA)
        if (modelId.length === 0) continue
        found.push({ container, modelId, card })
      }
    }

    // Unmount editors whose rows are gone (the page re-rendered).
    for (const [key, entry] of state.mounted) {
      if (!found.some(candidate => candidate.container === key)) {
        entry.editor.unmount()
        state.mounted.delete(key)
      }
    }

    found.forEach((target, index) => {
      const resolved = routeOfCard(target.card, providers)
      if (resolved === undefined) return
      const { route, staged } = resolved
      const profile = providers[route] ?? {}
      const models = modelsOf(providers, route)
      // A staged row's baseline is the pending store (the settings document
      // holds nothing for the route yet); the create card's typed protocol
      // and endpoint stand in for the stored profile facts, both for the
      // editor's display and for suggestion inference.
      const efforts = staged
        ? state.pending.get(route)?.get(target.modelId)?.efforts
        : effortsOf(models, target.modelId)
      const modelName = staged ? undefined : nameOf(models, target.modelId)
      const typedApi = staged ? inputValueByLabel(target.card, API_PROTOCOL_ARIA) : ''
      const typedBaseURL = staged ? inputValueByLabel(target.card, BASE_URL_ARIA) : ''
      const routeApi = staged && typedApi.length > 0
        ? typedApi
        : typeof profile['api'] === 'string' ? profile['api'] as string : undefined
      const routeBaseURL = staged && typedBaseURL.length > 0
        ? typedBaseURL
        : typeof profile['baseURL'] === 'string' ? profile['baseURL'] as string : undefined
      // The editor's write seam reads the namespace LIVE through its own
      // describe (not this scan's snapshot): a conflict retry must re-read a
      // fresh revision to have any chance of succeeding. Staged rows stage
      // into this scan state's pending store instead of writing settings.
      const next: EditorMountProps = {
        route,
        routeDisplayName: staged ? route : typeof profile['displayName'] === 'string' ? profile['displayName'] as string : route,
        ...routeApi === undefined ? {} : { routeApi },
        ...routeBaseURL === undefined ? {} : { routeBaseURL },
        modelId: target.modelId,
        ...modelName === undefined ? {} : { modelName },
        ...efforts === undefined ? {} : { efforts },
        index,
        staged,
        api: createEditorApi(deps.api, undefined, (r, m, e, c) => { stageEffortsInto(state, r, m, e, c) }),
        readOnly: join.writable !== true,
        t: deps.t,
      }
      const existing = state.mounted.get(target.container)
      if (existing !== undefined) {
        // The official page kept the container but moved the document under
        // it (an apply from this editor or elsewhere): swap the fresh props
        // in place so the editor never shows a stale saved declaration. The
        // sameProps guard keeps unchanged rows from re-rendering.
        if (!sameProps(existing.props, next)) {
          existing.props = next
          existing.editor.render(next)
        }
        return
      }
      if (hasEditor(target.container)) return
      const editor = deps.mount(target.container, next)
      state.mounted.set(target.container, { editor, props: next })
    })
  }
  // A rejected describe must not permanently disable the injector: clear the
  // folded promise so the next scan retries the read.
  void state.describePromise.then(run, () => {
    state.describePromise = undefined
  })
}
