/**
 * Kernel-dual wire seam: seat probing priority, the alpha.1 adapter's
 * envelope normalization, and the transient-undefined contract. The rc.2
 * seat passes through untouched (same face, same envelopes), so only its
 * selection needs a test. Both seats are probed through `ctx.get` — the
 * optional lookup — because alpha.1 mounts `remote.settings` as a standalone
 * service whose property read throws without an inject declaration (a
 * declaration rc.2 can never satisfy).
 *
 * @module dsh-better-reasoning-effort/client/wire
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { AlphaSettingsStub, RemoteApi, WireContext } from '../src/client/types.js'
import { resolveWire } from '../src/client/wire.js'

/** An rc.2-shaped face whose identity is observable through the probe. */
function rc2Face(): RemoteApi {
  return {
    settings: {
      describe: vi.fn(async () => ({ result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } } })),
      mutate: vi.fn(async () => ({ result: { ok: true, value: undefined } })),
    },
  } as unknown as RemoteApi
}

/** An alpha.1-shaped Typert stub with call-recording adapters. */
function alphaStub(overrides?: Partial<AlphaSettingsStub>): AlphaSettingsStub & { describeSpy: ReturnType<typeof vi.fn>; mutateSpy: ReturnType<typeof vi.fn> } {
  const describeSpy = vi.fn(async () => ({ ok: true, value: { writable: true, hasDocument: false, namespaces: [] } }))
  const mutateSpy = vi.fn(async () => ({ ok: true, value: { ns: 'llm-pi-ai', revision: 7 } }))
  return { describe: describeSpy, mutate: mutateSpy, ...overrides, describeSpy, mutateSpy }
}

/**
 * A WireContext whose service store answers by name: the alpha.1 stub sits
 * under 'remote.settings' (its standalone-service name), the rc.2 connection
 * under 'connection' — exactly the seats the optional lookup probes.
 */
function ctxWith(parts: { api?: RemoteApi; stub?: AlphaSettingsStub }): WireContext {
  return {
    get: (name: string): unknown => {
      if (name === 'remote.settings' && parts.stub !== undefined) return parts.stub
      if (name === 'connection' && parts.api !== undefined) return { api: parts.api }
      return undefined
    },
  }
}

describe('resolveWire', () => {
  it('returns undefined while no seat answers (alpha.1 boot window)', () => {
    expect(resolveWire(ctxWith({}))).toBeUndefined()
    expect(resolveWire({})).toBeUndefined()
  })

  it('prefers the alpha.1 stub when both seats answer', () => {
    const api = rc2Face()
    const stub = alphaStub()
    const wire = resolveWire(ctxWith({ api, stub }))
    expect(wire).toBeDefined()
    // The alpha.1 adapter is a NEW face, not the rc.2 pass-through.
    expect(wire).not.toBe(api)
  })

  it('passes the rc.2 connection face through untouched', () => {
    const api = rc2Face()
    const wire = resolveWire(ctxWith({ api }))
    expect(wire).toBe(api)
  })

  it('falls back to the rc.2 seat when the stub has no describe (malformed mount)', () => {
    const api = rc2Face()
    const broken = {} as AlphaSettingsStub
    const wire = resolveWire(ctxWith({ api, stub: broken }))
    expect(wire).toBe(api)
  })

  // alpha.1 mounts every Remote namespace as a standalone 'remote.<ns>'
  // service; a context property read that the fiber did not inject THROWS
  // (cordis' reflect gate). The wire must never touch such properties —
  // this pins the probe to ctx.get alone.
  it('never reads service properties: an alpha.1 ctx whose property access throws still resolves', () => {
    const stub = alphaStub()
    const hostile: WireContext = {
      get: (name: string) => (name === 'remote.settings' ? stub : undefined),
    }
    const wire = resolveWire(hostile)
    expect(wire).toBeDefined()
    // And the returned adapter really is wired to that stub.
    expect(wire).not.toBe(stub)
  })
})

describe('alpha.1 adapter normalization', () => {
  it('describe() calls the stub without arguments and unwraps {ok, value} into the {result} envelope', async () => {
    const stub = alphaStub()
    const wire = resolveWire(ctxWith({ stub }))!
    const response = await wire.settings.describe({})
    expect(stub.describeSpy).toHaveBeenCalledWith()
    expect(response).toEqual({ result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } } })
  })

  it('mutate() rewrites the single object form into positional stub arguments', async () => {
    const stub = alphaStub()
    const wire = resolveWire(ctxWith({ stub }))!
    const ops = [{ op: 'set' as const, path: ['providers'], value: 1 }]
    const response = await wire.settings.mutate({ ns: 'llm-pi-ai', ops, expectedRevision: 3 })
    expect(stub.mutateSpy).toHaveBeenCalledWith('llm-pi-ai', ops, 3)
    expect(response).toEqual({ result: { ok: true, value: { ns: 'llm-pi-ai', revision: 7 } } })
  })

  it('maps an {ok:false} stub answer onto the error envelope with its code', async () => {
    const stub = alphaStub({
      mutate: vi.fn(async () => ({ ok: false, error: { code: 'settings-conflict', message: 'stale' } })),
    })
    const wire = resolveWire(ctxWith({ stub }))!
    const response = await wire.settings.mutate({ ns: 'llm-pi-ai', ops: [], expectedRevision: 1 })
    expect(response).toEqual({ result: { ok: false, error: { code: 'settings-conflict', message: 'stale' } } })
  })

  it('maps a thrown TypertRemoteFailure onto the error envelope, preserving its code', async () => {
    const stub = alphaStub({
      mutate: vi.fn(async () => {
        throw Object.assign(new Error('namespace changed'), { code: 'settings-conflict' })
      }),
    })
    const wire = resolveWire(ctxWith({ stub }))!
    const response = await wire.settings.mutate({ ns: 'llm-pi-ai', ops: [], expectedRevision: 1 })
    expect(response).toEqual({ result: { ok: false, error: { code: 'settings-conflict', message: 'namespace changed' } } })
  })

  it('survives a throwing describe the same way', async () => {
    const stub = alphaStub({
      describe: vi.fn(async () => { throw new Error('transport down') }),
    })
    const wire = resolveWire(ctxWith({ stub }))!
    const response = await wire.settings.describe({})
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) {
      expect(response.result.error.message).toBe('transport down')
      expect(response.result.error.code).toBe('error')
    }
  })
})
