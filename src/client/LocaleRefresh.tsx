/**
 * Re-translates a mounted subtree when the shell's active language changes.
 *
 * `ctx.locale.bind()` hands out ONE stable translate function per namespace
 * (memo-safety by design, so the reference can ride inject surfaces), which
 * leaves a mounted subtree with no signal that the copy it rendered is stale:
 * the function is the same object, and nothing re-renders to call it again.
 * The shell's own outlets do not have this problem — the slot renderer
 * re-derives their `t` from (namespace, revision), so a language switch hands
 * them a NEW function. Our editors mount through `createRoot` and sit outside
 * that machinery entirely, so they need the revision subscription spelled out.
 *
 * `children` is a thunk on purpose: returning a cached element would let React
 * bail out of the subtree (an unchanged element reference short-circuits the
 * re-render), so it has to be rebuilt on every render.
 *
 * @module dsh-better-reasoning-effort/client/LocaleRefresh
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

/** The slice of the shell's locale service this component consumes. */
export interface LocaleFace {
  /** Notified on every snapshot change (language switch or registration). */
  subscribe(fn: () => void): () => void
  /** Current snapshot; `revision` moves on every change. */
  getSnapshot(): { revision?: number }
}

export interface LocaleRefreshProps {
  /** The shell's locale service, acting as its own LocaleFace. */
  locale: LocaleFace
  /** Rebuilt on every render — see the module docblock. */
  children: () => ReactNode
}

/** Re-render {@link LocaleRefreshProps.children} on every locale revision bump. */
export function LocaleRefresh(props: LocaleRefreshProps): ReactNode {
  const { locale } = props
  useSyncExternalStore(
    (notify) => locale.subscribe(notify),
    () => locale.getSnapshot().revision ?? 0,
  )
  return props.children()
}
