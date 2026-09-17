/**
 * The DOM bypass injector: the piece that makes reasoning effort editable
 * *inside* the official Models page's model rows.
 *
 * The official Models-page slot contract's two sanctioned seats are both
 * coarser than a model row: the keyed `settings.models.provider-card`
 * renders per provider card and `settings.models.footer`
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

import { AUTOFILL_MARKER, INPUT_UNSET_MARKER, PLUGIN_ID, UNSET_MARKER } from '../constants.js'
import { suggestEfforts, type CompatSuggestion, type InputModalities, type ReasoningEfforts } from '../knowledge.js'
import { modelsOf, routeFactsOf } from '../shared.js'
import { sameEfforts } from './effort.js'
import { compatOf, createEditorApi, defaultEffortOf, describeNamespace, effortsOf, inputOf, nameOf, providersOf, writeModelRows, type RowIntent } from './ops.js'
import type { EffortEditorApi, EffortWriteIntent, HeldWrite, RemoteApi, SettingsJoin } from './types.js'

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
  /**
   * The editing card's commit button. C2 drives the plugin's landing write off
   * the official Save, so the button is resolved when the action row's own
   * structure cannot be read (the buttons ARE the last child pair of
   * `[class*="editorActions"]`; the copy is the fallback).
   */
  apply: readonly string[]
  /** The editing card's dismiss button (the commit's left-hand sibling). */
  cancel: readonly string[]
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
   * The settings Remote face for THIS scan/write. The kernel mounts
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
  /**
   * Runs after an idle pass landed everything the session held back. The
   * browser half hangs its autofill complement here: "the user stopped
   * editing" is the only moment this side may safely write the document.
   */
  onIdle?(): void
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
  /** The model's stored compat block (passthrough; the editor merges suggestions over it). */
  compat?: CompatSuggestion
  /** The model's stored per-model default-effort pick, when one is set. */
  defaultEffort?: string
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
  /**
   * Writes an ON-SCREEN editor asked for while the official card held the
   * document, keyed route → model id. Kept verbatim (this is the user's own
   * declaration, so no suggestion arbitration applies) and replayed the
   * moment the card is gone. In memory only: it dies with the fiber.
   */
  queued: Map<string, Map<string, HeldWrite>>
  /**
   * Whether an official editing card was on the page at the last reconcile.
   * `undefined` until the first scan. The `!== false` test is what makes the
   * idle pass run exactly once per editing session -- and once for a page
   * that loads straight into the models section without ever editing.
   */
  editing: boolean | undefined
  /**
   * Whether an idle pass is in flight. One pass at a time: two overlapping
   * passes would describe the same revision and then fight over it, turning a
   * clean replay into a self-inflicted `settings/conflict`.
   */
  flushing: boolean
  /** Consecutive failed idle passes; the backoff exponent. Reset on success. */
  flushFailures: number
  /** Earliest `Date.now()` at which the next retry may run (0 = any time). */
  nextFlushAt: number
  /**
   * Routes whose OFFICIAL card committed in this session (the user pressed its
   * commit button). The held ledgers land per route: only the routes the user
   * actually saved are written, because the official card's Save is now what
   * commits this plugin's edits too (issue #7 / C2). An intent the user
   * dismissed without saving is dropped, exactly like the card's own fields.
   */
  committing: Set<string>
  /**
   * Whether the official action row has failed to yield usable buttons for
   * every card seen so far. When it has, the landing decision degrades to
   * "the card went away, so write it" -- writing too much is recoverable,
   * silently losing the user's declaration is not.
   */
  signalsUnavailable: boolean
  /** Commit buttons already wired, so a re-scan never double-registers. */
  submitWired: WeakSet<Element>
  /** Cancel buttons already wired. */
  cancelWired: WeakSet<Element>
}

/**
 * One staged declaration: the level set plus the suggestion's compat block and
 * modalities. A 'keep' effort travels untouched to the flush write. The
 * per-model default-effort pick (issue #4) rides along: a string to write,
 * null to clear, absent to touch nothing.
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
  defaultEffort?: string | null
}

/**
 * The held-write ledgers as `sessionStorage` keeps them. Only the two maps are
 * serialized: every entry is the user's own declaration, already JSON-shaped,
 * so the file IS the intent (no derivation on the way back in).
 */
interface LedgerFile {
  pending: [string, [string, StagedDeclaration][]][]
  queued: [string, [string, HeldWrite][]][]
}

/**
 * The `sessionStorage` slot holding both ledgers. Session-scoped on purpose:
 * the intents belong to the card session the user was working in, and a NEW
 * tab must not inherit another tab's half-finished edit.
 */
const LEDGER_KEY = 'bre:held-writes:v1'

/** `sessionStorage`, or undefined when the environment has none (node, privacy mode). */
function ledgerStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/**
 * Mirror both ledgers into `sessionStorage`. Called after every change and
 * best-effort by nature: an unavailable or full storage keeps the ledgers in
 * memory alone (the behaviour before they were persisted), never an error the
 * user has to see.
 */
function persistLedger(state: ScanState): void {
  const store = ledgerStorage()
  if (store === undefined) return
  try {
    if (state.pending.size === 0 && state.queued.size === 0) {
      store.removeItem(LEDGER_KEY)
      return
    }
    const file: LedgerFile = {
      pending: [...state.pending].map(([route, models]) => [route, [...models]]),
      queued: [...state.queued].map(([route, models]) => [route, [...models]]),
    }
    store.setItem(LEDGER_KEY, JSON.stringify(file))
  } catch {
    // Quota / disabled storage: the in-memory ledgers remain authoritative.
  }
}

/** One ledger entry as the file carries it, or undefined when malformed. */
function ledgerEntry<T>(value: unknown): [string, [string, T][]][] | undefined {
  if (!Array.isArray(value)) return undefined
  const routes: [string, [string, T][]][] = []
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) return undefined
    const [route, models] = row as [unknown, unknown]
    if (typeof route !== 'string' || !Array.isArray(models)) return undefined
    const entries: [string, T][] = []
    for (const entry of models) {
      if (!Array.isArray(entry) || entry.length !== 2) return undefined
      const [modelId, write] = entry as [unknown, unknown]
      if (typeof modelId !== 'string' || typeof write !== 'object' || write === null || Array.isArray(write)) {
        return undefined
      }
      entries.push([modelId, write as T])
    }
    routes.push([route, entries])
  }
  return routes
}

/**
 * Restore both ledgers from `sessionStorage`. A malformed or foreign file is
 * ignored wholesale rather than partially applied: a half-read intent is worse
 * than a dropped one on a document the user can edit by hand.
 * @param state - the fresh scan state to fill.
 */
function restoreLedger(state: ScanState): void {
  const store = ledgerStorage()
  if (store === undefined) return
  try {
    const raw = store.getItem(LEDGER_KEY)
    if (raw === null) return
    const parsed = JSON.parse(raw) as Partial<LedgerFile>
    const pending = ledgerEntry<StagedDeclaration>(parsed.pending)
    const queued = ledgerEntry<HeldWrite>(parsed.queued)
    if (pending === undefined || queued === undefined) return
    for (const [route, models] of pending) state.pending.set(route, new Map(models))
    for (const [route, models] of queued) state.queued.set(route, new Map(models))
  } catch {
    // Unreadable file: start clean.
  }
}

/**
 * Land whatever the session held back, best effort, at the moments the fiber is
 * about to go away (plugin disable / HMR / page unload). The ledgers stay in
 * `sessionStorage`, so a flush the browser cuts short is simply retried by the
 * next page load's idle pass.
 * @param state - the scan state whose ledgers to drain.
 * @param deps - the injection dependencies.
 */
export function flushOnTeardown(state: ScanState, deps: InjectorDeps): void {
  void (async () => {
    try {
      await flushQueued(deps, state)
      await flushPending(deps, state)
    } catch (error) {
      console.error(`[bre] teardown flush failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}

export function createScanState(): ScanState {
  const state: ScanState = {
    mounted: new Map(),
    describePromise: undefined,
    pending: new Map(),
    missedScans: new Map(),
    queued: new Map(),
    editing: undefined,
    flushing: false,
    flushFailures: 0,
    nextFlushAt: 0,
    committing: new Set(),
    signalsUnavailable: false,
    submitWired: new WeakSet(),
    cancelWired: new WeakSet(),
  }
  restoreLedger(state)
  return state
}

/**
 * Land everything the session held back, one pass at a time.
 *
 * A refusal keeps its intent in the ledger and pushes the next attempt out on
 * a backoff, so a settled document is not hammered while a genuinely stuck
 * write (a refused compat key, a vanished route) is retried indefinitely
 * instead of being lost on the first failure.
 * @param deps - the injection dependencies.
 * @param state - mutable scan state.
 */
async function runIdlePass(deps: InjectorDeps, state: ScanState): Promise<void> {
  if (state.flushing) return
  state.flushing = true
  try {
    await flushQueued(deps, state)
    await flushPending(deps, state)
    state.flushFailures = 0
    state.nextFlushAt = 0
  } catch (error) {
    state.flushFailures += 1
    state.nextFlushAt = Date.now() + Math.min(2 ** state.flushFailures * 500, 30_000)
    console.error(`[bre] idle flush failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.flushing = false
  }
  deps.onIdle?.()
}

/** Whether either ledger still holds work the idle pass has to land. */
function hasOutstanding(state: ScanState): boolean {
  return state.queued.size > 0 || state.pending.size > 0
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
  /**
   * The modality part. `null` is a deliberate unset (the editor's "clear
   * declaration" on an unsaved route) and stores as such: the staged flush
   * reads it back verbatim, exactly like the saved-row seam does.
   */
  input?: InputModalities | null,
  defaultEffort?: string | null,
): void {
  try {
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
      ...(defaultEffort === undefined ? {} : { defaultEffort }),
    }))
  } finally {
    // Both arms changed the ledger (or provably did not): persisting here
    // keeps the early returns from having to remember it.
    persistLedger(state)
  }
}

/**
 * Record (or replace) the write an on-screen editor asked for while the
 * official card held the document. The latest intent for a row wins: the user
 * may apply twice before closing the card.
 * @param state - mutable scan state.
 * @param route - the route being edited.
 * @param modelId - the model id being edited.
 * @param write - the full intent, kept verbatim for the replay.
 */
export function queueWriteInto(state: ScanState, route: string, modelId: string, write: HeldWrite): void {
  state.queued.set(route, (state.queued.get(route) ?? new Map()).set(modelId, write))
  persistLedger(state)
}

/**
 * Withdraw one row's staged intent (the create card's erase-that-row flow, and
 * the editor's Reset on a route the document does not hold yet). Idempotent,
 * and it clears the route entry once its last model is gone.
 * @param state - mutable scan state.
 * @param route - the route the staging was made against.
 * @param modelId - the model whose intent to drop.
 */
export function withdrawStaged(state: ScanState, route: string, modelId: string): void {
  const models = state.pending.get(route)
  if (models === undefined) return
  models.delete(modelId)
  if (models.size === 0) state.pending.delete(route)
  persistLedger(state)
}

/**
 * Withdraw one row's held intent (the editor's own Reset, or any later
 * "discard this edit"). Idempotent, and it clears the route entry once its
 * last model is gone.
 * @param state - mutable scan state.
 * @param route - the route the editor was editing.
 * @param modelId - the model whose intent to drop.
 */
export function withdrawHeldWrite(state: ScanState, route: string, modelId: string): void {
  const models = state.queued.get(route)
  if (models === undefined) return
  models.delete(modelId)
  if (models.size === 0) state.queued.delete(route)
  persistLedger(state)
}

/**
 * Withdraw a row's intent wherever it landed.
 *
 * The editor's Reset is the caller and it does not know which ledger its own
 * `commit` fed — the create card stages, a saved row queues, and the same row
 * can move between the two as the user edits the route id. Discarding only one
 * of them would leave the Reset cosmetic on the other: the official Save would
 * still write edits the user explicitly threw away.
 * @param state - mutable scan state.
 * @param route - the route the editor was editing.
 * @param modelId - the model whose intent to drop.
 */
export function withdrawIntent(state: ScanState, route: string, modelId: string): void {
  withdrawStaged(state, route, modelId)
  withdrawHeldWrite(state, route, modelId)
}

/**
 * Drop every intent one route holds, right now: the official card's cancel.
 *
 * The card's own fields die with the dismissal, so the plugin's must too -- and
 * they must die at the CLICK, not on some later scan. A deferred "discarded"
 * marker would outlive the card that set it (a dismiss carrying no plugin edit
 * leaves nothing for a later pass to drain), and the next card for that same
 * route would then be read as already-dismissed: its Save would never be
 * wired, and the user's fresh edit would be dropped silently. Clearing the
 * ledger here leaves no state at all to misinterpret.
 *
 * Safe by construction: the official page keeps ONE editing card at a time
 * (create and edit mutually exclusive), so the route this resolves is the only
 * card that could own these entries.
 * @param state - mutable scan state.
 * @param route - the route whose official card was dismissed.
 */
export function forgetRoute(state: ScanState, route: string): void {
  state.queued.delete(route)
  state.committing.delete(route)
  persistLedger(state)
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
  /** The staged default-effort pick, when the staging carried one. */
  defaultEffort?: string | null
  /**
   * Compat fields the edit OWNS and left empty, so "unset" can mean unset
   * instead of keeping the last choice forever. Computed by the editor's own
   * `clearedCompatKeys` against the route's protocol, never against the whole
   * stored block: a hand-tuned field the editor never showed survives.
   *
   * A STAGED flush never sets this. Staging carries a ladder and a modality,
   * not a compat decision, and the host autofill writes the knowledge base's
   * compat block into the very row it fills -- so clearing here would delete
   * the suggestion the row is supposed to start from (the same "the plugin's
   * own proposal is not a user decision" rule the ladder follows).
   */
  clearCompatKeys?: readonly string[]
}

export function effectiveStagedIntents(
  declaration: StagedDeclaration,
  current: Record<string, unknown> | undefined,
  autofill?: AutofillFootprint,
): EffectiveStagedIntents | null {
  if (current === undefined) return null
  // Ladder part: a declaration or a deliberate-unset marker on the row owns
  // it — EXCEPT when the stored declaration is this plugin's own host autofill
  // (the knowledge base proposal it lays down in the route-creation window).
  // That is a suggestion, not a user decision, so a staged intent outranks it;
  // anything else (a hand-tuned ladder, a marker) is a real takeover. 'keep'
  // means the staging never carried the ladder anyway.
  //
  // Provenance first: a ladder carrying the host autofill's marker IS the
  // knowledge base's proposal, whatever its bytes are. The host fills
  // in-process the instant a provider is committed, so by the time this flush
  // runs its own suggestion is already in the document — byte equality alone
  // then reads the user's staged intent as a document takeover and silently
  // drops it (the reported "configured it on the card, saved, and it is gone").
  const ladderMarked =
    current[UNSET_MARKER] !== true
    && current['reasoningEfforts'] !== undefined
    && typeof current[AUTOFILL_MARKER] === 'number'
  const ladderAutofilled =
    ladderMarked
    || (current[UNSET_MARKER] !== true
      && autofill?.efforts !== undefined
      && sameEffortsValue(current['reasoningEfforts'], autofill.efforts))
  const ladderTaken = ladderAutofilled
    ? false
    : current['reasoningEfforts'] !== undefined
      || current[UNSET_MARKER] === true
      || declaration.efforts === 'keep'
  // Modality part: the same provenance rule, decided per part. The knowledge
  // base disclosure the autofill wrote does not answer over a staged choice,
  // while a disclosure that differs from the footprint is a hand-made one and
  // stands. A ladder-only 'keep' staging leaves the stored modality alone, just
  // as before — the staging never carried a modality in that case.
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
  // The default-effort pick has no takeover question: host autofill never
  // writes this field, so whatever the document holds is a user decision and
  // the staged intent (write or clear) passes through untouched.
  const defaultEffort = declaration.defaultEffort
  if (efforts === 'keep' && input === undefined && defaultEffort === undefined) return null
  return {
    efforts,
    ...(declaration.compat === undefined ? {} : { compat: declaration.compat }),
    ...(input === undefined ? {} : { input }),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
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
  // ONE read for the whole route: the rows all live in the same array, so a
  // per-model read was pure repetition. Every arbitration below still runs
  // per model against this same snapshot -- the write is one whole-array set.
  const join = await deps.describeNamespace()
  const providers = providersOf(join.namespace)
  // Snapshot: the loop below withdraws entries whose edit proved empty, and
  // the batch then reports back per model as its results land.
  const intents: RowIntent[] = []
  for (const [modelId, declaration] of [...models]) {
    const current = modelsOf(providers, route).find(model => model['id'] === modelId)
    // The row is not saved yet (mid-edit card, or the user renamed it):
    // keep the staging instead of dropping it -- it lands when a row with
    // this id first appears; the scan's ghost pass withdraws staging whose
    // row is provably gone.
    if (current === undefined) continue
    // A concurrent scan may have withdrawn this staging while our read was
    // in flight (the two-scan ghost pass): writing it anyway would resurrect
    // a declaration nothing on the page owns anymore.
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
    intents.push({
      modelId,
      efforts: effective.efforts,
      ...(effective.compat === undefined ? {} : { compat: effective.compat }),
      ...(effective.input === undefined ? {} : { input: effective.input }),
      ...(effective.defaultEffort === undefined ? {} : { defaultEffort: effective.defaultEffort }),
    })
  }
  if (intents.length === 0) return
  // Seed the write's FIRST read with the snapshot this pass already took: one
  // read per route instead of two. A conflict retry re-describes fresh through
  // the live seam, so the seed never costs the write its recovery path.
  let seeded = false
  const results = await writeModelRows(deps.api, route, intents, () => {
    if (!seeded) {
      seeded = true
      return Promise.resolve(join)
    }
    return deps.describeNamespace()
  })
  intents.forEach((intent, at) => {
    const result = results[at]
    if (result?.ok === true || result?.modelNotFound === true) {
      stageEffortsInto(state, route, intent.modelId, undefined)
      return
    }
    // Anything else keeps the staging (the next scan retries it), but a
    // silent keep is unobservable -- surface the failure for diagnostics.
    console.error(`[bre] staged flush write failed for "${route}"/"${intent.modelId}": ${result?.error ?? 'unknown'}`)
  })
}

/**
 * Replay every editor-held write through a HOLDER-LESS seam, so the very call
 * that would have fought the official card now commits. A row that vanished
 * meanwhile drops its entry instead of retrying forever; any other failure
 * stays queued for the next idle pass.
 *
 * The LANDING DECISION lives here (issue #7 / C2), per route, because this
 * ledger is the one the official card's Save governs:
 *   - the user committed -> write it, now that the card is gone;
 *   - the official action row was never readable in this session -> the signal
 *     cannot be trusted, so degrade to "the card went away, write it": writing
 *     too much is recoverable, losing the declaration is not;
 *   - otherwise the card closed with neither signal (the user just walked
 *     away) -> the intent waits rather than landing behind a frozen baseline.
 *
 * A DISMISSED card has no branch here on purpose: its cancel clears the ledger
 * the moment it is pressed ({@link forgetRoute}), so "dismissed" can never
 * outlive the card it belonged to and swallow a later save of the same route.
 * @param deps - the injection dependencies.
 * @param state - mutable scan state.
 */
async function flushQueued(deps: InjectorDeps, state: ScanState): Promise<void> {
  for (const [route, models] of [...state.queued]) {
    // The staged ledger has no official row whose Save could commit it; this
    // one does, so an uncommitted route waits instead of landing behind that
    // card's frozen revision baseline.
    const committed = state.committing.has(route)
    if (!committed && !state.signalsUnavailable) continue
    state.committing.delete(route)
    // One read, one mutate for the whole route: the held intents are per model
    // but the document is a single models array, so a per-model write was
    // rebuilding and rewriting that same array N times.
    const intents: RowIntent[] = [...models].map(([modelId, write]) => ({
      modelId,
      efforts: write.efforts,
      ...(write.compat === undefined ? {} : { compat: write.compat }),
      ...(write.input === undefined ? {} : { input: write.input }),
      ...(write.clearCompatKeys === undefined ? {} : { clearCompatKeys: write.clearCompatKeys }),
      ...(write.defaultEffort === undefined ? {} : { defaultEffort: write.defaultEffort }),
    }))
    const results = await writeModelRows(deps.api, route, intents)
    intents.forEach((intent, at) => {
      const result = results[at]
      if (result?.ok === true || result?.modelNotFound === true) {
        models.delete(intent.modelId)
        return
      }
      console.error(`[bre] held write failed for "${route}"/"${intent.modelId}": ${result?.error ?? 'unknown'}`)
    })
    if (models.size === 0) state.queued.delete(route)
  }
  // The queue just shrank (landed or dropped intents) or stayed as it was
  // (a route still waiting for its card): either way the stored file must
  // match what is left to do.
  persistLedger(state)
}

/**
 * Land the create-card declarations whose route has appeared. Each route goes
 * through its own live describe, so one refused route cannot poison a sibling
 * that would have landed.
 * @param deps - the injection dependencies.
 * @param state - mutable scan state.
 */
async function flushPending(deps: InjectorDeps, state: ScanState): Promise<void> {
  if (state.pending.size === 0) return
  const join = await deps.describeNamespace()
  if (join.writable !== true) return
  const providers = providersOf(join.namespace)
  for (const [route, models] of [...state.pending]) {
    if (models.size === 0) {
      state.pending.delete(route)
      continue
    }
    // A create card still owns a route the document has not taken yet.
    if (!hasOwn(providers, route)) continue
    await flushRoute(deps, state, route, models)
  }
  persistLedger(state)
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
    && a.defaultEffort === b.defaultEffort
    // A create card's container surviving its own save must flip the editor
    // to write mode: staged changes the Apply button's whole contract, so it
    // participates in the diff like any other prop.
    && a.staged === b.staged
    && sameEfforts(a.efforts, b.efforts)
    && sameInput(a.input, b.input)
    && sameCompat(a.compat, b.compat)
}

/** Semantic equality of two compat blocks (key-order-insensitive). */
function sameCompat(a: CompatSuggestion | undefined, b: CompatSuggestion | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return JSON.stringify({ ...a }, Object.keys({ ...a, ...b }).sort()) === JSON.stringify({ ...b }, Object.keys({ ...a, ...b }).sort())
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
 * could otherwise collide with a provider's display name), and finally the
 * title itself as a route key: a provider that never set a display name
 * renders the route id as its title and hides the `.editorRoute` tag (the
 * two are then equal), so only this last arm can resolve it. A create card
 * never reaches the last arm either — its Provider ID input already returned.
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
  if (byName !== undefined) return { route: byName[0], staged: false }
  // A provider that never set a display name resolves to its route key, and
  // the host hides the .editorRoute tag while that key equals the title
  // (ProviderEditor renders it only when the name differs) — so neither arm
  // above can find the route. The title is then the route key itself, which
  // is exact: resolve it directly. A create card never reaches this arm (its
  // Provider ID input already returned), so an editor-title/key collision
  // with the fixed create heading cannot occur.
  if (hasOwn(providers, title)) return { route: title, staged: false }
  return undefined
}

/**
 * The commit/cancel pair of one card's official action row, or undefined when
 * the row cannot be read.
 *
 * Three tiers, most structural first, because this is the signal the plugin's
 * landing write hangs on and the official page is free to restyle it:
 *   1. the last two buttons of `[class*="editorActions"]` -- the commit is the
 *      rightmost, its dismiss the one before it (`EditorFooter.tsx`: the row is
 *      a plain two-button div, cancel first, commit last);
 *   2. the declared CSS Modules classes `primaryButton` / `secondaryButton`
 *      (they carry a hash suffix, so only the prefix can match);
 *   3. the host's own copy for that row, resolved through the dictionary it
 *      renders from (`apply` is 'Apply' in English and '保存' in Chinese, so
 *      pinning either language would strand one of them).
 *
 * A row whose buttons no tier can identify returns undefined, which is what
 * makes {@link ScanState.signalsUnavailable} trip and the landing decision
 * degrade to "the card went away, write it" rather than dropping the edit.
 */
function actionsOf(card: HTMLElement, labels: HostLabels): { submit: HTMLElement; cancel: HTMLElement } | undefined {
  const row = card.querySelector<HTMLElement>('[class*="editorActions"]')
  if (row === null) return undefined
  const buttons = Array.from(row.querySelectorAll<HTMLElement>('button'))
  if (buttons.length < 2) return undefined
  const matches = (node: HTMLElement, label: string): boolean =>
    (node.textContent ?? '').trim() === label
  const primary = row.querySelector<HTMLElement>('[class*="primaryButton"]')
  const secondary = row.querySelector<HTMLElement>('[class*="secondaryButton"]')
  if (primary !== null && secondary !== null) return { submit: primary, cancel: secondary }
  const submit = [...buttons].reverse().find(node => labels.apply.some(label => matches(node, label)))
  const cancel = [...buttons].reverse().find(node => labels.cancel.some(label => matches(node, label)))
  if (submit !== undefined && cancel !== undefined) return { submit, cancel }
  // Structural last resort: the rightmost button commits, its left sibling
  // dismisses. Used only when neither the classes nor the copy resolve, so a
  // one-button row (a future layout) still yields a commit.
  const last = buttons[buttons.length - 1]
  const previous = buttons[buttons.length - 2]
  if (last === undefined || previous === undefined) return undefined
  return { submit: last, cancel: previous }
}

/**
 * Wire one button's click ONCE, in the capture phase.
 *
 * Capture, not bubble: the marker has to be recorded before the official
 * React handler runs and tears the card down, and React's own listeners sit
 * on the root container. Capture also makes this independent of whether the
 * official handler stops propagation.
 */
function wireOnce(
  node: HTMLElement,
  wired: WeakSet<Element>,
  onHit: () => void,
): void {
  if (wired.has(node)) return
  wired.add(node)
  node.addEventListener('click', onHit, { capture: true })
}

/**
 * Whether an official editing card is open on the page, told from the card's
 * own action row (its Cancel/commit pair) with the model-row containers as a
 * fallback signal.
 *
 * The distinction matters: an ON-SCREEN card holds a frozen revision baseline,
 * so a write landing while it is open is refused on the user's next save --
 * issue #7. Judging "is a card open" from the capacity buttons alone answers
 * "is a model row expanded", which is not the same question: an open card with
 * an empty model list would read as idle and let exactly that write through.
 */
function officialCardOf(root: HTMLElement): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('[class*="editorActions"]')
    ?? root.querySelector<HTMLElement>('[class*="modelEntry"]')
    ?? undefined
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
  // "Is an official editing card open?" is the gate that decides whether this
  // plugin may write at all. The card's own action row answers it structurally,
  // with the model-row containers as a second signal: an open card whose model
  // list happens to be empty carries no capacity button, and judging idleness
  // from those buttons alone would let a write slip into that card's frozen
  // revision baseline -- issue #7 again, under a rarer trigger.
  const cardOpen = officialCardOf(root) !== undefined
  const hasCapacityRows = labels.capacity.some(aria =>
    root.querySelector(`button[aria-label^="${aria}"]`) !== null)
  if (!cardOpen) {
    if (state.mounted.size > 0) {
      for (const [, entry] of state.mounted) entry.editor.unmount()
      state.mounted.clear()
    }
    // No editing card is on the page, so no on-screen revision baseline can be
    // invalidated by a write: THIS is the moment to land everything the
    // session held back. `!== false` also covers the first scan (undefined) --
    // and a page that reloaded onto restored ledgers -- so outstanding work
    // always gets its pass; the second arm only fires while intents wait, so a
    // settled page costs nothing beyond the check.
    const wasEditing = state.editing
    state.editing = false
    if (wasEditing !== false || (hasOutstanding(state) && Date.now() >= state.nextFlushAt)) {
      void runIdlePass(deps, state)
    }
    return
  }
  state.editing = true
  // An open card showing no model row has nothing to equip: the idle pass
  // stays fenced until the card goes away (or a row appears).
  if (!hasCapacityRows) return
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

    // Staged declarations land on the IDLE pass, never from an open card:
    // writing while the official editor holds the document is exactly what
    // made the user's own save in that card fail with `settings/conflict`.

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
      const compat = staged
        ? state.pending.get(route)?.get(target.modelId)?.compat
        : compatOf(models, target.modelId)
      const defaultEffort = staged
        ? (state.pending.get(route)?.get(target.modelId)?.defaultEffort ?? undefined)
        : defaultEffortOf(models, target.modelId)
      // An unsaved row has no stored declaration to name it, but the user may
      // have typed a Display name on the row already -- suggestion inference
      // and knowledge-base matching lose that signal without it. The read is
      // ROW-scoped (the same multi-row trap the model id above avoids).
      const typedName = staged ? inputValueByLabel(target.row, labels.modelName) : ''
      const modelName = staged ? (typedName.length > 0 ? typedName : undefined) : nameOf(models, target.modelId)
      const typedApi = routeStaged ? inputValueByLabel(target.card, labels.apiProtocol) : ''
      const typedBaseURL = routeStaged ? inputValueByLabel(target.card, labels.baseUrl) : ''
      // The official action row is the signal this row's landing write hangs
      // on (C2): wire its two buttons. A row whose buttons no tier can name
      // flips the global degrade flag, so the landing decision falls back to
      // "the card went away, write it" instead of silently dropping the edit.
      // No guard on the route's current markers: a REOPENED card is a new
      // element whose buttons must be wired again, and `wireOnce`'s WeakSet
      // already collapses every repeat within one element.
      const actions = actionsOf(target.card, labels)
      if (actions === undefined) {
        state.signalsUnavailable = true
      } else {
        wireOnce(actions.submit, state.submitWired, () => {
          state.committing.add(route)
          persistLedger(state)
        })
        wireOnce(actions.cancel, state.cancelWired, () => {
          forgetRoute(state, route)
        })
      }
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
        ...compat === undefined ? {} : { compat },
        ...defaultEffort === undefined ? {} : { defaultEffort },
        index,
        staged,
        api: createEditorApi(
          deps.api,
          undefined,
          (r, m, e, c, i, de) => { stageEffortsInto(state, r, m, e, c, i, de) },
          // This row is on screen: it ALWAYS holds the document. The card it
          // lives in froze its revision baseline, so the intent is queued and
          // the official card's own Save is what commits it (issue #7 / C2).
          (r, m, w) => { queueWriteInto(state, r, m, w) },
          // The editor's Reset drops wherever this row's intent landed.
          r => { withdrawIntent(state, r, target.modelId) },
          // Read live: the same DOM row can move between unsaved and saved as
          // the user types a route id, so the ledger decision cannot be frozen
          // at mount time.
          () => staged,
        ),
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
