/**
 * Request-header overlay tests: the pure origin index (issue #12) and the
 * fetch-layer installer.
 *
 * The fetch tests drive a STUB global fetch, so what they assert is exactly the
 * contract the real seam has to keep: an unconfigured origin passes through
 * with its arguments untouched, a configured one gets the indexed `user-agent`
 * merged over the caller's own headers, and the global is restored (and only
 * then) once the last activation goes away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildUserAgentIndex,
  declaredUserAgent,
  emptyIndex,
  headersOf,
  isSendableUserAgent,
  originOf,
  requestUrlOf,
} from '../src/headers-core.js'
import { adapterSourcePatched } from '../src/headers-conflict.js'
import { headerOverlayInstalled, installHeaderOverlay, type OverlaySource } from '../src/headers-fetch.js'

describe('originOf', () => {
  it('reads the scheme, host and port and drops the path', () => {
    expect(originOf('https://relay.example.com/v1/messages')).toBe('https://relay.example.com')
    expect(originOf('http://127.0.0.1:8791/v1')).toBe('http://127.0.0.1:8791')
  })

  it('keeps two loopback ports apart', () => {
    expect(originOf('http://127.0.0.1:8791/x')).not.toBe(originOf('http://127.0.0.1:8792/x'))
  })

  it('refuses what is not an absolute URL', () => {
    expect(originOf('/v1/messages')).toBeUndefined()
    expect(originOf('not a url')).toBeUndefined()
    expect(originOf('')).toBeUndefined()
    expect(originOf(undefined)).toBeUndefined()
  })
})

describe('isSendableUserAgent', () => {
  it('accepts a conventional client identity', () => {
    expect(isSendableUserAgent('claude-cli/2.1.161 (external, cli)')).toBe(true)
  })

  it('refuses an empty value and header-injection shapes', () => {
    expect(isSendableUserAgent('')).toBe(false)
    expect(isSendableUserAgent('a\r\nx-injected: 1')).toBe(false)
    expect(isSendableUserAgent('a\nb')).toBe(false)
    expect(isSendableUserAgent('a\0b')).toBe(false)
  })

  it('refuses an unreasonable length', () => {
    expect(isSendableUserAgent('u'.repeat(513))).toBe(false)
    expect(isSendableUserAgent('u'.repeat(512))).toBe(true)
  })
})

describe('declaredUserAgent', () => {
  it('reads the value case-insensitively', () => {
    expect(declaredUserAgent({ headers: { 'User-Agent': 'kilo/1.0' } })).toBe('kilo/1.0')
    expect(declaredUserAgent({ headers: { 'user-agent': 'kilo/1.0' } })).toBe('kilo/1.0')
  })

  it('ignores a route that declares none, or an unsendable one', () => {
    expect(declaredUserAgent({ headers: { 'x-company': 'acme' } })).toBeUndefined()
    expect(declaredUserAgent({})).toBeUndefined()
    expect(declaredUserAgent(undefined)).toBeUndefined()
    expect(declaredUserAgent({ headers: { 'user-agent': 'a\r\nb' } })).toBeUndefined()
    expect(declaredUserAgent({ headers: { 'user-agent': 42 } })).toBeUndefined()
  })
})

describe('headersOf', () => {
  it('keeps string entries only and reports an empty dict as absent', () => {
    expect(headersOf({ headers: { a: '1', b: 2 } })).toEqual({ a: '1' })
    expect(headersOf({ headers: {} })).toBeUndefined()
    expect(headersOf({ headers: ['a', 'b'] })).toBeUndefined()
    expect(headersOf({})).toBeUndefined()
  })
})

describe('buildUserAgentIndex', () => {
  it('indexes a route by the origin of its endpoint', () => {
    const index = buildUserAgentIndex({
      agentrouter: {
        baseURL: 'https://relay.example.com/api',
        headers: { 'user-agent': 'claude-cli/2.1.161 (external, cli)', 'x-company': 'acme' },
      },
    })
    expect([...index.byOrigin.keys()]).toEqual(['https://relay.example.com'])
    expect(index.byOrigin.get('https://relay.example.com')).toMatchObject({
      route: 'agentrouter',
      userAgent: 'claude-cli/2.1.161 (external, cli)',
    })
    expect(index.conflicts).toEqual([])
  })

  it('skips a route with no endpoint, no UA, or an unparseable endpoint', () => {
    const index = buildUserAgentIndex({
      noEndpoint: { headers: { 'user-agent': 'x' } },
      noUa: { baseURL: 'https://a.example.com', headers: { 'x-y': '1' } },
      badEndpoint: { baseURL: 'not a url', headers: { 'user-agent': 'x' } },
    })
    expect(index.byOrigin.size).toBe(0)
    expect(index.conflicts).toEqual([])
  })

  it('accepts two routes agreeing on one identity', () => {
    const index = buildUserAgentIndex({
      a: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'same/1' } },
      b: { baseURL: 'https://shared.example.com/v1', headers: { 'user-agent': 'same/1' } },
    })
    expect(index.byOrigin.size).toBe(1)
    expect(index.conflicts).toEqual([])
  })

  it('reports a genuine disagreement instead of picking silently', () => {
    const index = buildUserAgentIndex({
      a: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'first/1' } },
      b: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'second/2' } },
    })
    // First declaration still serves (the seam has to send something)...
    expect(index.byOrigin.get('https://shared.example.com')?.userAgent).toBe('first/1')
    // ...and the disagreement is reported rather than hidden.
    expect(index.conflicts).toHaveLength(1)
    expect(index.conflicts[0]).toMatchObject({
      origin: 'https://shared.example.com',
      routes: ['a', 'b'],
      values: ['first/1', 'second/2'],
    })
  })

  it('reports one conflict per origin, not one per later claimant', () => {
    const index = buildUserAgentIndex({
      a: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'first' } },
      b: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'second' } },
      c: { baseURL: 'https://shared.example.com', headers: { 'user-agent': 'third' } },
    })
    expect(index.conflicts).toHaveLength(1)
    expect(index.conflicts[0]?.routes).toEqual(['a', 'b', 'c'])
  })
})

describe('requestUrlOf', () => {
  it('reads a string, a URL, and a Request', () => {
    expect(requestUrlOf('https://a.example.com/v1')).toBe('https://a.example.com/v1')
    expect(requestUrlOf(new URL('https://a.example.com/v1'))).toBe('https://a.example.com/v1')
    expect(requestUrlOf(new Request('https://a.example.com/v1'))).toBe('https://a.example.com/v1')
  })

  it('refuses an unclassifiable input', () => {
    expect(requestUrlOf(42)).toBeUndefined()
    expect(requestUrlOf({ url: 'https://a.example.com' })).toBeUndefined()
  })
})

describe('adapterSourcePatched', () => {
  it('recognizes the stock function as unpatched', () => {
    const stock = [
      'function requestHeaders(headers) {',
      'const attribution = attributionHeaders();',
      'const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));',
      'return { ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))), ...attribution };',
      '}',
    ].join('\n')
    expect(adapterSourcePatched(stock)).toBe(false)
  })

  it('recognizes the published patch', () => {
    expect(adapterSourcePatched('const configuredUserAgent = entries.find(...)')).toBe(true)
  })
})

describe('installHeaderOverlay', () => {
  const original = globalThis.fetch
  let calls: { input: unknown; init: RequestInit | undefined }[]
  /** Every handle this test installed, disposed in afterEach no matter what. */
  let handles: { dispose(): void }[]

  /** Install a stub fetch that records what reached it. */
  function stubFetch(): void {
    calls = []
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as unknown as typeof globalThis.fetch
  }

  /** Install an overlay that this suite guarantees to tear down. */
  function install(source: OverlaySource) {
    const handle = installHeaderOverlay(source)
    handles.push(handle)
    return handle
  }

  beforeEach(() => {
    handles = []
    stubFetch()
  })

  afterEach(() => {
    // Unconditional: a failing assertion must not leave a wrapper owning the
    // global for every later test in the run.
    for (const handle of handles) handle.dispose()
    globalThis.fetch = original
  })

  it('passes an unconfigured origin through with its arguments untouched', async () => {
    install({ current: emptyIndex() })
    const init: RequestInit = { method: 'POST', headers: { 'x-keep': '1' } }
    await globalThis.fetch('https://other.example.com/v1', init)
    expect(calls[0]?.input).toBe('https://other.example.com/v1')
    // Same init object identity: a non-matching request is not even copied.
    expect(calls[0]?.init).toBe(init)
  })

  it('injects the indexed user-agent and preserves the caller-owned headers', async () => {
    install({
      current: buildUserAgentIndex({
        agentrouter: {
          baseURL: 'https://relay.example.com',
          headers: { 'user-agent': 'claude-cli/2.1.161 (external, cli)' },
        },
      }),
    })
    await globalThis.fetch('https://relay.example.com/v1/messages', {
      method: 'POST',
      headers: {
        'user-agent': 'deepseek-harness/0.1.7 (+https://github.com/deepseek-ai/deepseek-harness)',
        'x-company': 'acme',
      },
    })
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('user-agent')).toBe('claude-cli/2.1.161 (external, cli)')
    expect(headers.get('x-company')).toBe('acme')
    expect(calls[0]?.init?.method).toBe('POST')
  })

  it('matches the exact origin, never a prefix of another host', async () => {
    install({
      current: buildUserAgentIndex({
        a: { baseURL: 'https://relay.example.com', headers: { 'user-agent': 'claude-cli/2.1.161' } },
      }),
    })
    const init: RequestInit = { headers: {} }
    await globalThis.fetch('https://relay.example.com.evil.test/v1', init)
    expect(calls[0]?.init).toBe(init)
  })

  it('seeds a Request own headers when the init names none, and lets the init win otherwise', async () => {
    install({
      current: buildUserAgentIndex({
        a: { baseURL: 'https://relay.example.com', headers: { 'user-agent': 'spoofed/1' } },
      }),
    })
    await globalThis.fetch(new Request('https://relay.example.com/v1', { headers: { 'x-own': 'kept' } }))
    expect(new Headers(calls[0]?.init?.headers).get('x-own')).toBe('kept')

    await globalThis.fetch(new Request('https://relay.example.com/v1', { headers: { 'x-request': 'dropped' } }), {
      headers: { 'x-init': 'wins' },
    })
    const merged = new Headers(calls[1]?.init?.headers)
    expect(merged.get('x-init')).toBe('wins')
    // Native semantics: an explicit init.headers replaces the Request's own.
    expect(merged.get('x-request')).toBeNull()
  })

  it('follows a live index swap without reinstalling', async () => {
    const source: OverlaySource = { current: emptyIndex() }
    install(source)
    await globalThis.fetch('https://relay.example.com/v1', { headers: {} })
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBeNull()

    source.current = buildUserAgentIndex({
      a: { baseURL: 'https://relay.example.com', headers: { 'user-agent': 'spoofed/2' } },
    })
    await globalThis.fetch('https://relay.example.com/v1', { headers: {} })
    expect(new Headers(calls[1]?.init?.headers).get('user-agent')).toBe('spoofed/2')

    // Emptying the index is how `uaOverride: false` stands down: the wrapper
    // stays installed and simply stops matching.
    source.current = emptyIndex()
    const init: RequestInit = { headers: {} }
    await globalThis.fetch('https://relay.example.com/v1', init)
    expect(calls[2]?.init).toBe(init)
  })

  it('installs one wrapper for every activation and restores the original last', () => {
    const base = globalThis.fetch
    const first = install({ current: emptyIndex() })
    const wrapper = globalThis.fetch
    const second = install({ current: emptyIndex() })
    expect(globalThis.fetch).toBe(wrapper)

    second.dispose()
    // Still wrapped: the first activation is alive.
    expect(globalThis.fetch).toBe(wrapper)
    expect(first.active).toBe(true)

    first.dispose()
    expect(globalThis.fetch).toBe(base)
    expect(headerOverlayInstalled()).toBe(false)
  })

  it('makes dispose idempotent', () => {
    const base = globalThis.fetch
    const handle = install({ current: emptyIndex() })
    handle.dispose()
    handle.dispose()
    expect(globalThis.fetch).toBe(base)
    expect(handle.active).toBe(false)
  })

  it('does not clobber a wrapper installed after it when restoring', () => {
    const handle = install({ current: emptyIndex() })
    // Someone else replaces the global while we are active.
    const later = vi.fn(() => Promise.resolve(new Response('{}'))) as unknown as typeof globalThis.fetch
    globalThis.fetch = later
    handle.dispose()
    // Our teardown must leave their wrapper alone.
    expect(globalThis.fetch).toBe(later)
  })

  it('lets the first activation serve when several register the same origin', async () => {
    install({
      current: buildUserAgentIndex({
        a: { baseURL: 'https://relay.example.com', headers: { 'user-agent': 'first/1' } },
      }),
    })
    install({
      current: buildUserAgentIndex({
        b: { baseURL: 'https://relay.example.com', headers: { 'user-agent': 'second/2' } },
      }),
    })
    await globalThis.fetch('https://relay.example.com/v1', { headers: {} })
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBe('first/1')
  })
})
