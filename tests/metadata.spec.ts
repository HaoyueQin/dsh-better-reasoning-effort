/**
 * Plugin display-metadata declarations.
 *
 * The Host reads these without activating the plugin, and every miss falls
 * back SILENTLY — a card that loses its icon or its localized title reports
 * nothing. So the declarations, the files they point at, and the publication
 * list that has to carry those files are pinned together here.
 *
 * The ceilings and shapes mirror the author contract in the official
 * `docs/cookbook/adding-a-package.md` ("Add optional plugin display metadata");
 * this spec asserts the declarations, not a reimplementation of the Host's
 * reader.
 */

import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')

/** The Host's icon ceiling, in bytes. */
const ICON_BYTE_LIMIT = 256 * 1024

const manifest = JSON.parse(read('package.json')) as {
  icon?: string
  exports?: Record<string, unknown>
  files?: readonly string[]
}

describe('plugin display metadata', () => {
  it('declares an icon the published manifest also carries', () => {
    expect(manifest.icon).toBe('./icon.svg')
    expect(manifest.files).toContain('icon.svg')
  })

  it('exports the locale entry the Host looks up first', () => {
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    expect(manifest.files).toContain('locale/*.json')
  })

  it('keeps both dictionaries non-empty and JSON-parseable', () => {
    for (const language of ['en', 'zh']) {
      const meta = (JSON.parse(read(`locale/${language}.json`)) as { meta?: Record<string, unknown> }).meta
      // Language files are discovery entries: title and description both set.
      expect(Object.keys(meta ?? {}).sort()).toEqual(['description', 'title'])
      for (const value of Object.values(meta ?? {})) {
        expect(typeof value).toBe('string')
        expect((value as string).trim()).not.toBe('')
      }
    }
  })

  it('keeps the icon self-contained and under the Host byte ceiling', () => {
    const source = read('icon.svg')
    expect(source).toMatch(/<svg[\s>]/)
    expect(statSync(new URL('icon.svg', root)).size).toBeLessThanOrEqual(ICON_BYTE_LIMIT)
    // Rendered as an image: it reaches nothing outside its own file.
    expect(source).not.toMatch(/(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/|\.\.)/)
  })
})
