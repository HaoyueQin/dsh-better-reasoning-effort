/**
 * Plugin-wide constants shared by the host and browser halves.
 *
 * @module dsh-better-reasoning-effort/constants
 */

/** Stable plugin id, matching the cordis.patch.yml row and the bundle id. */
export const PLUGIN_ID = 'dsh-better-reasoning-effort'

/** Same-origin host route that proxies a provider's RAW /models listing. */
export const PROBE_PATH = '/dsh-better-reasoning-effort/raw-models'

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
 * It exists because the host fills in-process the moment a provider is
 * committed, while the browser's staged-declaration flush waits out its scan
 * debounce: by the time the flush compares the document against its own
 * suggestion, the suggestion is already there. Byte equality alone cannot then
 * tell "the plugin wrote this" from "the user declared this" -- a staged ladder
 * that differs from the knowledge base in even one spelling (the editor's
 * `off: null` against the knowledge base's `off: 'none'`) was dropped as a
 * document takeover, i.e. the reported "configured it on the add-provider card,
 * saved, and it is gone".
 *
 * With the marker the flush knows the stored ladder is a suggestion, so a
 * staged user intent overrides it. Either way the user's bytes win; the marker
 * only decides whether the flush is allowed to write at all. Schemastery passes
 * unknown model keys through, so the marker survives official-page saves and
 * restarts like the other two markers. Any ladder written through the plugin
 * clears it, which is what makes a later hand edit outrank a fresh staging.
 */
export const AUTOFILL_MARKER = 'reasoningEffortsAutofilled'

/** Locale dictionary namespace for the browser half's copy (not a settings namespace). */
export const STORE_NS = PLUGIN_ID
