/**
 * Effort-memory tests: the wire's full discipline — per-model memory, the
 * knowledge base's vendor-default fallback for models without one, respect
 * for explicit picks (a level, or a same-model "follow the provider
 * default"), the projection-restore watcher for level-less session restores,
 * the slider gate, defensive storage reads, and fiber-dispose restoration.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  rememberEffort,
  rememberedEffort,
  wireEffortMemory,
} from '../src/client/effort-memory.js'
import { setSliderEnabled } from '../src/client/slider-pref.js'
import type {
  DirectoryCurrentLike,
  ModelDirectoryLike,
  ModelDirectoryStateLike,
} from '../src/client/types.js'

const LEVELS = (...ids: string[]) => ids.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1) }))

/**
 * A directory snapshot spanning the fallback cases: two knowledge-base
 * families with DIFFERENT vendor defaults (gpt-5.6 → medium, kimi-k3 → max),
 * one unknown id (protocol inference → medium), a one-level ladder carrying
 * no memory and no vendor default, and one model with no reasoning metadata
 * at all. A non-null current carries `medium` unless `restore` asks for the
 * level-less shape a restored projection arrives in — otherwise wiring the
 * snapshot would immediately trigger (and pollute) the restore watcher.
 */
function stateWith(
  current: DirectoryCurrentLike | null,
  opts?: { restore?: boolean },
): ModelDirectoryStateLike {
  return {
    current: current === null || opts?.restore === true
      ? current
      : { ...current, reasoningEffort: 'medium' },
    routable: true,
    groups: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'gpt-5.6', name: 'GPT-5.6', reasoning: { efforts: LEVELS('low', 'medium', 'high', 'xhigh', 'max') } }],
      },
      {
        id: 'moonshot',
        name: 'Moonshot',
        models: [{ id: 'kimi-k3', name: 'Kimi K3', reasoning: { efforts: LEVELS('low', 'high', 'max') } }],
      },
      {
        id: 'generic',
        name: 'Gateway',
        models: [{ id: 'gateway-xyz-pro', name: 'Gateway Pro', reasoning: { efforts: LEVELS('low', 'medium', 'high') } }],
      },
      {
        // A directory whose one-model ladder carries neither a memory nor the
        // vendor default: the switch must stand down entirely.
        id: 'narrow',
        name: 'Narrow',
        models: [{ id: 'narrow-max', name: 'Narrow', reasoning: { efforts: LEVELS('xhigh') } }],
      },
      {
        id: 'plain',
        name: 'Plain',
        models: [{ id: 'plain-chat-9', name: 'Plain Chat' }],
      },
    ],
    failures: [],
    status: 'ready',
    error: null,
  }
}

type Selection = Parameters<ModelDirectoryLike['select']>[0]

/** A directory fake whose submissions are recorded; `state` is swappable. */
function fakeDirectory(
  initial: ModelDirectoryStateLike,
  opts?: { rejectSelects?: boolean },
): {
  directory: ModelDirectoryLike
  submitted: Selection[]
  update(next: ModelDirectoryStateLike): void
} {
  let state = initial
  const submitted: Selection[] = []
  const listeners = new Set<() => void>()
  const directory = {
    store: {
      getSnapshot: (): ModelDirectoryStateLike => state,
      subscribe(listener: () => void): () => void {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    load: async (): Promise<ModelDirectoryStateLike> => state,
    select: async (selection: Selection): Promise<unknown> => {
      // The real directory throws on a rejected selection (directory.ts).
      if (opts?.rejectSelects === true) {
        throw new Error('session.selectModel failed: session/invalid: no such effort')
      }
      submitted.push(selection)
      return undefined
    },
  }
  return {
    directory: directory as unknown as ModelDirectoryLike,
    submitted,
    update(next: ModelDirectoryStateLike): void {
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

beforeEach(() => {
  window.localStorage.clear()
  setSliderEnabled(true)
})

describe('effort memory storage', () => {
  it('round-trips per provider/model and degrades malformed documents to no memory', () => {
    expect(rememberedEffort('openai', 'gpt-5.6')).toBeUndefined()
    rememberEffort('openai', 'gpt-5.6', 'high')
    rememberEffort('moonshot', 'kimi-k3', 'off')
    expect(rememberedEffort('openai', 'gpt-5.6')).toBe('high')
    expect(rememberedEffort('moonshot', 'kimi-k3')).toBe('off')
    // The same model id under another provider is a DIFFERENT memory slot.
    expect(rememberedEffort('gateway', 'gpt-5.6')).toBeUndefined()

    window.localStorage.setItem('dsh-better-reasoning-effort.slider.efforts', 'not-json')
    expect(rememberedEffort('openai', 'gpt-5.6')).toBeUndefined()
    window.localStorage.setItem('dsh-better-reasoning-effort.slider.efforts', '{"openai/gpt-5.6":42,"": "x"}')
    expect(rememberedEffort('openai', 'gpt-5.6')).toBeUndefined()
  })
})

describe('wireEffortMemory: model switches', () => {
  it('records an explicit level for its exact model and submits untouched', async () => {
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      await fake.directory.select({ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high' })
      expect(fake.submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high' }])
      expect(rememberedEffort('openai', 'gpt-5.6')).toBe('high')
    } finally {
      restore()
    }
  })

  it('does not remember a REFUSED explicit pick', async () => {
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }), { rejectSelects: true })
    const restore = wireEffortMemory(fake.directory)
    try {
      await expect(
        fake.directory.select({ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'xhigh' }),
      ).rejects.toThrow('session.selectModel failed')
      // A refused pick must not poison the memory for every later switch.
      expect(rememberedEffort('openai', 'gpt-5.6')).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('re-applies the target model\'s own remembered level on a switch', async () => {
    rememberEffort('moonshot', 'kimi-k3', 'low')
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      await fake.directory.select({ provider: 'moonshot', model: 'kimi-k3' })
      expect(fake.submitted).toEqual([{ provider: 'moonshot', model: 'kimi-k3', reasoningEffort: 'low' }])
    } finally {
      restore()
    }
  })

  it('falls back to the vendor default when the target model has no memory', async () => {
    const fake = fakeDirectory(stateWith({ provider: 'plain', model: 'plain-chat-9' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      // Knowledge base family: the vendor's own documented default.
      await fake.directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(fake.submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' }])
      // Another family with a different vendor default.
      await fake.directory.select({ provider: 'moonshot', model: 'kimi-k3' })
      expect(fake.submitted[1]).toEqual({ provider: 'moonshot', model: 'kimi-k3', reasoningEffort: 'max' })
      // Unknown id: the inferred generic ladder's medium.
      await fake.directory.select({ provider: 'generic', model: 'gateway-xyz-pro' })
      expect(fake.submitted[2]).toEqual({ provider: 'generic', model: 'gateway-xyz-pro', reasoningEffort: 'medium' })
    } finally {
      restore()
    }
  })

  it('falls back to the vendor default when the remembered level is off the target ladder', async () => {
    // 'minimal' was picked on some other model; gpt-5.6's ladder lacks it.
    rememberEffort('openai', 'gpt-5.6', 'minimal')
    const fake = fakeDirectory(stateWith({ provider: 'moonshot', model: 'kimi-k3' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      await fake.directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(fake.submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' }])
    } finally {
      restore()
    }
  })

  it('leaves the switch untouched when no fallback lands on the advertised ladder', async () => {
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      // The advertised ladder carries neither a memory nor the vendor
      // default: the official behaviour stands.
      await fake.directory.select({ provider: 'narrow', model: 'narrow-max' })
      expect(fake.submitted).toEqual([{ provider: 'narrow', model: 'narrow-max' }])
      // No reasoning metadata at all: nothing to speak.
      await fake.directory.select({ provider: 'plain', model: 'plain-chat-9' })
      expect(fake.submitted[1]).toEqual({ provider: 'plain', model: 'plain-chat-9' })
    } finally {
      restore()
    }
  })

  it('passes through a same-model effort-less selection (explicit provider default)', async () => {
    rememberEffort('openai', 'gpt-5.6', 'high')
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      await fake.directory.select({ provider: 'openai', model: 'gpt-5.6' })
      expect(fake.submitted).toEqual([{ provider: 'openai', model: 'gpt-5.6' }])
    } finally {
      restore()
    }
  })

  it('gates the injection on the slider preference', async () => {
    rememberEffort('moonshot', 'kimi-k3', 'low')
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      setSliderEnabled(false)
      await fake.directory.select({ provider: 'moonshot', model: 'kimi-k3' })
      expect(fake.submitted).toEqual([{ provider: 'moonshot', model: 'kimi-k3' }])
    } finally {
      restore()
    }
  })

  it('is idempotent per instance and restores the original select on dispose', async () => {
    const fake = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const original = fake.directory.select
    const restore = wireEffortMemory(fake.directory)
    const noop = wireEffortMemory(fake.directory)
    try {
      expect(noop).not.toBe(restore)
      restore()
      // The original method is back: a switch no longer carries a level.
      expect(fake.directory.select).toBe(original)
      await fake.directory.select({ provider: 'moonshot', model: 'kimi-k3' })
      expect(fake.submitted).toEqual([{ provider: 'moonshot', model: 'kimi-k3' }])
    } finally {
      restore()
      // A second dispose stays harmless.
      restore()
    }
  })
})

describe('wireEffortMemory: restored projections', () => {
  it('re-applies the chain to a level-less projection resident at wire time', () => {
    // A restored session's projection lands WITHOUT going through select;
    // no memory for kimi-k3, so the vendor default (max) applies.
    const fake = fakeDirectory(stateWith({ provider: 'moonshot', model: 'kimi-k3' }, { restore: true }))
    const restore = wireEffortMemory(fake.directory)
    try {
      expect(fake.submitted).toEqual([{ provider: 'moonshot', model: 'kimi-k3', reasoningEffort: 'max' }])
      // The watcher's own re-apply is a memory READ, not a user pick.
      expect(rememberedEffort('moonshot', 'kimi-k3')).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('prefers the model memory, then never fights an explicit provider default', () => {
    rememberEffort('moonshot', 'kimi-k3', 'low')
    const fake = fakeDirectory(stateWith({ provider: 'plain', model: 'plain-chat-9' }))
    const restore = wireEffortMemory(fake.directory)
    try {
      // The restored projection arrives after wiring (history load).
      fake.update(stateWith({ provider: 'moonshot', model: 'kimi-k3' }, { restore: true }))
      expect(fake.submitted).toEqual([{ provider: 'moonshot', model: 'kimi-k3', reasoningEffort: 'low' }])
      // The session then goes level-less again (an explicit provider-default
      // pick landed): the spent attempt must NOT re-fight the user.
      fake.update(stateWith({ provider: 'moonshot', model: 'kimi-k3' }, { restore: true }))
      expect(fake.submitted).toHaveLength(1)
    } finally {
      restore()
    }
  })

  it('leaves restored projections alone when gated or already levelled', () => {
    // A projection carrying its own level is respected as-is.
    const levelled = fakeDirectory(stateWith({ provider: 'openai', model: 'gpt-5.6' }))
    const restoreLevelled = wireEffortMemory(levelled.directory)
    try {
      expect(levelled.submitted).toHaveLength(0)
    } finally {
      restoreLevelled()
    }
    // Slider preference off: no restore at all.
    rememberEffort('moonshot', 'kimi-k3', 'low')
    setSliderEnabled(false)
    const gated = fakeDirectory(stateWith({ provider: 'moonshot', model: 'kimi-k3' }, { restore: true }))
    const restoreGated = wireEffortMemory(gated.directory)
    try {
      expect(gated.submitted).toHaveLength(0)
      // A later store update stays quiet too (the gate is checked first).
      gated.update(stateWith({ provider: 'moonshot', model: 'kimi-k3' }, { restore: true }))
      expect(gated.submitted).toHaveLength(0)
    } finally {
      restoreGated()
    }
  })
})
