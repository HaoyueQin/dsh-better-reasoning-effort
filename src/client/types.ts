/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. Derived from the published client
 * contract (`@deepseek-ai/dsh-api-remotes/client`) so a harness-side drift
 * surfaces as a compile error rather than a browser surprise.
 *
 * @module dsh-better-reasoning-effort/types
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ReasoningEfforts } from '../knowledge.js'

export type { ConfigurableProviderView, SettingsPathOpView, RpcResponse } from
  '@deepseek-ai/dsh-api-remotes/client'

/** The `settings` Remote methods the browser half calls. */
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

/** One result of writing a model's reasoningEfforts. */
export type WriteEffortsReply = { ok: true } | { ok: false; error: string }

/** One result of asking for a suggestion for one model. */
export type SuggestReply =
  | {
      ok: true
      suggestion: {
        /** The declaration to apply; `false` = the endpoint says it does not reason. */
        efforts: ReasoningEfforts | false
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

/** The write seam the effort editor needs. */
export interface EffortEditorApi {
  /** Ask for a knowledge-base / protocol suggestion for one model. */
  suggest(
    route: string,
    modelId: string,
    name?: string,
    stagedFacts?: StagedRouteFacts,
  ): Promise<SuggestReply>
  /** Write one model's reasoningEfforts (unset, disabled, or a dict). */
  writeEfforts(route: string, modelId: string, efforts: ReasoningEfforts | false | undefined): Promise<WriteEffortsReply>
  /**
   * Stage one model's declaration for a route that does not exist in the
   * settings document yet (the create card). Synchronous, memory-only; the
   * injector flushes staged declarations once the route appears.
   */
  stageEfforts(route: string, modelId: string, efforts: ReasoningEfforts | false | undefined): void
}
