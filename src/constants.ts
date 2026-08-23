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

/** Locale dictionary namespace for the browser half's copy (not a settings namespace). */
export const STORE_NS = PLUGIN_ID
