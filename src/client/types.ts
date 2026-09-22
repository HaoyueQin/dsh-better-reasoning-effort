/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. The compilation baseline is the
 * 0.1.7-alpha.1 kernel line; runtime probes retain the 0.1.5/0.1.6 settings
 * scope and the older-kernel compat downgrade as fallbacks:
 * the browser talks to the generated Typert
 * `ctx.remote.settings` stub — `describe()` takes no argument, `mutate` takes
 * positional `(ns, ops, expectedRevision)`, and every answer is the envelope
 * `{ok, value | error}` with refusals coded `settings/conflict` /
 * `settings/rejected` / `gateway/*`.
 *
 * The vocabulary views come from the official re-exports (`SettingsNamespaceView`
 * / `SettingsPathOpView` / `SettingsDescribeValue`; the model-directory types
 * from `@deepseek-ai/dsh-api-session-controller/types`), so a kernel change to
 * those shapes shows up at typecheck rather than at runtime. The answer
 * envelope is declared structurally — the official `RemoteResult` folds the
 * typert-wide `RemoteErrorDetailsMap` merges, whose consumer-side declarations
 * live in the settings-controller package; pinning that package here would
 * widen the plugin's type graph for one refusal shape.
 *
 * @module dsh-better-reasoning-effort/types
 */

import type {
  ModelProviderGroup,
  ModelReasoning,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the per-session model directory service the composer slider
// reads; the runtime instance is obtained through `ctx.get('modelDirectories')`,
// never through this package's entry.
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {
  CompatSuggestion,
  InputModalities,
  InputSource,
  ReasoningEfforts,
} from '../knowledge.js'

/** The settings answer envelope, in the official `RemoteResult` shape. */
export type SettingsRemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

/** The 'settings' Remote methods the browser half calls (Typert shape). */
export interface SettingsRemoteApi {
  describe(): Promise<SettingsRemoteResult<SettingsDescribeValue>>
  mutate(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision?: number,
  ): Promise<SettingsRemoteResult<SettingsNamespaceView>>
}

/**
 * `ctx.get('configForms')`, as the 0.1.7+ `ui-settings` plugin registers it.
 * The service owns one shared form per Host entry.
 */
export interface ConfigFormsLike {
  /**
   * Get the shared form values and write queue for one Host plugin entry.
   * @param entryId - unique Host plugin entry id (`llm-pi-ai` by default).
   * @returns the entry form whose snapshot this half reads.
   */
  get(entryId: string): SettingsScopeReadLike
}

/**
 * `ctx.get('settingsScope')`, as 0.1.5 through 0.1.6 register it: a
 * `SettingsScopeBinder`, NOT a scope. The binder only mints scopes via
 * {@link bind}; `getSnapshot()` lives on the scope `bind` returns. Treating
 * the binder as a scope makes every read throw, so the plugin must bind its
 * own namespace first.
 */
export interface SettingsScopeBinderLike {
  /**
   * Bind one namespace scope on the CALLING fiber's lifecycle.
   * @param spec - namespace identity (`{ namespace }`).
   * @returns the bound scope whose snapshot this half reads.
   */
  bind(spec: { namespace: string }): SettingsScopeReadLike
}

/**
 * The read face shared by 0.1.7+ `ConfigForms.get(entryId)` and the older
 * `SettingsScopeBinder.bind({ namespace })`. One shared describe mirror backs
 * every form, so reading through the snapshot costs no wire round trip and
 * always reports the revision the settings surface itself is working from.
 *
 * Deliberately read-only: the scope's `mutate` settles `void`, which makes a
 * refused write indistinguishable from a committed one. The plugin's queues
 * must keep a failed intent for the next pass, so writes still go through
 * `settings.mutate`, where the refusal code is observable.
 */
export interface SettingsScopeReadLike {
  getSnapshot(): {
    /** `ready` once a section has been accepted; other states carry no value. */
    status: 'loading' | 'ready' | 'unavailable'
    /** Schema-resolved section of the bound namespace. */
    value?: unknown
    /** Composition base the section resolves over. */
    base?: unknown
    /** Raw user layer as stored. */
    user?: unknown
    /** Revision fencing the next write. */
    revision?: number
    /** Whether the settings document accepts writes. */
    writable?: boolean
  }
}

/** The Remote faces the browser half consumes. */
export interface RemoteApi {
  settings: SettingsRemoteApi
  /**
   * The official settings read face, when the shell provides one. Optional:
   * versions before 0.1.5 and deployments without `ui-settings` keep the
   * wire-describe path, and the plugin never declares either optional service
   * in its `inject` (a hard dependency would refuse to activate the browser
   * half on a kernel that predates it).
   */
  scope?: SettingsScopeReadLike
}

export type { SettingsNamespaceView, SettingsPathOpView }
/** The join the injector renders from: the pi-ai namespace plus writability. */
export interface SettingsJoin {
  /** The pi-ai namespace view, when registered. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
}

/**
 * The client shell's context face, declared locally instead of imported: the
 * assembly packages merge their services into cordis' `Context`, but a
 * third-party client contribution pins only the members it calls. The
 * `remote.settings` face is the official one; `get` / `inject` / `slots` stay
 * optional structural reads (see client/index.ts).
 */
export interface ClientContext {
  locale: {
    register(ns: string, dict: Record<string, unknown>): unknown
    bind(ns: string): unknown
    /**
     * LocaleFace pair: the revision moves on every active-language switch
     * and dictionary registration. Mounted copy then stays in the language
     * it rendered in when absent — the pre-existing behaviour.
     */
    subscribe?(fn: () => void): () => void
    getSnapshot?(): { revision?: number }
  }
  remote: {
    $on(event: 'settings/document-updated', listener: (ns: unknown, revision?: number) => void): () => void
    settings: SettingsRemoteApi
  }
  on(event: 'connection/reset', listener: () => void): () => void
  effect(fn: () => unknown, name?: string): unknown
  get?(name: string): unknown
  inject?(names: string[], callback: () => unknown): unknown
}

// ---- Models-page slot face (declared locally; the official types live in
// ---- @deepseek-ai/dsh-client-ui-slots, whose runtime accepts the same calls) ----

/**
 * Minimal 'ctx.slots' face the footer-slot path needs. The runtime accepts
 * these calls; the structural declaration keeps the
 * plugin's slot seam independent of the slots package's own type surface.
 */
export interface SlotRegistrarFace {
  inject(name: string, registrar: () => unknown): unknown
  register(options: {
    name: string
    key?: string
    id?: string
    order?: number
    inject?: () => Record<string, unknown>
    [extra: string]: unknown
  }, component: unknown): () => void
}

// ---- Composer slider faces: the model-directory contract ----
// The runtime instances come from `ctx.modelDirectories`; the type aliases
// name the official declarations so a shape change surfaces at typecheck.

/** One effort level exactly as the owning adapter advertised it. */
export type EffortLevelLike = ModelReasoning['efforts'][number]

/** One provider group of directory models. */
export type DirectoryGroupLike = ModelProviderGroup

/** The selection the host reports for the next assembled step. */
export type DirectoryCurrentLike = ModelSelection

/** The directory snapshot both selection entries render from. */
export type ModelDirectoryStateLike = ModelDirectoryState

/** Per-session model-selection directory face the slider needs. */
export type ModelDirectoryLike = ModelDirectory

// ---- (rest unchanged) ----

/**
 * One result of writing a model's declaration. `staged` reports that the
 * write was queued rather than committed: the editor holds the document while
 * the official card is open, so the change lands once the user stops editing.
 */
export type WriteEffortsReply = { ok: true; staged?: boolean } | { ok: false; error: string }

/**
 * One result of asking for a suggestion for one model. The effort ladder and
 * the modality/capacity parts are independent: either may be present while
 * the other is absent.
 */
export type SuggestReply =
  | {
      ok: true
      suggestion: {
        /** The declaration to apply; false = the endpoint says it does not reason. */
        efforts: ReasoningEfforts | false
        /** The compat block to write alongside, if any. */
        compat?: CompatSuggestion
        /** Request modalities to declare, when derivable. */
        input?: InputModalities
        /** Where the modality part came from -- its confidence rides this. */
        inputSource?: InputSource
        /** Reference context window (display-only; never auto-filled). */
        contextWindow?: number
        /** Reference max output tokens (display-only). */
        maxTokens?: number
        matched: boolean
        source: string
        /** Evidence strength: high (knowledge base / endpoint), medium, low. */
        confidence: 'high' | 'medium' | 'low'
        /** Raw endpoint signal behind this suggestion, when probed. */
        endpoint?: { reasoning: boolean | 'unknown'; source: string | null }
      }
    }
  | { ok: false; error: string }

/** Route facts a not-yet-saved (create card) route can supply for inference. */
export interface StagedRouteFacts {
  /** Wire protocol as typed into the create card. */
  api?: string
  /** Endpoint URL, if any. */
  baseURL?: string
}

/**
 * The modality part of a write intent. Undefined leaves whatever the document
 * holds untouched (a staged flush must not strip declarations it never
 * carried); null unsets the declaration durably (the marker records the
 * absence as a decision); an array writes exactly those modalities.
 */
export type InputIntent = InputModalities | null | undefined

/**
 * The effort-ladder part of a write intent. Undefined unsets the declaration
 * durably (the marker records the absence); the 'keep' sentinel leaves
 * whatever the document holds completely untouched -- what a modality-only
 * edit must send, so applying an image toggle never marks a never-declared
 * ladder as deliberately unset.
 */
export type EffortWriteIntent = ReasoningEfforts | false | undefined | 'keep'

/**
 * The per-model default-effort part of a write intent. Undefined leaves the
 * stored pick untouched (a ladder-only edit never clears it); null clears it
 * durably (back to the memory chain); a string writes exactly that level --
 * one of the model's own declared ladder keys.
 */
export type DefaultEffortIntent = string | null | undefined

/**
 * The complete write one editor asked for while it held the document. The
 * injector replays it verbatim once the user stops editing: it is the user's
 * own declared intent, so no suggestion arbitration applies to it.
 */
export interface HeldWrite {
  /** The ladder part exactly as the editor computed it. */
  efforts: EffortWriteIntent
  /** The compat block to write alongside a ladder declaration. */
  compat?: CompatSuggestion
  /** The modality part, when this edit made one. */
  input?: InputIntent
  /** Compat fields this edit owns and left empty (deleted on the replay). */
  clearCompatKeys?: readonly string[]
  /** The per-model default-effort pick, when this edit made one. */
  defaultEffort?: DefaultEffortIntent
}

/**
 * The complete set of edits one editor holds for a row, as it hands them to the
 * injector after every change.
 *
 * Since C2 the editor owns no commit action of its own: a change is reported
 * the moment it happens, and the injector decides where the intent lands — the
 * staged ledger while the route is unsaved, the held-write ledger while the
 * official card is open. The official card's own Save is what commits them
 * (issue #7), so the editor never branches on `staged` for its write path.
 */
export interface PendingWrite {
  /** The ladder part exactly as the editor computed it. */
  efforts: EffortWriteIntent
  /** The compat block to write alongside a ladder declaration. */
  compat?: CompatSuggestion
  /** The modality part, when this edit made one. */
  input?: InputIntent
  /** Compat fields this edit owns and left empty (deleted when it lands). */
  clearCompatKeys?: readonly string[]
  /** The per-model default-effort pick, when this edit made one. */
  defaultEffort?: DefaultEffortIntent
}

/** The write seam the effort editor needs. */
export interface EffortEditorApi {
  /** Ask for a knowledge-base / protocol suggestion for one model. */
  suggest(
    route: string,
    modelId: string,
    name?: string,
    stagedFacts?: StagedRouteFacts,
  ): Promise<SuggestReply>
  /**
   * Report the row's complete pending edit. The injector routes it: a route the
   * settings document does not hold yet goes to the staged ledger, anything
   * else to the held-write ledger that the official card's Save commits.
   *
   * Synchronous and side-effect-free from the editor's point of view: it must
   * not await a wire write, because the change has to register before the user
   * can reach the official Save button.
   *
   * The row is named explicitly rather than captured when the seam was built:
   * one seam instance is mounted per DOM row, and the row's identity is what
   * decides the ledger, so the call carries it instead of trusting a closure.
   */
  commit(route: string, modelId: string, write: PendingWrite): void
  /**
   * Withdraw everything this editor reported for its row (the editor's own
   * Reset). Without it, a Reset followed by the official Save would still write
   * the discarded edits — the ledger outlives the React state.
   */
  withdraw(route: string, modelId: string): void
  /**
   * Write one model's reasoningEfforts (unset, disabled, a dict -- or 'keep'
   * to leave it completely untouched) and, when an input intent is supplied,
   * its input-modality declaration in the same mutate. A compat block is
   * written only when one is supplied alongside a dict declaration -- an
   * omitted compat leaves whatever the document already holds untouched.
   *
   * `clearCompatKeys` names the compat fields this edit OWNS and left empty: a
   * key in neither the written block nor that list survives (a hand-tuned field
   * the editor does not show is never dropped), while a listed one is deleted,
   * which is what makes "Unset" mean unset instead of "keep the last choice
   * forever".
   *
   * Public seam: the one-row case of the injector's batch writer, kept on the
   * editor API for embedders and covered by the write-path tests. The editor
   * itself reports through {@link commit} since C2, and the injector's ledgers
   * call the batch writer directly — neither goes through this method.
   */
  writeEfforts(
    route: string,
    modelId: string,
    efforts: EffortWriteIntent,
    compat?: CompatSuggestion,
    input?: InputIntent,
    clearCompatKeys?: readonly string[],
    defaultEffort?: DefaultEffortIntent,
  ): Promise<WriteEffortsReply>
  /**
   * Stage one model's declaration for a route that does not exist in the
   * settings document yet (the create card). Synchronous, memory-only; the
   * injector flushes staged declarations once the route appears.
   */
  stageEfforts(
    route: string,
    modelId: string,
    efforts: EffortWriteIntent,
    compat?: CompatSuggestion,
    input?: InputModalities,
    defaultEffort?: DefaultEffortIntent,
  ): void
}
