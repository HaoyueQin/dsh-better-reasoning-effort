/**
 * Unit tests for the probe route's header composition (src/index.ts
 * composeProbeHeaders): the provider profile's configured request headers
 * ride along under the accept/credential decisions, mirroring the harness's
 * own model-discovery discipline since 0.1.2-alpha.4.
 */

import { describe, expect, it } from 'vitest'

const { composeProbeHeaders } = await import('../src/index.js')

describe('composeProbeHeaders', () => {
  it('sends only accept when the profile names no headers and no credential resolved', () => {
    expect(composeProbeHeaders(undefined, undefined)).toEqual({ accept: 'application/json' })
  })

  it('carries the resolved credential as a Bearer', () => {
    expect(composeProbeHeaders(undefined, 'sk-test')).toEqual({
      accept: 'application/json',
      authorization: 'Bearer sk-test',
    })
  })

  it('merges the profile headers; accept and the credential win their names', () => {
    expect(
      composeProbeHeaders(
        { 'X-Api-Key': 'deploy-key', 'anthropic-version': '2023-06-01', accept: 'text/html' },
        'sk-test',
      ),
    ).toEqual({
      accept: 'application/json',
      'x-api-key': 'deploy-key',
      'anthropic-version': '2023-06-01',
      authorization: 'Bearer sk-test',
    })
  })

  it('keeps a profile authorization only when no credential resolved', () => {
    expect(composeProbeHeaders({ authorization: 'Bearer from-profile' }, 'sk-test')['authorization']).toBe('Bearer sk-test')
    expect(composeProbeHeaders({ authorization: 'Bearer from-profile' }, undefined)['authorization']).toBe('Bearer from-profile')
  })

  it('drops entries Fetch would refuse instead of failing the probe', () => {
    expect(composeProbeHeaders({ 'bad name': 'v', 'x-good': 'ok' }, undefined)).toEqual({
      accept: 'application/json',
      'x-good': 'ok',
    })
    expect(composeProbeHeaders({ 'x-bad': 'line1\nline2' }, undefined)).toEqual({ accept: 'application/json' })
  })
})
