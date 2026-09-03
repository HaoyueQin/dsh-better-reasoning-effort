/**
 * The DOM bypass injector: the piece that makes reasoning effort editable
 * *inside* the official Models page's model rows.
 *
 * The official Models-page slot contract's two sanctioned seats are both
 * coarser than a model row: `settings.models.provider-card` (keyed, since
 * 0.1.2-alpha.1) renders per provider card and `settings.models.footer`
 * renders after the rows — neither reaches a single model row's editor
 * internals, so this plugin mounts its editor as a DOM contribution next to
 * the official per-model capacity disclosure. The anchor is the official
 * "Capacities" (容量) chevron
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

import { INPUT_UNSET_MARKER, PLUGIN_ID, UNSET_MARKER } from '../constants.js'
import { suggestEfforts, type CompatSuggestion, type InputModalities, type ReasoningEfforts } from '../knowledge.js'
import { modelsOf, routeFactsOf } from '../shared.js'
import { sameEfforts } from './effort.js'
import { createEditorApi, describeNamespace, effortsOf, inputOf, nameOf, providersOf } from './ops.js'
import type { EffortEditorApi, EffortWriteIntent, RemoteApi, SettingsJoin } from './types.js'

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

/**
 * Localized aria-labels of the official settings controls this injector
 * anchors to, in the language the host is currently rendering.
 *
 * The host renders these labels from its own `settings.models` dictionary
 * (`ui-settings-models`), so the plugin must read them through the same
 * channel instead of pinning the two languages it knows about: a host
 * language pack that adds, say, Japanese would otherwise relabel every
 * control and leave the injector unable to find a single model row. Each
 * field carries the active language first and English last — English is the
 * host's own fallback floor, so it doubles as ours.
 *
 * Every field is a LIST because the official labels are numbered per row
 * ("Model ID 1", "モデル ID 2", …) and are matched by prefix.
 */
export interface HostLabels {
  /** The per-row disclosure button ("Capacities", "容量", …). */
  capacity: readonly string[]
  /** The model-id input. */
  modelId: readonly string[]
  /** The per-row display-name input. */
  modelName: readonly string[]
  /** The create card's route-id input. */
  routeId: readonly string[]
  /** The create card's endpoint input. */
  baseUrl: readonly string[]
  /** The create card's protocol select. */
  apiProtocol: readonly string[]
}

/** A row's identity as found on the page, resolved from the settings join. */
interface FoundModel {
  /** The official disclosure container that holds the capacity fields. */
  container: HTMLElement
  /** The trigger's OWN model row element (row-scoped input reads). */
  row: HTMLElement
  /** The model id read from the row's "Model ID" input. */
  modelId: string
  /** The nearest card element (for route resolution). */
  card: HTMLElement
}

/** The join the injector renders from. */
export interface InjectorDeps {
  /**
   * The settings Remote face for THIS scan/write. The rc.1 kernel mounts
   * `remote.settings` as an injectable service, so the plugin's own top-level
   * `inject` declaration guarantees it before apply runs — no runtime seat
   * probing remains.
   */
  api: RemoteApi
  /** Read the pi-ai namespace plus writability from the settings join. */
  describeNamespace(): Promise<SettingsJoin>
  /** Localized copy. */
  t: (key: string, params?: Record<string, string | number>) => string
  /**
   * The official controls' aria-labels in the ACTIVE language. A thunk, not a
   * value: the host resolves labels through the same fallback chain it renders
   * from, so re-reading per scan is what keeps a language switch (and a late
   * language pack) in step with the page it has to find controls on.
   */
  labels(): HostLabels
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
  /** The model's current input-modality declaration. */
  input?: InputModalities
  /** Row ordinal among the models found in this scan (for aria labels). */
  index: number
  /** True while the row is unsaved (a create card's draft route, or a new
   * model row on a saved route): Apply stages the declaration instead of
   * writing, and the injector lands it once the row is saved. */
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
  /**
   * Staged models that looked ghosted on the last scan (their route is saved,
   * but no matching row exists on the page anymore). Withdrawn once they miss
   * TWO consecutive scans, so one transient re-render gap cannot drop real
   * mid-edit staging. Mirrors {@link pending}'s key shape.
   */
  missedScans: Map<string, Set<string>>
}

/**
 * One staged declaration: the level set plus the suggestion's compat block and
 * modalities. A 'keep' effort travels untouched to the flush write.
 *
 * Design note: staging cannot express a deliberate UNSET. An all-clear draft
 * stages `keep`/no-input, whose flush resolves to null and withdraws the
 * whole staging -- host autofill then fills its suggestion back in. To record
 * "declare nothing" durably, save the row first and apply an all-clear write
 * through the saved-row seam (the durable unset marker).
 */
export interface StagedDeclaration {
  efforts: Exclude<EffortWriteIntent, undefined>
  compat?: CompatSuggestion
  input?: InputModalities
}

export function createScanState(): ScanState {
  return {
    mounted: new Map(),
    describePromise: undefined,
    pending: new Map(),
    missedScans: new Map(),
  }
}

/**
 * Record (or, for `undefined`, withdraw) one staged declaration. A route with
 * no staged models left leaves the store entirely.
 */
export function stageEffortsInto(
  state: ScanState,
  route: string,
  modelId: string,
  efforts: EffortWriteIntent,
  compat?: CompatSuggestion,
  input?: InputModalities,
): void {
  const models = state.pending.get(route)
  if (efforts === undefined) {
    if (models === undefined) return
    models.delete(modelId)
    if (models.size === 0) state.pending.delete(route)
    return
  }
  // 'keep' is storable: a modality-only staging must survive the flush as a
  // declaration that touches everything EXCEPT the ladder.
  state.pending.set(route, (models ?? new Map()).set(modelId, {
    efforts,
    ...(compat === undefined ? {} : { compat }),
    ...(input === undefined ? {} : { input }),
  }))
}

/**
 * The write intents one staged declaration survives against the SAVED row,
 * decided PER PART: staging never overwrites what the document already says,
 * but a part the document took over must not silence its sibling. Returns
 * null when nothing is left to write (the model vanished from the card, or
 * every part was taken over / is a keep) -- the caller withdraws the staging.
 */
export interface EffectiveStagedIntents {
  efforts: EffortWriteIntent
  compat?: CompatSuggestion
  input?: InputModalities
}

export function effectiveStagedIntents(
  declaration: StagedDeclaration,
  current: Record<string, unknown> | undefined,
  autofill?: AutofillFootprint,
): EffectiveStagedIntents | null {
  if (current === undefined) return null
  // Ladder part: a declaration or a deliberate-unset marker on the row owns
  // it — EXCEPT when the declaration is byte-identical to what this plugin's
  // own host autofill writes for the model (the knowledge base proposal it
  // lays down in the route-creation window). Those bytes are a suggestion,
  // not a user decision, so a staged intent outranks them; anything else
  // (a hand-tuned ladder, a marker) is a real takeover. 'keep' means the
  // staging never carried the ladder anyway.
  const ladderAutofilled =
    current[UNSET_MARKER] !== true
    && autofill?.efforts !== undefined
    && sameEffortsValue(current['reasoningEfforts'], autofill.efforts)
  const ladderTaken = ladderAutofilled
    ? false
    : current['reasoningEfforts'] !== undefined
      || current[UNSET_MARKER] === true
      || declaration.efforts === 'keep'
  // Modality part: same rule — the autofill's knowledge-base disclosure does
  // not answer over a staged choice; a hand-made or differing one does.
  const inputAutofilled =
    current[INPUT_UNSET_MARKER] !== true
    && autofill?.input !== undefined
    && sameInputList(current['input'], autofill.input)
  const inputTaken = inputAutofilled
    ? false
    : (Array.isArray(current['input']) && current['input'].length > 0)
      || current[INPUT_UNSET_MARKER] === true
  const efforts: EffortWriteIntent = ladderTaken ? 'keep' : declaration.efforts
  const input = inputTaken ? undefined : declaration.input
  if (efforts === 'keep' && input === undefined) return null
  return {
    efforts,
    ...(declaration.compat === undefined ? {} : { compat: declaration.compat }),
    ...(input === undefined ? {} : { input }),
  }
}

/** What this plugin's host autofill would write for one model, as the flush compares it. */
export interface AutofillFootprint {
  efforts?: ReasoningEfforts | false
  input?: InputModalities
}

/** Semantic equality of two reasoningEfforts dict values (key set + wire strings). */
function sameEffortsValue(a: unknown, b: ReasoningEfforts | false): boolean {
  if (a === b) return true
  if (!isRecordValue(a) || typeof b !== 'object' || b === null || Array.isArray(b)) return false
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key])
}

/** Semantic equality of a raw input value with a modality list (order-insensitive). */
function sameInputList(a: unknown, b: InputModalities): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false
  const set = new Set<string>(b)
  return a.every(member => typeof member === 'string' && set.has(member))
}

/** Plain-object guard local to this module (shared.ts's isRecord stays host/client-neutral). */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Flush staged declarations for routes that now exist, writing each model's
 * declaration through the live write seam. A model the saved profile does not
 * carry yet keeps its staging (the row may still be mid-creation -- the user
 * edits the card after staging -- and the declaration lands whenever the row
 * first appears); each PART is decided against the saved row via
 * {@link effectiveStagedIntents}, with the host autofill's knowledge-base
 * footprint passed in so the plugin's own proposal never outranks a staged
 * user intent. A write that still fails (conflict retry exhausted) stays
 * staged; the write's own document-updated invalidation re-scans and
 * re-flushes it.
 */
async function flushRoute(
  deps: InjectorDeps,
  state: ScanState,
  route: string,
  models: ReadonlyMap<string, StagedDeclaration>,
): Promise<void> {
  // Snapshot: stageEffortsInto below mutates the stored map as writes land.
  for (const [modelId, declaration] of [...models]) {
    const join = await deps.describeNamespace()
    const providers = providersOf(join.namespace)
    const current = modelsOf(providers, route).find(model => model['id'] === modelId)
    // The row is not saved yet (mid-edit card, or the user renamed it):
    // keep the staging instead of dropping it -- it lands when a row with
    // this id first appears; the scan's ghost pass withdraws staging whose
    // row is provably gone.
    if (current === undefined) continue
    // A concurrent scan may have withdrawn this staging while our describe
    // was in flight (the two-scan ghost pass): writing it anyway would
    // resurrect a declaration nothing on the page owns anymore.
    if (state.pending.get(route)?.get(modelId) !== declaration) continue
    // Mirror the host autofill's suggestion for this exact row (same facts,
    // same knowledge base) so {@link effectiveStagedIntents} can tell the
    // plugin's own proposal apart from a user decision.
    const routeInfo = routeFactsOf(providers, route)
    const name = typeof current['name'] === 'string' ? current['name'] : undefined
    const suggestion = suggestEfforts(modelId, name === undefined ? routeInfo : { ...routeInfo, displayName: name })
    const effective = effectiveStagedIntents(declaration, current, {
      ...(suggestion.efforts === undefined ? {} : { efforts: suggestion.efforts }),
      ...(suggestion.input === undefined ? {} : { input: suggestion.input }),
    })
    if (effective === null) {
      stageEffortsInto(state, route, modelId, undefined)
      continue
    }
    // Seed the write's FIRST describe attempt with the join this loop
    // already read — one wire read per model instead of two. A conflict
    // retry re-describes fresh through the live seam, so the seed never
    // costs the write its recovery path.
    let seeded = false
    const seededApi = createEditorApi(deps.api, () => {
      if (!seeded) {
        seeded = true
        return Promise.resolve(join)
      }
      return describeNamespace(deps.api)
    })
    const reply = await seededApi.writeEfforts(route, modelId, effective.efforts, effective.compat, effective.input)
    if (reply.ok || reply.error === 'model-not-found') {
      stageEffortsInto(state, route, modelId, undefined)
    } else {
      // Anything else keeps the staging (the next scan retries it), but a
      // silent keep is unobservable -- surface the failure for diagnostics.
      console.error(`[bre] staged flush write failed for "${route}"/"${modelId}": ${reply.error}`)
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
  return container.querySelector(`[data-plugin="${PLUGIN_ID}"]`) !== null
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
    && sameInput(a.input, b.input)
}

/** Semantic equality of two modality declarations (order-insensitive). */
function sameInput(a: InputModalities | undefined, b: InputModalities | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  const setA = new Set(a)
  return a.length === b.length && b.every(item => setA.has(item))
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
  labels: HostLabels,
): { route: string; staged: boolean } | undefined {
  const key = card.querySelector<HTMLElement>('[class*="editorRoute"]')?.textContent?.trim()
  if (key !== undefined && key.length > 0 && hasOwn(providers, key)) return { route: key, staged: false }
  if (hasLabeledInput(card, labels.routeId)) {
    const typed = inputValueByLabel(card, labels.routeId)
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
  // Cheap DOM gate BEFORE the wire read: most mutations in a running app
  // (chat streaming, typing anywhere) fire while no model row exists at
  // all. One prefix query per locale answers "is the Models page here?" —
  // when it is not and nothing is mounted, the scan costs nothing more.
  if (!root.isConnected) return
  // One label read per scan, taken before the cheap DOM gate below: the gate
  // itself matches on them, and reading lazily is what keeps a language switch
  // in step with the page (the labels the host renders change with it).
  const labels = deps.labels()
  const hasCapacityRows = labels.capacity.some(aria =>
    root.querySelector(`button[aria-label^="${aria}"]`) !== null)
  if (!hasCapacityRows) {
    if (state.mounted.size > 0) {
      for (const [, entry] of state.mounted) entry.editor.unmount()
      state.mounted.clear()
    }
    return
  }
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
    for (const aria of labels.capacity) {
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
        const modelId = inputValueByLabel(row, labels.modelId)
        if (modelId.length === 0) continue
        found.push({ container, row, modelId, card })
      }
    }

    // Unmount editors whose rows are gone (the page re-rendered).
    for (const [key, entry] of state.mounted) {
      if (!found.some(candidate => candidate.container === key)) {
        entry.editor.unmount()
        state.mounted.delete(key)
      }
    }

    // Ghosted staging: the route IS saved but its staged model row is no
    // longer anywhere on the page (renamed away, or the row/card deleted).
    // One missing scan can be a transient re-render gap, so staging is
    // withdrawn only after missing TWO consecutive scans; routes that do not
    // exist yet are never touched here -- an open create card still owns those.
    if (state.pending.size > 0) {
      const onPage = new Map<string, Set<string>>()
      for (const target of found) {
        const resolved = routeOfCard(target.card, providers, labels)
        if (resolved === undefined) continue
        let ids = onPage.get(resolved.route)
        if (ids === undefined) onPage.set(resolved.route, ids = new Set())
        ids.add(target.modelId)
      }
      const missing = new Map<string, Set<string>>()
      for (const [route, models] of state.pending) {
        if (!hasOwn(providers, route)) continue
        const present = onPage.get(route)
        const stale = [...models.keys()].filter(id => !present?.has(id))
        if (stale.length > 0) missing.set(route, new Set(stale))
      }
      for (const [route, ids] of missing) {
        const prior = state.missedScans.get(route)
        if (prior === undefined) continue
        for (const id of ids) {
          if (!prior.has(id)) continue
          stageEffortsInto(state, route, id, undefined)
          prior.delete(id)
        }
      }
      state.missedScans = missing
    }

    found.forEach((target, index) => {
      const resolved = routeOfCard(target.card, providers, labels)
      if (resolved === undefined) return
      const { route, staged: routeStaged } = resolved
      const profile = providers[route] ?? {}
      const models = modelsOf(providers, route)
      // Staged covers TWO unsaved shapes: the create card's draft route, and
      // a typed-but-unsaved model row on a SAVED route. Writing the latter
      // would bounce model-not-found (the row is not in the document yet);
      // staging rides the same flush-on-save path as the create card.
      const staged = routeStaged || !models.some(model => model['id'] === target.modelId)
      // A staged row's baseline is the pending store (the settings document
      // holds nothing for the model yet); the create card's typed protocol
      // and endpoint stand in for the stored profile facts, both for the
      // editor's display and for suggestion inference.
      const stagedEfforts = staged ? state.pending.get(route)?.get(target.modelId)?.efforts : undefined
      const efforts = staged
        ? (stagedEfforts === 'keep' ? undefined : stagedEfforts)
        : effortsOf(models, target.modelId)
      const input = staged
        ? state.pending.get(route)?.get(target.modelId)?.input
        : inputOf(models, target.modelId)
      // An unsaved row has no stored declaration to name it, but the user may
      // have typed a Display name on the row already -- suggestion inference
      // and knowledge-base matching lose that signal without it. The read is
      // ROW-scoped (the same multi-row trap the model id above avoids).
      const typedName = staged ? inputValueByLabel(target.row, labels.modelName) : ''
      const modelName = staged ? (typedName.length > 0 ? typedName : undefined) : nameOf(models, target.modelId)
      const typedApi = routeStaged ? inputValueByLabel(target.card, labels.apiProtocol) : ''
      const typedBaseURL = routeStaged ? inputValueByLabel(target.card, labels.baseUrl) : ''
      const routeApi = routeStaged && typedApi.length > 0
        ? typedApi
        : typeof profile['api'] === 'string' ? profile['api'] as string : undefined
      const routeBaseURL = routeStaged && typedBaseURL.length > 0
        ? typedBaseURL
        : typeof profile['baseURL'] === 'string' ? profile['baseURL'] as string : undefined
      // The editor's write seam reads the namespace LIVE through its own
      // describe (not this scan's snapshot): a conflict retry must re-read a
      // fresh revision to have any chance of succeeding. Staged rows stage
      // into this scan state's pending store instead of writing settings.
      const next: EditorMountProps = {
        route,
        routeDisplayName: routeStaged ? route : typeof profile['displayName'] === 'string' ? profile['displayName'] as string : route,
        ...routeApi === undefined ? {} : { routeApi },
        ...routeBaseURL === undefined ? {} : { routeBaseURL },
        modelId: target.modelId,
        ...modelName === undefined ? {} : { modelName },
        ...efforts === undefined ? {} : { efforts },
        ...input === undefined ? {} : { input },
        index,
        staged,
        api: createEditorApi(deps.api, undefined, (r, m, e, c, i) => { stageEffortsInto(state, r, m, e, c, i) }),
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
