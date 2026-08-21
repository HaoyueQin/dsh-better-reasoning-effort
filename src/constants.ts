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

/** Locale dictionary namespace for the browser half's copy (not a settings namespace). */
export const STORE_NS = PLUGIN_ID

/** DOM marker used by the injector's idempotency guard. */
export const PLUGIN_MARKER = PLUGIN_ID
