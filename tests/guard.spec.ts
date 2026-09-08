/**
 * Default-guard decision tests (host half, issue #2).
 *
 * The guard rewrites exactly one request class -- an effort-less call to a
 * model whose declared ladder cannot switch thinking off -- into the
 * ladder's vendor default. Everything else passes through untouched, so a
 * guard failure can only ever reproduce today's behavior, never a new one.
 */

import { describe, expect, it } from 'vitest'
import { resolveGuardEffort } from '../src/guard.js'

describe('resolveGuardEffort', () => {
  it('leaves an explicit selection alone, including off', () => {
    expect(resolveGuardEffort({
      declared: { low: 'low', high: 'high', max: 'max' },
      vendorDefault: 'max',
      requested: 'low',
    })).toBeUndefined()
    expect(resolveGuardEffort({
      declared: { off: null, high: 'high' },
      vendorDefault: 'high',
      requested: 'off',
    })).toBeUndefined()
  })

  it('leaves ladders that can switch thinking off alone', () => {
    // off:null (Qwen switch) and off:'none' (GLM-5.2 stop value) both mean
    // the endpoint accepts some form of off -- Default stays Default.
    expect(resolveGuardEffort({
      declared: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
      vendorDefault: 'xhigh',
    })).toBeUndefined()
    expect(resolveGuardEffort({
      declared: { off: 'none', low: 'low', high: 'high' },
      vendorDefault: 'high',
    })).toBeUndefined()
  })

  it('leaves undeclared and non-reasoning models alone', () => {
    expect(resolveGuardEffort({ declared: undefined, vendorDefault: 'max' })).toBeUndefined()
    expect(resolveGuardEffort({ declared: false, vendorDefault: 'max' })).toBeUndefined()
  })

  it('injects the vendor default for forced-thinking ladders', () => {
    // glm-5.3-flash: no off key, default max is in the ladder -- this is the
    // request class that today becomes thinking:{type:disabled} (1210).
    expect(resolveGuardEffort({
      declared: { low: 'low', high: 'high', max: 'max' },
      vendorDefault: 'max',
    })).toBe('max')
  })

  it('yields to a route-level reasoning default', () => {
    // DSH core materializes profile.reasoning itself; injecting the vendor
    // default on top would clobber the deployment's explicit choice.
    expect(resolveGuardEffort({
      declared: { low: 'low', high: 'high', max: 'max' },
      vendorDefault: 'max',
      profileDefault: 'low',
    })).toBeUndefined()
  })

  it('refuses a vendor default outside the declared ladder', () => {
    // Injecting a level the adapter would reject with UNSUPPORTED_* turns
    // one failure into another -- fail open instead.
    expect(resolveGuardEffort({
      declared: { low: 'low', high: 'high', max: 'max' },
      vendorDefault: 'xhigh',
    })).toBeUndefined()
    expect(resolveGuardEffort({
      declared: { low: 'low', high: 'high', max: 'max' },
    })).toBeUndefined()
  })
})