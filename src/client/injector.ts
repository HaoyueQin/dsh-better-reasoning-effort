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

import { PLUGIN_MARKER } from '../constants.js'
import type { ReasoningEfforts } from '../knowledge.js'
import { createEditorApi, effortsOf, modelsOf, nameOf, providersOf } from './ops.js'
import type { EffortEditorApi, RemoteApi, SettingsNamespaceView } from './types.js'

/** Localized aria-labels that identify the official disclosure buttons. */
const CAPACITY_ARIA = ['Capacities', '容量']

/** Official aria-labels of the model-id input, in both locales. */
const MODEL_ID_ARIA = ['Model ID', '模型 ID']

/** A row's identity as found on the page, resolved from the settings join. */
interface FoundModel {
  /** The official disclosure container that holds the capacity fields. */
  container: HTMLElement
  /** The model id read from the row's "Model ID" input. */
  modelId: string
  /** The nearest card element (for route resolution). */
  card: HTMLElement
}

/** The join the injector renders from: the pi-ai namespace plus writability. */
export interface SettingsJoin {
  /** The pi-ai namespace view, when registered. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
}

/** The join the injector renders from. */
export interface InjectorDeps {
  /** settings Remote face. */
  api: RemoteApi
  /** Read the pi-ai namespace plus writability from the settings join. */
  describeNamespace(): Promise<SettingsJoin>
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
  /** Mount one editor into a container (React); returns the unmount. */
  mount(container: HTMLElement, props: EditorMountProps): () => void
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
  api: EffortEditorApi
  readOnly: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

/** Mutable scan state kept across reconcile invocations. */
export interface ScanState {
  /** Currently mounted editors, keyed by their container element. */
  mounted: Map<HTMLElement, { unmount: () => void }>
  /** The last describe promise, folded so scans never stack reads. */
  describePromise: Promise<SettingsJoin> | undefined
}

export function createScanState(): ScanState {
  return { mounted: new Map(), describePromise: undefined }
}

/** Find the first input whose aria-label starts with one of the labels. */
function inputValueByLabel(card: HTMLElement, labels: readonly string[]): string {
  for (const label of labels) {
    const input = Array.from(card.querySelectorAll<HTMLInputElement>('input[aria-label]'))
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
 * The route token of a card, resolved against the joined providers. The
 * official edit card prints the route key as the `.editorRoute` tag next to
 * the display-name title; the create card prints a fixed heading with no key,
 * so nothing can resolve its route until it is saved and re-rendered as an
 * edit card. Match the key first (exact, unambiguous), then the display name.
 */
function routeOfCard(card: HTMLElement, providers: Record<string, Record<string, unknown>>): string | undefined {
  const key = card.querySelector<HTMLElement>('[class*="editorRoute"]')?.textContent?.trim()
  if (key !== undefined && key.length > 0 && key in providers) return key
  const title = card.querySelector<HTMLElement>('[class*="editorTitle"], [class*="rowName"]')?.textContent?.trim()
  if (title === undefined || title.length === 0) return undefined
  const byName = Object.entries(providers).find(([, profile]) => profile['displayName'] === title)
  return byName?.[0]
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
        entry.unmount()
        state.mounted.delete(key)
      }
    }

    found.forEach((target, index) => {
      if (hasEditor(target.container)) return
      const route = routeOfCard(target.card, providers)
      if (route === undefined) return
      const profile = providers[route] ?? {}
      const models = modelsOf(providers, route)
      const efforts = effortsOf(models, target.modelId)
      const modelName = nameOf(models, target.modelId)
      // The editor's write seam reads the namespace LIVE through its own
      // describe (not this scan's snapshot): a conflict retry must re-read a
      // fresh revision to have any chance of succeeding.
      const unmount = deps.mount(target.container, {
        route,
        routeDisplayName: typeof profile['displayName'] === 'string' ? profile['displayName'] as string : route,
        ...typeof profile['api'] === 'string' ? { routeApi: profile['api'] as string } : {},
        ...typeof profile['baseURL'] === 'string' ? { routeBaseURL: profile['baseURL'] as string } : {},
        modelId: target.modelId,
        ...modelName === undefined ? {} : { modelName },
        ...efforts === undefined ? {} : { efforts },
        index,
        api: createEditorApi(deps.api),
        readOnly: join.writable !== true,
        t: deps.t,
      })
      state.mounted.set(target.container, { unmount })
    })
  }
  // A rejected describe must not permanently disable the injector: clear the
  // folded promise so the next scan retries the read.
  void state.describePromise.then(run, () => {
    state.describePromise = undefined
  })
}
