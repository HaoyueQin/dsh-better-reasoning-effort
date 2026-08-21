/**
 * Host apply() integration tests against a fake settings service shaped like
 * the REAL SettingsProvider (describe() returns an ARRAY of descriptors —
 * the regression guard for the wire-envelope mixup that used to make every
 * autofill throw), plus the boot-retry schedule for a not-yet-registered
 * pi-ai namespace.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type HostCtx = Parameters<typeof import('../src/index.js').apply>[0]

/** A settings service with the real provider's face (narrowed to what apply uses). */
function fakeSettings(providers: Record<string, unknown> | undefined) {
  let revision = 3
  let current = providers
  const updates: Array<{ patch: object; expectedRevision: number | undefined }> = []
  return {
    get(ns: string): unknown {
      return ns === 'llm-pi-ai' && current !== undefined ? { providers: current } : undefined
    },
    describe(): Array<{ ns: string; revision: number }> {
      // Registered namespaces only: before llm-pi-ai registers, the list is empty.
      return current === undefined ? [] : [{ ns: 'llm-pi-ai', revision }]
    },
    async update(ns: string, patch: object, expectedRevision?: number): Promise<void> {
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new Error(`settings namespace "${String(ns)}" changed since it was read (expected ${expectedRevision}, now ${revision})`)
      }
      updates.push({ patch, expectedRevision })
      revision += 1
    },
    updates,
    register(namespace: string, next?: Record<string, unknown>): void {
      void namespace
      if (next !== undefined) current = next
    },
  }
}

/** Minimal cordis context face capturing what apply() touches. */
function fakeHost(
  settings: ReturnType<typeof fakeSettings>,
  options?: { credentials?: { resolve(ref: string): Promise<{ value?: string } | undefined> } },
): {
  ctx: HostCtx
  emitUpdated: (ns: unknown) => void
  routes: Map<string, (req: unknown, res: unknown) => Promise<void>>
} {
  const listeners: Array<(ns: unknown) => void> = []
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  const ctx = {
    inject(deps: string[], cb: (injected: Record<string, unknown>) => void): void {
      const injected: Record<string, unknown> = {}
      if (deps.includes('settings')) injected['settings'] = settings
      if (deps.includes('webServer')) {
        injected['webServer'] = {
          register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }): () => void {
            routes.set(route.path, route.handler)
            return () => { routes.delete(route.path) }
          },
        }
      }
      cb(injected)
    },
    effect(setup: () => () => void, _name?: string): void {
      setup()
    },
    on(event: string, cb: (ns: unknown) => void): void {
      if (event === 'settings/updated') listeners.push(cb)
    },
    get(name: string): unknown {
      return name === 'credentials' ? options?.credentials : undefined
    },
  } as unknown as HostCtx
  return { ctx, emitUpdated: (ns) => { for (const listener of listeners) listener(ns) }, routes }
}

const PROVIDERS = {
  aliyun: {
    displayName: 'Aliyun',
    api: 'openai-completions',
    models: [{ id: 'qwen-max', name: 'Qwen Max' }],
  },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('apply() autofill', () => {
  it('writes the fill through the real service shape, with the optimistic lock', async () => {
    const settings = fakeSettings(PROVIDERS)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    const routes = (settings.updates[0]!.patch as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers
    expect(routes.aliyun.models[0]!['reasoningEfforts']).toEqual({ off: null, high: 'high' })
    // The lock carried the revision read at describe() time.
    expect(settings.updates[0]!.expectedRevision).toBe(3)
  })

  it('does nothing when every model already declares efforts', async () => {
    const declared = {
      aliyun: { api: 'openai-completions', models: [{ id: 'qwen-max', reasoningEfforts: false }] },
    }
    const settings = fakeSettings(declared)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(0)
  })

  it('refills after a settings/updated commit for the pi-ai namespace', async () => {
    const settings = fakeSettings({ aliyun: { api: 'openai-completions', models: [] } })
    const { ctx, emitUpdated } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(0)
    // A user edit lands, adding an undeclared model.
    settings.register('llm-pi-ai', PROVIDERS)
    emitUpdated('llm-pi-ai')
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    // Other namespaces never trigger a fill.
    emitUpdated('some-other-ns')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.updates).toHaveLength(1)
  })

  it('does not refill a declaration the user deliberately unset', async () => {
    const settings = fakeSettings(PROVIDERS)
    const { ctx, emitUpdated } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    // The boot fill declares the model.
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    // The editor's unset flow lands: the field is gone, the durable marker
    // records the absence as a decision.
    settings.register('llm-pi-ai', {
      aliyun: {
        displayName: 'Aliyun',
        api: 'openai-completions',
        models: [{ id: 'qwen-max', name: 'Qwen Max', reasoningEffortsUnset: true }],
      },
    })
    emitUpdated('llm-pi-ai')
    await new Promise(resolve => setTimeout(resolve, 20))
    // No second write: the unset survives the very next autofill pass (and,
    // being persisted in the document, every later boot).
    expect(settings.updates).toHaveLength(1)
  })

  it('fills a genuinely new model added after the boot fill', async () => {
    const settings = fakeSettings(PROVIDERS)
    const { ctx, emitUpdated } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(1) })
    settings.register('llm-pi-ai', {
      aliyun: {
        displayName: 'Aliyun',
        api: 'openai-completions',
        models: [
          { id: 'qwen-max', name: 'Qwen Max', reasoningEffortsUnset: true },
          { id: 'qwen-turbo' },
        ],
      },
    })
    emitUpdated('llm-pi-ai')
    await vi.waitFor(() => { expect(settings.updates).toHaveLength(2) })
    const patch = settings.updates[1]!.patch as { providers: Record<string, { models: Array<Record<string, unknown>> }> }
    const models = patch.providers.aliyun.models
    // Only the new model is filled; the deliberately-unset one stays untouched.
    expect(models.find(model => model['id'] === 'qwen-max')!['reasoningEfforts']).toBeUndefined()
    expect(models.find(model => model['id'] === 'qwen-turbo')!['reasoningEfforts']).toBeDefined()
  })

  it('survives a conflicting write without throwing', async () => {
    const settings = fakeSettings(PROVIDERS)
    // Force the optimistic lock to refuse.
    settings.updates.length = 0
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Bump the revision between describe and update by wrapping update.
    const originalUpdate = settings.update.bind(settings)
    let described = false
    Object.defineProperty(settings, 'update', {
      value: async (ns: string, patch: object, expectedRevision?: number) => {
        if (!described && expectedRevision !== undefined) {
          described = true
          throw new Error(`settings namespace "llm-pi-ai" changed since it was read (expected ${expectedRevision}, now 99)`)
        }
        return originalUpdate(ns, patch, expectedRevision)
      },
    })
    apply(ctx)
    await vi.waitFor(() => { expect(errorSpy).toHaveBeenCalled() })
    expect(errorSpy.mock.calls[0]![0]).toContain('changed since it was read')
  })

  it('retries the boot fill on a bounded schedule while llm-pi-ai is unregistered', async () => {
    vi.useFakeTimers()
    const settings = fakeSettings(undefined)
    const { ctx } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    // The namespace is still missing after the first pass and several retries.
    await vi.advanceTimersByTimeAsync(2500)
    expect(settings.updates).toHaveLength(0)
    // llm-pi-ai registers; the next scheduled retry fills.
    settings.register('llm-pi-ai', PROVIDERS)
    await vi.advanceTimersByTimeAsync(1500)
    expect(settings.updates).toHaveLength(1)
    // The schedule is bounded: no further writes fire.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(settings.updates).toHaveLength(1)
  })
})

describe('apply() probe route', () => {
  const PROBE_PATH = '/dsh-better-reasoning-effort/raw-models'

  function fakeRes(): { res: unknown; out: () => { status: number; body: Record<string, unknown> } } {
    let status = 0
    let raw = ''
    const res = {
      set statusCode(value: number) { status = value },
      get statusCode(): number { return status },
      setHeader(_key: string, _value: string): void {},
      end(body?: string): void { raw = body ?? '' },
    }
    return {
      res,
      out: () => ({ status, body: JSON.parse(raw.length > 0 ? raw : '{}') as Record<string, unknown> }),
    }
  }

  function fakeReq(overrides?: { method?: string; url?: string; headers?: Record<string, string> }): unknown {
    return {
      method: 'GET',
      url: `?route=aliyun`,
      headers: { host: '127.0.0.1:3080' },
      ...overrides,
    }
  }

  it('proxies the raw listing with the stored credential, never echoing it', async () => {
    const settings = fakeSettings({
      aliyun: { api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: 'ALIYUN_KEY', models: [] },
    })
    const credentials = { resolve: async (ref: string) => ({ value: ref === 'ALIYUN_KEY' ? 'sk-secret' : undefined }) }
    const { ctx, routes } = fakeHost(settings, { credentials })
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)
    expect(handler).toBeDefined()

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen-max', supported_parameters: ['reasoning'] }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = fakeRes()
    await handler!(fakeReq(), res)
    const reply = out()
    expect(reply.status).toBe(200)
    expect(reply.body['ok']).toBe(true)
    expect((reply.body['data'] as unknown[]).length).toBe(1)
    // The credential went upstream as a bearer token and nowhere else.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://gw.example.com/v1/models')
    expect(init.headers['authorization']).toBe('Bearer sk-secret')
    expect(JSON.stringify(reply.body)).not.toContain('sk-secret')
    vi.unstubAllGlobals()
  })

  it('rejects cross-site callers before touching anything', async () => {
    const settings = fakeSettings({ aliyun: { baseURL: 'https://gw.example.com', models: [] } })
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = fakeRes()
    await handler(fakeReq({ headers: { host: '10.0.0.5:3080', 'sec-fetch-site': 'cross-site' } }), res)
    expect(out().status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('rejects an Origin that does not match the Host (DNS-rebinding shape)', async () => {
    const settings = fakeSettings({ aliyun: { baseURL: 'https://gw.example.com', models: [] } })
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = fakeRes()
    // A rebinding page resolves its own origin's host to this server: the
    // Origin header still names the attacker's site and must be refused.
    await handler(fakeReq({
      headers: { host: '127.0.0.1:3080', origin: 'http://evil.example:4080' },
    }), res)
    expect(out().status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('refuses a non-loopback Host with no browser trust signal at all', async () => {
    const settings = fakeSettings({ aliyun: { baseURL: 'https://gw.example.com', models: [] } })
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = fakeRes()
    // A plain non-browser client (curl): no Origin, no Sec-Fetch-Site. The
    // loopback exemption does not cover a LAN-addressed Host.
    await handler(fakeReq({ headers: { host: '10.0.0.5:3080' } }), res)
    expect(out().status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('admits a same-origin browser caller on a non-loopback Host', async () => {
    const settings = fakeSettings({})
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const { res, out } = fakeRes()
    // Positive control: a real browser tab served from this very server.
    // The fence passes it; the request then fails on the missing route,
    // which proves the rejection above is the fence and not the route table.
    await handler(fakeReq({
      headers: { host: '10.0.0.5:3080', 'sec-fetch-site': 'same-origin' },
      url: '?route=missing',
    }), res)
    expect(out().status).toBe(400)
    expect(String(out().body['error'])).toContain('no llm-pi-ai provider route')
  })

  it('answers only GET', async () => {
    const settings = fakeSettings(PROVIDERS)
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = fakeRes()
    await handler(fakeReq({ method: 'POST' }), res)
    expect(out().status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reports upstream auth failures with a key hint instead of throwing', async () => {
    const settings = fakeSettings({ aliyun: { baseURL: 'https://gw.example.com/v1', models: [] } })
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    const { res, out } = fakeRes()
    await handler(fakeReq(), res)
    const reply = out()
    expect(reply.status).toBe(200)
    expect(reply.body['ok']).toBe(false)
    expect(String(reply.body['error'])).toContain('check the API key')
    vi.unstubAllGlobals()
  })

  it('probes unauthenticated when no credential resolves', async () => {
    const settings = fakeSettings({ aliyun: { baseURL: 'https://gw.example.com/v1', models: [] } })
    const { ctx, routes } = fakeHost(settings)
    const { apply } = await import('../src/index.js')
    apply(ctx)
    const handler = routes.get(PROBE_PATH)!
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = fakeRes()
    await handler(fakeReq(), res)
    expect(out().body['ok']).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(init.headers['authorization']).toBeUndefined()
    vi.unstubAllGlobals()
  })
})
