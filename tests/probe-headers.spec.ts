/**
 * Unit tests for the probe route's header composition (src/index.ts
 * composeProbeHeaders): the provider profile's configured request headers
 * ride along under the accept/credential decisions, mirroring the harness's
 * own model-discovery discipline on the 0.1.2-rc.1 kernel — Anthropic
 * Messages answers through x-api-key plus a fixed anthropic-version, OpenAI
 * protocols through a Bearer.
 */

import { describe, expect, it } from 'vitest'

const { composeProbeHeaders } = await import('../src/index.js')

describe('composeProbeHeaders (OpenAI protocols)', () => {
  it('sends only accept when the profile names no headers and no credential resolved', () => {
    expect(composeProbeHeaders(undefined, undefined, 'openai-completions')).toEqual({ accept: 'application/json' })
  })

  it('carries the resolved credential as a Bearer', () => {
    expect(composeProbeHeaders(undefined, 'sk-test', 'openai-responses')).toEqual({
      accept: 'application/json',
      authorization: 'Bearer sk-test',
    })
  })

  it('merges the profile headers; accept and the credential win their names', () => {
    expect(
      composeProbeHeaders(
        { 'X-Api-Key': 'deploy-key', 'anthropic-version': '2023-06-01', accept: 'text/html' },
        'sk-test',
        'openai-completions',
      ),
    ).toEqual({
      accept: 'application/json',
      'x-api-key': 'deploy-key',
      'anthropic-version': '2023-06-01',
      authorization: 'Bearer sk-test',
    })
  })

  it('keeps a profile authorization only when no credential resolved', () => {
    expect(composeProbeHeaders({ authorization: 'Bearer from-profile' }, 'sk-test', 'openai-completions')['authorization']).toBe('Bearer sk-test')
    expect(composeProbeHeaders({ authorization: 'Bearer from-profile' }, undefined, 'openai-completions')['authorization']).toBe('Bearer from-profile')
  })

  it('drops entries Fetch would refuse instead of failing the probe', () => {
    expect(composeProbeHeaders({ 'bad name': 'v', 'x-good': 'ok' }, undefined, 'openai-completions')).toEqual({
      accept: 'application/json',
      'x-good': 'ok',
    })
    expect(composeProbeHeaders({ 'x-bad': 'line1\nline2' }, undefined, 'openai-completions')).toEqual({ accept: 'application/json' })
  })
})

describe('composeProbeHeaders (Anthropic Messages)', () => {
  it('answers through x-api-key plus a fixed anthropic-version, never a Bearer', () => {
    expect(composeProbeHeaders(undefined, 'sk-ant-test', 'anthropic-messages')).toEqual({
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-ant-test',
    })
    expect(composeProbeHeaders(undefined, 'sk-ant-test', 'anthropic-messages')['authorization']).toBeUndefined()
  })

  it('keeps a profile anthropic-version overwritten by the fixed one and a profile x-api-key by the credential', () => {
    expect(
      composeProbeHeaders({ 'x-api-key': 'profile-key', 'anthropic-version': '2023-06-02' }, 'sk-ant-test', 'anthropic-messages'),
    ).toEqual({
      accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-ant-test',
    })
  })

  it('keeps a profile authorization untouched on the anthropic arm (the official compose leaves it)', () => {
    expect(composeProbeHeaders({ authorization: 'Bearer from-profile' }, 'sk-ant-test', 'anthropic-messages')['authorization']).toBe('Bearer from-profile')
  })
})
