/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. The faces the browser writes through
 * are declared structurally: the rc.2 line exposed them through
 * `IApiClient['settings']` ('@deepseek-ai/dsh-api-remotes/client'), but the
 * alpha line replaced the fetch client with generated Typert remotes and
 * dropped that interface, so no export exists on both kernels to derive from.
 * Only the used members are pinned here, and the wire (client/wire.ts)
 * normalizes the alpha stub onto the rc.2 calling convention below.
 *
 * @module dsh-better-reasoning-effort/types
 */

import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  CompatSuggestion,
  InputModalities,
  InputSource,
  ReasoningEfforts,
} from '../knowledge.js'

// Re-exported vocabulary both kernels still publish through the same subpath
// (rc.2 / alpha.2 / alpha.3 checked; ConfigurableProviderView was dropped on the
// alpha line and is not re-exported here).
export type { SettingsPathOpView, RpcResponse } from
  '@deepseek-ai/dsh-api-remotes/client'

/** Error half of a settings-remote answer, in the rc.2 RpcError shape. */
export interface SettingsRemoteError {
  code: string
  message: string
  details?: unknown
}

/** The `settings.describe` answer value (the rc.2 describe response value, structural). */
export interface SettingsDescribeValueView {
  writable: boolean
  hasDocument?: boolean
  namespaces: SettingsNamespaceView[]
}

/** The result envelope both kernels answer with (`result` slot of a rc.2 RpcResponse). */
export type SettingsRemoteResult<T> = {
  result:
    | { ok: true; value: T }
    | { ok: false; error: SettingsRemoteError }
}

/** The rc.2 settings.mutate payload: ops plus the optimistic-lock revision. */
export interface SettingsMutateInput {
  ns: string
  ops: SettingsPathOpView[]
  expectedRevision?: number
}

/** The 'settings' Remote methods the browser half calls. */
export interface SettingsRemoteApi {
  describe(payload?: unknown): Promise<SettingsRemoteResult<SettingsDescribeValueView>>
  mutate(input: SettingsMutateInput): Promise<SettingsRemoteResult<unknown>>
}

/** The Remote faces the browser half consumes. */
export interface RemoteApi {
  settings: SettingsRemoteApi
}

/** The join the injector renders from: the pi-ai namespace plus writability. */
export interface SettingsJoin {
  /** The pi-ai namespace view, when registered. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
}

export type { SettingsNamespaceView }

// ---- Kernel-dual wire faces (see client/wire.ts) ----

/** Error half of an alpha.1 Typert stub answer (code is best-effort on the wire). */
export interface AlphaWireError {
  code?: string
  message?: string
}

/** alpha.1 Typert stub answers are top-level envelopes, not result-wrapped. */
export interface AlphaEnvelope<V> {
  ok: boolean
  value?: V
  error?: AlphaWireError
}

/**
 * Shape-erased face of the alpha.1 'ctx.remote.settings' Typert stub: describe
 * takes no argument and mutate takes positional (ns, ops, expectedRevision) —
 * both differing from the rc.2 IApiClient conventions the wire normalizes onto.
 */
export interface AlphaSettingsStub {
  describe(): Promise<AlphaEnvelope<SettingsDescribeValueView>>
  mutate(
    ns: string,
    ops: unknown[],
    expectedRevision: number | undefined,
  ): Promise<AlphaEnvelope<unknown>>
}

/**
 * The service seats the wire probe reads, as a minimal structural type. Only
 * `get` — cordis' optional lookup — is used: on alpha.1 every
 * `remote.<namespace>` is a standalone service whose property read throws
 * without a matching `inject` declaration (which rc.2 could never satisfy;
 * see client/wire.ts), so the wire never touches context properties here.
 */
export interface WireContext {
  /** Optional service lookup: returns the service value or undefined. */
  get?(name: string): unknown
}

/**
 * The client shell's context face, declared locally instead of imported: the
 * rc.2 line exports `ClientContext` from
 * '@deepseek-ai/dsh-client-runtime/client' (an alias of cordis `Context`, and
 * also the package declaring the 'connection/reset' event key), the alpha
 * line dropped that package and official client plugins take a plain cordis
 * `Context` with the same members merged in through the assembly packages.
 * Only the members the browser half calls are pinned here; `get`/`inject`/
 * `slots` are probed through casts below, so they stay optional structural
 * reads.
 */
export interface ClientContext {
  locale: {
    register(ns: string, dict: Record<string, unknown>): unknown
    bind(ns: string): unknown
  }
  remote: {
    $on(event: 'settings/document-updated', listener: (ns: unknown) => void): () => void
  }
  on(event: 'connection/reset', listener: () => void): () => void
  effect(fn: () => unknown, name?: string): unknown
  get?(name: string): unknown
  inject?(names: string[], callback: () => unknown): unknown
}

// ---- alpha.1 Models-page slot faces (locally declared; rc.2 types lack them) ----

/**
 * Minimal 'ctx.slots' face the slot path needs, declared locally because the
 * rc.2 type baseline predates the Models extension slots. The runtime accepts
 * the same calls on both kernels; rc.2 never reaches them because the slot path
 * is gated on the alpha.1 wire probe (and rc.2's Models section declares no
 * slots at all).
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

// ---- Composer slider faces (structurally typed; the directory's true types
// ---- live in @deepseek-ai/dsh-client-ui-model-selection, which both kernels
// ---- export with the same shape but which the rc.2 dev baseline could not
// ---- pin alongside alpha.1 — so the seam stays structural.)

/** One effort level exactly as the owning adapter advertised it. */
export interface EffortLevelLike {
  readonly id: string
  readonly name: string
}

/** Per-model reasoning metadata the directory reports. */
export interface ModelReasoningLike {
  readonly defaultEffort?: string
  readonly efforts?: readonly EffortLevelLike[]
}

/** One directory model row. */
export interface DirectoryModelLike {
  readonly id: string
  readonly name?: string
  readonly reasoning?: ModelReasoningLike
}

/** One provider group of directory models. */
export interface DirectoryGroupLike {
  readonly id: string
  readonly name: string
  readonly models: readonly DirectoryModelLike[]
}

/** The selection the host reports for the next assembled step. */
export interface DirectoryCurrentLike {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The directory snapshot both selection entries render from (see ui-model-selection). */
export interface ModelDirectoryStateLike {
  readonly current: DirectoryCurrentLike | null
  readonly groups: readonly DirectoryGroupLike[]
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  readonly error: string | null
}

/** Per-session model-selection directory face the slider needs (structural). */
export interface ModelDirectoryLike {
  readonly store: {
    getSnapshot(): ModelDirectoryStateLike
    subscribe(listener: () => void): () => void
  }
  load(): Promise<unknown>
  select(selection: {
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<unknown>
}

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
