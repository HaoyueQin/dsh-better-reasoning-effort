/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. Derived from the published client
 * contract ('@deepseek-ai/dsh-api-remotes/client') so a harness-side drift
 * surfaces as a compile error rather than a browser surprise.
 *
 * @module dsh-better-reasoning-effort/types
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  CompatSuggestion,
  InputModalities,
  InputSource,
  ReasoningEfforts,
} from '../knowledge.js'

export type { ConfigurableProviderView, SettingsPathOpView, RpcResponse } from
  '@deepseek-ai/dsh-api-remotes/client'

/** The 'settings' Remote methods the browser half calls. */
export type SettingsRemoteApi = Pick<IApiClient['settings'], 'describe' | 'mutate'>

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

/** One result of writing a model's declaration. */
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
        /** The compat block to write alongside (thinkingFormat etc.), when derivable. */
        compat?: CompatSuggestion
        /** Request modalities to declare, when derivable. */
        input?: InputModalities
        /** Where the modality part came from; its confidence rides this. */
        inputSource?: InputSource
        /** Reference context window (display-only; never auto-filled). */
        contextWindow?: number
        /** Reference max output tokens (display-only). */
        maxTokens?: number
        matched: boolean
        source: string
        /** Evidence strength: high (knowledge base / endpoint), medium, low. */
        confidence: 'high' | 'medium' | 'low'
        /** Raw endpoint signal behind the suggestion, when probed. */
        endpoint?: { reasoning: boolean | 'unknown'; source: string | null }
      }
    }
  | { ok: false; error: string }

/** Route facts a not-yet-saved (create card) route can supply for inference. */
export interface StagedRouteFacts {
  /** Wire protocol as typed into the create card. */
  api?: string
  /** Endpoint URL as typed into the create card. */
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
   * its input-modality declaration in the same mutate. A compat block is written only when one is supplied
   * alongside a dict declaration -- an omitted compat leaves whatever the
   * document already holds untouched.
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
