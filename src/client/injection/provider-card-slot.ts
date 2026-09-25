/**
 * The provider-card slot registration: the seat the request-header editor
 * (issue #12) renders in.
 *
 * `settings.models.provider-card` is a KEYED slot declared by the official
 * Models section, dispatched on each card's owning settings namespace
 * (`ProviderDirectoryEntry.settingsNs`). Registering under `llm-pi-ai` is
 * therefore all it takes to receive every card of this adapter family — the
 * shipped routes, the ones the user adds, and the hand-declared ones alike —
 * without a DOM anchor, a mutation observer, or a label to match on.
 *
 * The ROUTE is not a registration-time fact: the section passes each occurrence
 * its directory row as owner props, so the route arrives on the component at
 * render time and one registration serves every card.
 *
 * @module dsh-better-reasoning-effort/client/injection/provider-card-slot
 */

import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { PI_AI_NS, PLUGIN_ID } from '../../constants.js'
import { HeadersEditor } from '../HeadersEditor.js'
import type { ClientContext, RemoteApi, SlotRegistrarFace } from '../types.js'

/** The keyed-slot key this plugin occupies: the adapter family it extends. */
const SLOT = 'settings.models.provider-card'

/**
 * The occurrence props the official Models section hands one provider-card
 * extension (its own `ProviderCardExtrasOwnerProps`). Declared structurally for
 * the same reason as {@link SlotRegistrarFace}: the plugin pins only what it
 * reads, so a field the section adds cannot break activation.
 */
interface ProviderCardOccurrence {
  /** The card's directory row; `provider` is the settings route key. */
  provider?: { provider?: string }
}

/** Props the occurrence component receives: the section's share plus ours. */
export type ProviderCardSlotProps = ProviderCardOccurrence & { api: RemoteApi; t: Translate }

/**
 * The occurrence component: resolve this card's route, render the editor, and
 * publish the card's open/closed state so the section reveals itself with the
 * official editor. Exported for its own tests (the registration below is the
 * production path).
 */
export function ProviderCardSlot({ provider, api, t }: ProviderCardSlotProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  // Whether the official card currently shows its editor. Reported onto the
  // wrapper as `data-edit`, which is what the stylesheet keys the section's
  // visibility on.
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const wrapper = host.current
    // No card row around us (a bare render) means no card state to observe:
    // `false` keeps the section hidden, which is the only safe default.
    const card = wrapper?.closest('li') ?? null
    if (wrapper === null || card === null) return
    const observed = card as unknown as Node
    const openEditor = (): boolean => card.querySelector('[class*="_editor"]') !== null
    let pending = false
    const sync = (): void => {
      pending = false
      setEditing(openEditor())
    }
    const schedule = (): void => {
      // Coalesce a burst of mutations into one render on the next microtask:
      // the card toggles several children at once while opening, and a
      // microtask drains with the same batch the mutation arrived in.
      if (pending) return
      pending = true
      queueMicrotask(sync)
    }
    sync()
    const observer = new MutationObserver(schedule)
    // Child list only, and subtree: the editor element itself arrives as a
    // child of the row, and its own internals are irrelevant here.
    observer.observe(observed, { childList: true, subtree: true })
    return () => {
      pending = false
      observer.disconnect()
    }
  }, [])

  const route = provider?.provider
  // A card with no resolvable route is not this section's business: render
  // nothing rather than an editor that could not address a settings key.
  if (typeof route !== 'string' || route.length === 0) return null
  return createElement(
    'div',
    { ref: host, className: 'bre-headers-host', 'data-edit': editing ? '1' : '0' },
    createElement(HeadersEditor, { route, routeDisplayName: route, api, t }),
  )
}

/**
 * Take the provider-card seat.
 * @param ctx - client root context (its `slots` service registers the seat).
 * @param api - the settings Remote the editor reads and writes through.
 * @param t - the plugin's locale-bound translator.
 * @returns the seat's disposer, or a no-op when the seat is unavailable.
 */
export function registerProviderCardSlot(ctx: ClientContext, api: RemoteApi, t: Translate): () => void {
  const host = ctx as unknown as { slots?: SlotRegistrarFace }
  // `inject` is the seam the official registrar binds to the calling scope;
  // wire whatever comes back so a plugin disable / HMR leaves no seat behind.
  const injected = host.slots?.inject(SLOT, () => {
    host.slots?.register({
      name: SLOT,
      // The keyed dispatch key. `llm-pi-ai` is the ONLY family this plugin
      // extends, so one registration covers every card; other adapter families
      // dispatch other keys and never reach this component.
      key: PI_AI_NS,
      inject: () => ({ api, t }),
    }, ProviderCardSlot)
  })
  return typeof injected === 'function' ? injected as () => void : () => {}
}
