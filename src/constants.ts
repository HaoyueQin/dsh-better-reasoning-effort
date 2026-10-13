/**
 * Plugin-wide constants shared by the host and browser halves.
 *
 * @module dsh-better-reasoning-effort/constants
 */

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const PLUGIN_ID = 'dsh-better-reasoning-effort'

/** Same-origin host route that proxies a provider's RAW /models listing. */
export const PROBE_PATH = '/dsh-better-reasoning-effort/raw-models'

/**
 * Same-origin host route that reports this plugin's autofill switches. The
 * browser half runs the running auto-fill complement, and a `dsh.client`
 * declaration carries no plugin config, so the two switches have to be read
 * from the host that owns the cordis row; without it a deployment that turned
 * `autofill: false` would still be written to from the page.
 */
export const AUTOFILL_CONFIG_PATH = '/dsh-better-reasoning-effort/autofill-config'

/**
 * Same-origin host route reporting the request-header overlay (issue #12): the
 * routes whose `user-agent` the plugin is overriding, and what it found of the
 * plugins that rewrite the same surface. The browser half renders the
 * coexistence warning from here — the takeover lives host-side, so the page
 * cannot observe it on its own.
 */
export const HEADERS_CONFIG_PATH = '/dsh-better-reasoning-effort/headers-config'

/** The settings namespace this plugin edits: pi-ai custom provider routes. */
export const PI_AI_NS = 'llm-pi-ai'

/**
 * Model-level marker written when the user deliberately unsets the
 * declaration ("back to inheritance"). Schemastery passes unknown model keys
 * through, so the marker survives official-page saves and restarts — which is
 * the point: auto-fill must respect the absence as a decision, not as a gap
 * to fill.
 */
export const UNSET_MARKER = 'reasoningEffortsUnset'

/**
 * Model-level marker for a deliberately unset input-modality declaration,
 * mirroring {@link UNSET_MARKER}: auto-fill must respect the absence of
 * `input` as a decision (the route default applies), not as a gap to fill.
 */
export const INPUT_UNSET_MARKER = 'inputUnset'

/**
 * Model-level provenance marker written beside every ladder the HOST autofill
 * fills from the knowledge base, carrying the settings revision the fill read.
 *
 * It exists because the plugin's auto-fill and the user's staged declaration
 * race on the SAME row: whichever half runs the fill writes the knowledge base
 * suggestion, while the staged-declaration flush compares the document against
 * its own suggestion. By the time the flush looks, the suggestion may already
 * be stored -- and byte equality alone cannot tell "the plugin wrote this" from
 * "the user declared this", so a staged ladder differing from the knowledge
 * base in even one spelling (the editor's `off: null` against the knowledge
 * base's `off: 'none'`) was dropped as a document takeover: the reported
 * "configured it on the add-provider card, saved, and it is gone".
 *
 * With the marker the flush knows the stored ladder is a suggestion, so a
 * staged user intent overrides it. Either way the user's bytes win; the marker
 * only decides whether the flush is allowed to write at all. Schemastery passes
 * unknown model keys through, so the marker survives official-page saves and
 * restarts like the other two markers. Any ladder written through the plugin
 * clears it, which is what makes a later hand edit outrank a fresh staging.
 */
export const AUTOFILL_MARKER = 'reasoningEffortsAutofilled'

/**
 * Model-level default-effort pick (issue #4): the level a brand-new session
 * starts this model at, outranking the remembered levels. The value is one of
 * the model's own declared ladder keys, or the field is absent when the user
 * has not picked one (memory chain applies). Deliberately NOT a harness
 * concept: pi-ai's runtime never sees it (unknown model keys ride the settings
 * document the way the other markers do), and the browser half is its only
 * consumer. The name matches the catalog's `reasoning.defaultEffort` spelling
 * so a future first-class field can adopt the stored values as-is.
 */
export const DEFAULT_EFFORT_FIELD = 'defaultEffort'

/** Locale dictionary namespace for the browser half's copy (not a settings namespace). */
export const STORE_NS = PLUGIN_ID
