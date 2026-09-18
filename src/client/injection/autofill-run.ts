/**
 * The running auto-fill complement (issue #7).
 *
 * The host fills once at boot. Everything a session adds afterwards is filled
 * HERE, on the idle pass: that is the only moment no official card is holding a
 * revision baseline a write would invalidate.
 *
 * @module dsh-better-reasoning-effort/client/injection/autofill-run
 */

import { AUTOFILL_CONFIG_PATH, PI_AI_NS } from '../../constants.js'
import { buildAutofillPatch } from '../../autofill.js'
import { describeNamespace, userProvidersOf } from '../ops.js'
import type { RemoteApi } from '../types.js'

/** What the complement needs from its host. */
export interface IdleAutofillDeps {
  /** The settings remote. */
  api: RemoteApi
}

/** The complement's face. */
export interface IdleAutofill {
  /** Run the complement; fire-and-forget on the injector's idle pass. */
  run: () => void
}

/**
 * Build the auto-fill complement.
 * @param deps - the settings remote.
 * @returns the complement's {@link IdleAutofill} face.
 */
export function createIdleAutofill(deps: IdleAutofillDeps): IdleAutofill {
  let autofillSwitches: Promise<{ autofill: boolean; modalityAutofill: boolean }> | undefined

  /**
   * The host's autofill switches, read once. A `dsh.client` declaration carries
   * no plugin config, so a deployment configured `autofill: false` would
   * otherwise still be written to from the page. An unreachable or older host
   * keeps the documented defaults rather than silently disabling the feature.
   */
  const autofillSwitchesOf = (): Promise<{ autofill: boolean; modalityAutofill: boolean }> => {
    autofillSwitches ??= (async () => {
      const fallback = { autofill: true, modalityAutofill: true }
      try {
        const response = await fetch(AUTOFILL_CONFIG_PATH, { method: 'GET' })
        if (!response.ok) return fallback
        const body = (await response.json()) as { ok?: boolean; data?: { autofill?: unknown; modalityAutofill?: unknown } }
        if (body?.ok !== true) return fallback
        return {
          autofill: body.data?.autofill !== false,
          modalityAutofill: body.data?.modalityAutofill !== false,
        }
      } catch {
        return fallback
      }
    })()
    return autofillSwitches
  }

  /**
   * Fill the models this session added, through the very patch builder the
   * host's boot pass uses (so one suggestion can never produce two different
   * documents). Runs on the idle pass only.
   */
  const runIdleAutofill = async (): Promise<void> => {
    try {
      const switches = await autofillSwitchesOf()
      if (!switches.autofill) return
      // Fresh: the scope mirror folds a just-settled write in asynchronously,
      // so reading it here would fence this fill on a superseded revision and
      // manufacture a `settings/conflict` (the same reason a conflict retry
      // re-reads the wire).
      const join = await describeNamespace(deps.api, { fresh: true })
      const namespace = join.namespace
      if (namespace === undefined || join.writable !== true) return
      const userProviders = userProvidersOf(namespace)
      if (userProviders === undefined) return
      const patch = buildAutofillPatch(
        userProviders, () => true, { modalities: switches.modalityAutofill }, namespace.revision,
      )
      if (patch === undefined) return
      const routes = patch['providers'] as Record<string, { models: unknown }>
      const ops = Object.entries(routes).map(([route, profile]) => ({
        op: 'set' as const,
        path: ['providers', route, 'models'],
        value: profile.models,
      })) as unknown as Parameters<typeof deps.api.settings.mutate>[1]
      const response = await deps.api.settings.mutate(PI_AI_NS, ops, namespace.revision)
      // A refusal arrives as a VALUE, not a throw: without this check the whole
      // complement failed silently (the catch below never ran). Whatever is
      // still undeclared is picked up by the next idle pass.
      if (!response.ok) {
        console.error(`[bre] idle autofill refused: ${response.error.message}`)
      }
    } catch (error) {
      console.error(`[bre] idle autofill failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { run: () => { void runIdleAutofill() } }
}
