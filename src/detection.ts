/**
 * Endpoint reasoning/modality-signal detection over a provider's RAW /models
 * listing.
 *
 * The sanctioned `llm.discoverModels` wire call strips capability signals
 * host-side, so the host half proxies the raw listing through a same-origin
 * route; this module is the pure half both ends share. Detection approach
 * follows the format survey proven by dsh-reasoning-efforts (MIT): listings
 * disclose capabilities under several field conventions, and "no signal"
 * must stay distinct from "explicitly unsupported" -- for modalities just as
 * for reasoning.
 *
 * @module dsh-better-reasoning-effort/detection
 */

/** One raw /models listing entry: pass through unknown fields untouched. */
export type RawModelEntry = Record<string, unknown>

/** Tri-state endpoint signal: true reasons, false explicitly does not, 'unknown' = the listing never said. */
export type EndpointReasoning = boolean | 'unknown'

/**
 * What the endpoint disclosed about one model. Every part is independent and
 * may be absent: an absent part means the listing never spoke about it (or
 * the probe never ran) -- silence is not refusal.
 */
export interface EndpointSignal {
  reasoning: EndpointReasoning
  /** The listing field that produced the reasoning signal, null when none did. */
  source: string | null
  /**
   * The listing's input-modality disclosure, lowercased, when it named a
   * field we recognize. Members outside the harness's image/text world
   * (audio, video, pdf/file) are passed through verbatim -- the knowledge
   * layer owns the intersection with the core vocabulary.
   */
  input?: readonly string[]
  /** Context length the listing disclosed, when it carries one. */
  contextLength?: number
}

import { isRecord } from './shared.js'

const hasString = (entry: Record<string, unknown>, key: string): boolean => {
  const value = entry[key]
  return typeof value === 'string' && value.length > 0
}

const hasBoolean = (entry: Record<string, unknown>, key: string): boolean =>
  typeof entry[key] === 'boolean'

/** Find the raw listing entry for one model id. */
export function findListingEntry(
  listing: unknown,
  modelId: string,
): RawModelEntry | undefined {
  if (!Array.isArray(listing)) return undefined
  for (const entry of listing) {
    if (isRecord(entry) && entry['id'] === modelId) return entry
  }
  return undefined
}

/**
 * Read one listing entry's REASONING signal. Field conventions covered:
 *   - `supported_features: [..., "reasoning"]`        (rich feature arrays)
 *   - `supported_parameters: [..., "reasoning" | "include_reasoning" |
 *      "reasoning_effort"]`                           (OpenRouter-style)
 *   - `supports_reasoning` / `supportsReasoning`      (boolean flags)
 *   - `can_reason` / `reasoning`                      (boolean flags)
 *   - top-level `reasoning_effort` / `supports_reasoning_effort`
 *
 * A bare `{id, object, owned_by}` listing yields 'unknown' -- that is NOT
 * "unsupported": the endpoint simply never said.
 */
export function analyzeListingEntry(entry: unknown): EndpointSignal {
  if (!isRecord(entry)) return { reasoning: 'unknown', source: null }
  const features = entry['supported_features']
  if (Array.isArray(features) && features.includes('reasoning')) {
    return { ...signalParts(entry), reasoning: true, source: 'supported_features' }
  }
  const parameters = entry['supported_parameters']
  if (
    Array.isArray(parameters) &&
    (parameters.includes('reasoning') ||
      parameters.includes('include_reasoning') ||
      parameters.includes('reasoning_effort'))
  ) {
    return { ...signalParts(entry), reasoning: true, source: 'supported_parameters' }
  }
  if (hasBoolean(entry, 'supports_reasoning')) {
    return { ...signalParts(entry), reasoning: entry['supports_reasoning'] as boolean, source: 'supports_reasoning' }
  }
  if (hasBoolean(entry, 'supportsReasoning')) {
    return { ...signalParts(entry), reasoning: entry['supportsReasoning'] as boolean, source: 'supportsReasoning' }
  }
  if (hasBoolean(entry, 'can_reason')) {
    return { ...signalParts(entry), reasoning: entry['can_reason'] as boolean, source: 'can_reason' }
  }
  if (hasBoolean(entry, 'reasoning')) {
    return { ...signalParts(entry), reasoning: entry['reasoning'] as boolean, source: 'reasoning' }
  }

  // A present, meaningful effort field signals support; a null placeholder —
  // or an empty string, which some gateways emit as a filler — says nothing
  // and must stay 'unknown' (tri-state discipline).
  const effortField = entry['reasoning_effort']
  if (
    (effortField !== undefined && effortField !== null && !(typeof effortField === 'string' && effortField.trim().length === 0)) ||
    entry['supports_reasoning_effort'] === true
  ) {
    return { ...signalParts(entry), reasoning: true, source: 'reasoning_effort' }
  }
  // The nested capabilities object is the Anthropic Messages listing shape —
  // the shape the kernel's own discovery picked up at 0.1.3-alpha.1 (this probe
  // has read it since the 0.3.5 line): thinking.supported and effort.supported
  // are the two disclosures that say a model reasons. An explicit false is a
  // refusal, not silence.
  const capabilities = isRecord(entry['capabilities']) ? entry['capabilities'] : undefined
  if (capabilities !== undefined) {
    const thinking = capabilities['thinking']
    if (isRecord(thinking) && typeof thinking['supported'] === 'boolean') {
      return {
        ...signalParts(entry),
        reasoning: thinking['supported'] as boolean,
        source: 'capabilities.thinking.supported',
      }
    }
    const effort = capabilities['effort']
    if (isRecord(effort) && typeof effort['supported'] === 'boolean') {
      return {
        ...signalParts(entry),
        reasoning: effort['supported'] as boolean,
        source: 'capabilities.effort.supported',
      }
    }
  }
  return { ...signalParts(entry), reasoning: 'unknown', source: null }
}

/**
 * Read one listing entry's MODALITY + CAPACITY disclosures. Field conventions
 * covered:
 *   - `architecture.input_modalities: ["text","image",...]` (OpenRouter and
 *     every aggregator that mirrors it)
 *   - top-level `input_modalities: [...]`                     (flattened copies)
 *   - `modalities: { input: [...] }`                          (models.dev style)
 *   - `supported_features: [..., "vision"]` /
 *     `capabilities: [..., "vision"]`                         (feature arrays)
 *   - `supports_vision` / `supportsVision`                    (boolean flags)
 *   - `context_length` / `top_provider.context_length`        (OpenRouter capacity)
 *
 * Absence stays absent: a listing that names no recognized field yields no
 * `input` part at all -- never an implicit "text only".
 */
function signalParts(entry: Record<string, unknown>): Pick<EndpointSignal, 'input' | 'contextLength'> {
  const parts: { input?: readonly string[]; contextLength?: number } = {}

  const rawList = (value: unknown): readonly string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const members = value.filter((item): item is string => typeof item === 'string')
    return members.length > 0 ? members.map(member => member.toLowerCase()) : []
  }

  const architecture = isRecord(entry['architecture']) ? entry['architecture'] : undefined
  let input = rawList(architecture?.['input_modalities'])
  if (input === undefined) input = rawList(entry['input_modalities'])
  if (input === undefined) {
    const modalities = isRecord(entry['modalities']) ? entry['modalities'] : undefined
    input = rawList(modalities?.['input'])
  }
  if (input === undefined) {
    const capabilityArray = entry['capabilities']
    const visionIn = (list: unknown): boolean =>
      Array.isArray(list) && list.some(item => typeof item === 'string' && item.toLowerCase() === 'vision')
    if (visionIn(entry['supported_features']) || visionIn(capabilityArray)) {
      input = ['image']
    } else if (isRecord(capabilityArray)) {
      // The Anthropic Messages listing nests modality booleans as
      // capabilities.<modality>.supported — the shape the 0.1.3-alpha.1
      // discovery added to the interrogations. An explicit false answers
      // with the text floor (refusal, not silence).
      const members: string[] = []
      for (const key of ['image_input', 'video_input', 'pdf_input', 'file_input']) {
        const slot = isRecord(capabilityArray[key]) ? capabilityArray[key] : undefined
        if (slot === undefined || typeof slot['supported'] !== 'boolean') continue
        const member = key.replace(/_input$/, '')
        if (slot['supported'] === true) members.push(member)
        else if (members.length === 0) members.push('text')
      }
      if (members.length > 0) input = members
    }
  }
  if (input === undefined) {
    if (hasBoolean(entry, 'supports_vision')) input = entry['supports_vision'] === true ? ['image'] : []
    else if (hasBoolean(entry, 'supportsVision')) input = entry['supportsVision'] === true ? ['image'] : []
  }
  // An empty disclosure still ANSWERED: an explicit refusal (supports_vision:
  // false, or a gateway declaring no members at all) maps to the text floor
  // every supported protocol carries -- so the fusion layer can strip an
  // image claim instead of mistaking refusal for silence.
  if (input !== undefined) parts.input = input.length === 0 ? ['text'] : input

  // Capacity conventions: top-level, OpenRouter's top_provider, the Anthropic
  // native max_input_tokens (a 0 placeholder means 'not disclosed' — never a
  // real zero), and the models-dev limit.context.
  const length = entry['context_length']
  if (typeof length === 'number' && Number.isFinite(length) && length > 0) {
    parts.contextLength = length
  } else {
    const topProvider = isRecord(entry['top_provider']) ? entry['top_provider'] : undefined
    const nested = topProvider?.['context_length']
    if (typeof nested === 'number' && Number.isFinite(nested) && nested > 0) {
      parts.contextLength = nested
    } else {
      const maxInput = entry['max_input_tokens']
      if (typeof maxInput === 'number' && Number.isFinite(maxInput) && maxInput > 0) {
        parts.contextLength = maxInput
      } else {
        const limit = isRecord(entry['limit']) ? entry['limit'] : undefined
        const limitContext = limit?.['context']
        if (typeof limitContext === 'number' && Number.isFinite(limitContext) && limitContext > 0) {
          parts.contextLength = limitContext
        }
      }
    }
  }

  return parts
}

/**
 * Detect one model's endpoint signal from a raw listing.
 * @returns the signal, plus whether the model appeared in the listing at all.
 */
export function detectModelSignal(
  listing: unknown,
  modelId: string,
): { found: boolean; signal: EndpointSignal } {
  const entry = findListingEntry(listing, modelId)
  if (entry === undefined) return { found: false, signal: { reasoning: 'unknown', source: null } }
  return { found: true, signal: analyzeListingEntry(entry) }
}
