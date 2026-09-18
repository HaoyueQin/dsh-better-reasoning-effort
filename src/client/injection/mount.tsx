/**
 * Foreign React roots mounted into the official shell's DOM.
 *
 * This plugin never becomes part of the host's React tree: it renders its own
 * roots into elements it inserts itself. These helpers are the whole of that
 * mechanism, plus the render-failure boundary that keeps a throwing subtree
 * from leaving an empty root behind.
 *
 * @module dsh-better-reasoning-effort/client/injection/mount
 */

import { Component, createElement } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

/**
 * The root this plugin scans. The official models page can live anywhere in
 * the settings surface (a hash-classed panel, a dialog, a portal), so guessing
 * a container is fragile — and the injector is idempotent and cheap, so
 * scanning the whole document is both safe and correct.
 */
export function panelRoot(): HTMLElement {
  return document.body
}

/** One foreign React root this plugin created, with the element holding it. */
export interface ForeignMount {
  wrapper: HTMLElement
  root: Root
}

/** Options of {@link mountReact}. */
export interface MountOptions {
  /**
   * Commit the subtree before returning (React's `flushSync`).
   *
   * REQUIRED for roots whose height the official model card measures: a root
   * that commits one frame later makes the card grow across frames, so its
   * anchored position is visible at the wrong height for at least one paint.
   */
  sync?: boolean
}

/** Create a React root inside `container` and render `children` into it. */
export function mountReact(container: HTMLElement, children: ReactNode, options?: MountOptions): ForeignMount {
  const root = createRoot(container)
  if (options?.sync === true) flushSync(() => { root.render(children) })
  else root.render(children)
  return { wrapper: container, root }
}

/**
 * Unmount a foreign root and detach its wrapper.
 *
 * `root.unmount()` runs the subtree's passive cleanups synchronously, so a
 * component that restored DOM on cleanup (the search filter) has done so by
 * the time the wrapper leaves the document.
 */
export function unmountReact(mount: ForeignMount | undefined): void {
  if (mount === undefined) return
  mount.root.unmount()
  mount.wrapper.remove()
}

/** Render-failure boundary: surfaces the cause instead of an empty root. */
export class EffortBoundary extends Component<{ children?: ReactNode; fallbackText: string }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[bre] editor render failed:', error, info.componentStack)
  }
  override render(): ReactNode {
    if (this.state.error !== null) {
      return createElement(
        'div',
        { style: { color: '#c00', fontSize: '11px', whiteSpace: 'pre-wrap', padding: '6px' } },
        `${this.props.fallbackText}: ${this.state.error}`,
      )
    }
    return this.props.children
  }
}
