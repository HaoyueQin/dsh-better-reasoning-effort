/**
 * The settings wire seam: one internal face, one adapter per kernel line.
 *
 * rc.2 exposes the settings Remote on `connection.api` (the IApiClient) and
 * answers in `{result: {ok, value | error}}` envelopes with object-form
 * mutate. alpha.1 removed `ConnectionHandle.api` and mounts a Typert stub at
 * `ctx.remote.settings` that answers top-level `{ok, value | error}`, takes
 * positional mutate arguments, and reports refusals through thrown
 * TypertRemoteFailure as well as `{ok: false}` answers.
 *
 * `resolveWire` probes both seats lazily and the alpha.1 adapter normalizes
 * onto the rc.2 wire shape, so the write seam (ops.ts) keeps one calling
 * convention while both kernels run from one bundle. A probe returning
 * undefined means "no seat answers YET" — on alpha.1 the stub mounts
 * asynchronously after boot — and callers treat it as a transient skip, not
 * an error.
 *
 * ponytail: when 0.1.1-rc.2 support is dropped, delete `resolveWire`'s
 * connection fallback and make the alpha.1 shape the wire's native contract.
 *
 * @module dsh-better-reasoning-effort/client/wire
 */

import type { AlphaEnvelope, AlphaSettingsStub, RemoteApi, WireContext } from './types.js'

/** Normalize an alpha.1 error half onto the rc.2 RpcError face ({code, message}). */
function normalizeError(error: { code?: string; message?: string } | undefined, fallback: string): { code: string; message: string } {
  return {
    code: error?.code ?? 'error',
    message: error?.message ?? fallback,
  }
}

/**
 * Wrap the alpha.1 settings stub so it answers exactly like the rc.2
 * IApiClient.settings face the write seam was built against: describe takes
 * (and ignores) its argument, mutate takes the single object form, and every
 * answer — including thrown TypertRemoteFailure — lands in the
 * `{result: {ok | error}}` envelope with a code-bearing error.
 */
function wrapAlphaSettings(stub: AlphaSettingsStub): RemoteApi {
  return {
    settings: {
      describe: async () => {
        try {
          const answer: AlphaEnvelope<{ namespaces: unknown[]; writable: boolean; hasDocument?: boolean }> = await stub.describe()
          if (answer.ok && answer.value !== undefined) {
            return { result: { ok: true, value: answer.value } }
          }
          return { result: { ok: false, error: normalizeError(answer.error, 'settings describe failed') } }
        } catch (error) {
          const failure = error as { code?: string; message?: string }
          return { result: { ok: false, error: { code: failure.code ?? 'error', message: failure.message ?? String(error) } } }
        }
      },
      mutate: async (input: { ns: string; ops: unknown[]; expectedRevision?: number }) => {
        try {
          const answer = await stub.mutate(input.ns, input.ops, input.expectedRevision)
          if (answer.ok) return { result: { ok: true, value: answer.value } }
          return { result: { ok: false, error: normalizeError(answer.error, 'settings mutate failed') } }
        } catch (error) {
          const failure = error as { code?: string; message?: string }
          return { result: { ok: false, error: { code: failure.code ?? 'error', message: failure.message ?? String(error) } } }
        }
      },
    },
  } as unknown as RemoteApi
}

/**
 * Resolve the settings wire for the running kernel, or undefined while no
 * seat answers yet. The alpha.1 stub wins when present (its kernel is the one
 * that removed the connection seat); the rc.2 connection seat is the
 * fallback. Callers re-resolve per scan and per write, so a stub that mounts
 * after boot is picked up without a re-apply.
 */
export function resolveWire(ctx: WireContext): RemoteApi | undefined {
  const remote = ctx.remote as { settings?: unknown } | undefined
  const stub = remote?.settings as AlphaSettingsStub | undefined
  if (stub !== undefined && typeof stub.describe === 'function') {
    return wrapAlphaSettings(stub)
  }
  const connection = ctx.get?.('connection') as { api?: RemoteApi } | undefined
  const api = connection?.api
  if (api?.settings !== undefined) return api
  return undefined
}
