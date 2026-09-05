/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. The compilation baseline is the
 * 0.1.2-rc.1 kernel line, whose wire surface 0.1.3-alpha.1 leaves unchanged
 * (verified source-level): the browser talks to the generated Typert
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
  ModelCatalogModel,
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

/** The settings answer envelope on the rc.1 kernel, in the official `RemoteResult` shape. */
export type SettingsRemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

/** The 'settings' Remote methods the browser half calls (rc.1 Typert shape). */
export interface SettingsRemoteApi {
  describe(): Promise<SettingsRemoteResult<SettingsDescribeValue>>
  mutate(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision?: number,
  ): Promise<SettingsRemoteResult<SettingsNamespaceView>>
}

/** The Remote faces the browser half consumes. */
export interface RemoteApi {
  settings: SettingsRemoteApi
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
 * these calls on the rc.1 kernel; the structural declaration keeps the
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

// ---- Composer slider faces: the 0.1.2-rc.1 model-directory contract ----
// (identical at 0.1.3-alpha.1)
// The runtime instances come from `ctx.modelDirectories`; the type aliases
// name the official declarations so a shape change surfaces at typecheck.

/** One effort level exactly as the owning adapter advertised it. */
export type EffortLevelLike = ModelReasoning['efforts'][number]

/** Per-model reasoning metadata the directory reports. */
export type ModelReasoningLike = ModelReasoning

/** One directory model row. */
export type DirectoryModelLike = ModelCatalogModel

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
 * One result of writing a model's declaration.
 */
export type WriteEffortsReply = { ok: true } | { ok: false; error: string }

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
   * Write one model's reasoningEfforts (unset, disabled, a dict -- or 'keep'
   * to leave it completely untouched) and, when an input intent is supplied,
   * its input-modality declaration in the same mutate. A compat block is
   * written only when one is supplied alongside a dict declaration -- an
   * omitted compat leaves whatever the document already holds untouched.
   */
  writeEfforts(
    route: string,
    modelId: string,
    efforts: EffortWriteIntent,
    compat?: CompatSuggestion,
    input?: InputIntent,
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
  ): void
}
