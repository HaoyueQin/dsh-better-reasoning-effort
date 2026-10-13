/**
 * Coexistence report for the user-agent takeover (issue #12, MVP-3).
 *
 * Overriding `user-agent` is not a private act: the stock adapter drops the
 * profile's value, so at least one published plugin patches the adapter itself
 * to keep it, and several more wrap fetch. Two of them active at once means the
 * LAST writer on the wire wins and the user sees a `user-agent` they did not
 * choose — with no error anywhere. This module reports what it found instead of
 * silently fighting.
 *
 * Three signals, in descending reliability:
 *   1. The adapter file already carries a user-agent patch (its `requestHeaders`
 *      body no longer drops the profile's `user-agent`) — readable fact.
 *   2. A known sibling plugin's package is installed in a reachable tree.
 *   3. Nothing found.
 *
 * Everything here is best-effort and side-effect-free: an unreadable path, an
 * absent tree, or a hostile `package.json` yields `unknown`, never a throw —
 * this report must not be able to disable the plugin.
 *
 * @module dsh-better-reasoning-effort/headers-conflict
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/**
 * Sibling plugins that rewrite the same request surface. The list is by PACKAGE
 * NAME, matched anywhere in a reachable `node_modules`: a plugin installed
 * under a profile but not enabled is reported as installed, and the report says
 * so rather than guessing at enablement (which a patch file or a hand-edited
 * profile can decide several ways).
 */
const SIBLING_PACKAGES = [
  'dsh-client-masquerade',
  'dsh-llm-headers',
  'dsh-llm-pi-ai-headers',
  'dsh-custom-provider-settings',
] as const

/**
 * Fragments proving the installed adapter already preserves a profile
 * `user-agent`. The published patch rewrites `requestHeaders()` to look for a
 * configured value; older revisions of it used the same identifier, so the
 * check survives their textual reshuffle while staying specific enough that the
 * stock function cannot match (it contains neither).
 */
const ADAPTER_PATCH_MARKERS = ['configuredUserAgent', 'masquerade routes rely on'] as const

/** What the report found about the adapter the requests actually flow through. */
export type AdapterPatchState = 'patched' | 'stock' | 'unknown'

/** One sibling plugin package found on disk. */
export interface InstalledSibling {
  /** Package name. */
  name: string
  /** Absolute path of the resolved package directory (or entry file). */
  path: string
}

/** The coexistence report. */
export interface HeaderConflictReport {
  /** Whether the installed `@deepseek-ai/dsh-llm-pi-ai` adapter carries a UA patch. */
  adapter: AdapterPatchState
  /** Path of the inspected adapter file, when one was found. */
  adapterPath?: string
  /** Known sibling plugins present on disk. */
  siblings: InstalledSibling[]
  /**
   * Whether this deployment should prefer the official layer instead of this
   * plugin's fetch takeover: true exactly when the adapter is already patched
   * (a profile `user-agent` reaches the wire on its own then, and a fetch
   * override on top would fight the patch).
   */
  preferOfficialLayer: boolean
}

/** Candidate `node_modules` roots to look in, most specific first. */
function searchRoots(): string[] {
  const roots = new Set<string>()
  const entry = process.argv[1]
  if (typeof entry === 'string' && entry.length > 0) {
    let dir = dirname(resolve(entry))
    // Walk up a bounded number of levels: the shim, the bin dir, the package,
    // the install root.
    for (let depth = 0; depth < 8; depth += 1) {
      roots.add(join(dir, 'node_modules'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  // The cwd tree covers a profile-relative launch; the require chain covers
  // everything the process itself can no longer name.
  roots.add(join(process.cwd(), 'node_modules'))
  try {
    const require = createRequire(import.meta.url)
    for (const name of SIBLING_PACKAGES) {
      try {
        roots.add(join(dirname(dirname(dirname(require.resolve(`${name}/package.json`)))), 'node_modules'))
      } catch {
        // Not resolvable from here; the path search below covers the rest.
      }
    }
  } catch {
    // No require chain: path search alone.
  }
  return [...roots]
}

/** Locate the installed pi-ai adapter's bundle, or undefined when unreachable. */
function findAdapterFile(): string | undefined {
  const relative = join('@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')
  const candidates: string[] = []
  try {
    const require = createRequire(import.meta.url)
    candidates.push(require.resolve('@deepseek-ai/dsh-llm-pi-ai'))
  } catch {
    // Resolve by location instead.
  }
  // dsh ships the adapter inside its own tree; probing the entry's ancestry
  // finds it for a global install, a profile install, and a monorepo alike.
  for (const root of searchRoots()) candidates.push(join(root, relative))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Whether a source text of the pi-ai adapter bundle carries a user-agent patch.
 *
 * Pure, so the decision is testable without touching a real installation: the
 * stock `requestHeaders()` filters the profile's `user-agent` into the reserved
 * set and contains neither marker, while every published revision of the patch
 * names the value it found.
 * @param source - the adapter bundle's text.
 * @returns whether the patch is present.
 */
export function adapterSourcePatched(source: string): boolean {
  return ADAPTER_PATCH_MARKERS.some(marker => source.includes(marker))
}

/** Whether the adapter bundle at one path carries a user-agent patch. */
function adapterPatchState(path: string): AdapterPatchState {
  try {
    return adapterSourcePatched(readFileSync(path, 'utf8')) ? 'patched' : 'stock'
  } catch {
    return 'unknown'
  }
}

/** Known sibling plugins present in a reachable tree. */
function findSiblings(): InstalledSibling[] {
  const found: InstalledSibling[] = []
  const seen = new Set<string>()
  for (const root of searchRoots()) {
    for (const name of SIBLING_PACKAGES) {
      if (seen.has(name)) continue
      const dir = join(root, name)
      const manifest = join(dir, 'package.json')
      if (!existsSync(manifest)) continue
      seen.add(name)
      found.push({ name, path: dir })
    }
  }
  return found
}

/**
 * Produce the coexistence report. Never throws: every probe degrades to
 * `unknown` / an empty list.
 * @returns the report.
 */
export function detectHeaderConflicts(): HeaderConflictReport {
  let adapter: AdapterPatchState = 'unknown'
  let adapterPath: string | undefined
  let siblings: InstalledSibling[] = []
  try {
    adapterPath = findAdapterFile()
    if (adapterPath !== undefined) adapter = adapterPatchState(adapterPath)
  } catch {
    adapter = 'unknown'
  }
  try {
    siblings = findSiblings()
  } catch {
    siblings = []
  }
  return {
    adapter,
    ...(adapterPath === undefined ? {} : { adapterPath }),
    siblings,
    preferOfficialLayer: adapter === 'patched',
  }
}
