/**
 * Wire-surface types the browser half consumes: the settings Remote faces and
 * the pure seam the effort editor needs. Derived from the published client
 * contract (`@deepseek-ai/dsh-api-remotes/client`) so a harness-side drift
 * surfaces as a compile error rather than a browser surprise.
 *
 * @module dsh-better-reasoning-effort/types
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { ReasoningEfforts } from '../knowledge.js'

export type { ConfigurableProviderView, SettingsNamespaceView, SettingsPathOpView, RpcResponse } from
  '@deepseek-ai/dsh-api-remotes/client'

/** The `settings` Remote methods the browser half calls. */
export type SettingsRemoteApi = Pick<IApiClient['settings'], 'describe' | 'mutate'>

/** The Remote faces the browser half consumes. */
export interface RemoteApi {
  settings: SettingsRemoteApi
}

/** One result of writing a model's reasoningEfforts. */
export type WriteEffortsReply = { ok: true } | { ok: false; error: string }

/** One result of asking for a suggestion for one model. */
export type SuggestReply =
  | { ok: true; suggestion: { efforts: ReasoningEfforts; matched: boolean; source: string } }
  | { ok: false; error: string }

/** The write seam the effort editor needs. */
export interface EffortEditorApi {
  /** Ask for a knowledge-base / protocol suggestion for one model. */
  suggest(route: string, modelId: string, name?: string): Promise<SuggestReply>
  /** Write one model's reasoningEfforts (unset, disabled, or a dict). */
  writeEfforts(route: string, modelId: string, efforts: ReasoningEfforts | false | undefined): Promise<WriteEffortsReply>
}
