/**
 * The reasoning-effort knowledge base + wire-protocol inference engine.
 *
 * Every model a third-party provider route serves must declare its
 * `reasoningEfforts` (which DSH thinking levels it accepts, and the exact
 * string to send on the wire for each) before the composer's model picker
 * offers any reasoning control for it. This module answers "what should this
 * model's declaration be?" from two sources, in order:
 *
 *   1. A curated knowledge base keyed by model id/name patterns, carrying the
 *      exact level set, wire spellings, and `compat` (thinkingFormat etc.)
 *      known to work against that family of endpoints.
 *   2. Wire-protocol inference from the route's `api` / `baseURL`: a
 *      best-effort level set for families the knowledge base does not name.
 *
 * Both sources stay on the adapter's own vocabulary (`THINKING_LEVELS`, the
 * `reasoningEfforts` dict shape) so a suggested declaration can be written to
 * `llm-pi-ai` settings with no translation step. A suggestion is a *preset*:
 * the user can accept it, tune it, or ignore it. The plugin never silently
 * overwrites a declaration the user already made.
 *
 * @module dsh-better-reasoning-effort/knowledge
 */

/** The canonical pi-ai escalation order accepted by `llm-pi-ai`. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** One level's wire spelling; `null` means "send nothing for this level". */
export type WireSpelling = string | null

/** A full reasoning-effort declaration value: level → wire spelling. */
export type ReasoningEfforts = Partial<Record<ThinkingLevel, WireSpelling>>

/** The `compat` fields this plugin may suggest (a subset of the profile schema). */
export interface CompatSuggestion {
  /** Wire format the endpoint speaks; omitted when unknown. */
  thinkingFormat?: string
  /** Whether the endpoint accepts a `reasoning_effort`-style parameter. */
  supportsReasoningEffort?: boolean
}

/** One knowledge-base entry: which model families it matches and what to declare. */
export interface KnowledgeEntry {
  /** Stable id (also used to de-duplicate user overrides). */
  id: string
  /** Model id/name patterns (lowercase substring match). */
  patterns: readonly string[]
  /** Level set + wire spellings to declare. */
  efforts: ReasoningEfforts
  /** Optional compat block to declare alongside the efforts. */
  compat?: CompatSuggestion
  /** Human note shown next to the suggestion (localized by the caller). */
  note?: string
}

/** What a provider route names about itself that inference can use. */
export interface RouteFacts {
  /** Wire protocol as configured (`api`), if any. */
  api?: string
  /** Endpoint URL, if any. */
  baseURL?: string
  /** Display name, if any. */
  displayName?: string
}

/** A resolved suggestion for one model on one route. */
export interface EffortSuggestion {
  /** The reasoning-effort declaration to write, if one is derivable. */
  efforts?: ReasoningEfforts
  /** The compat block to write alongside, if any. */
  compat?: CompatSuggestion
  /** Whether a knowledge-base entry matched (vs protocol inference). */
  matched: boolean
  /** The knowledge entry id when one matched. */
  entryId?: string
  /** Human-readable source of the suggestion. */
  source: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The curated knowledge base. Patterns are lowercase substring matches against
 * the model id (and display name). First match wins, longest pattern wins.
 */
export const KNOWLEDGE_BASE: readonly KnowledgeEntry[] = [
  {
    id: 'deepseek-v3',
    // deepseek-reasoner belongs to the R1 entry: it is the reasoning model's
    // API name and must not match here.
    patterns: ['deepseek-v3', 'deepseek-chat'],
    // DeepSeek's own API spells the levels the way the harness catalog does:
    // high and max are the thinking intensities; off is the no-thinking
    // spelling. The `deepseek` thinking format is what the official adapter
    // sends for reasoning-capable models.
    efforts: { off: null, high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    note: 'DeepSeek 官方档位：Off / High / Max。',
  },
  {
    id: 'deepseek-r1',
    patterns: ['deepseek-r1', 'deepseek-reasoner'],
    // R1's reasoning cannot be switched off at the API level; the harness
    // treats it as a thinking model whose only declared level is the default.
    efforts: { high: 'high' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    note: 'DeepSeek-R1 为推理模型，仅提供 High。',
  },
  {
    id: 'openai-o',
    patterns: ['o1', 'o3', 'o4', 'gpt-5', 'gpt-5.1', 'gpt-5.2'],
    // OpenAI's reasoning models accept the standard effort ladder.
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: 'OpenAI 档位：Off / Low / Medium / High。',
  },
  {
    id: 'openai-gpt',
    patterns: ['gpt-4', 'gpt-3.5'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: 'OpenAI 通用档位。',
  },
  {
    id: 'qwen',
    patterns: ['qwen', 'qwq'],
    // Qwen (DashScope / Model Studio) OpenAI-compatible mode accepts the
    // standard ladder; QwQ is a reasoning model and takes no off level.
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: '通义千问 OpenAI 兼容档位：Off / Low / Medium / High。',
  },
  {
    id: 'glm',
    patterns: ['glm', 'zhipu', 'chatglm'],
    // Zhipu's OpenAI-compatible endpoint understands the standard ladder.
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: '智谱 GLM OpenAI 兼容档位。',
  },
  {
    id: 'kimi',
    patterns: ['kimi', 'moonshot'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: '月之暗面 Kimi OpenAI 兼容档位。',
  },
  {
    id: 'minimax',
    patterns: ['minimax', 'abab'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: 'MiniMax OpenAI 兼容档位。',
  },
  {
    id: 'doubao',
    patterns: ['doubao', 'doubao-seed', 'seed'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    note: '豆包 OpenAI 兼容档位。',
  },
  {
    id: 'anthropic-claude',
    patterns: ['claude'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'anthropic', supportsReasoningEffort: true },
    note: 'Anthropic 档位（经 OpenAI 兼容网关时）。',
  },
]

/** The generic OpenAI-compatible fallback, used when nothing matches. */
export const GENERIC_OPENAI_EFFORTS: ReasoningEfforts = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

/**
 * Level sets inferred per wire protocol for families the knowledge base does
 * not name. `off: null` is only offered when the family is known to admit a
 * no-thinking mode; the conservative choice is to omit it so the picker never
 * promises an Off the endpoint would reject.
 */
const PROTOCOL_INFERENCE: Readonly<Record<string, ReasoningEfforts>> = {
  openai: { off: null, low: 'low', medium: 'medium', high: 'high' },
  deepseek: { off: null, high: 'high', max: 'max' },
  anthropic: { off: null, low: 'low', medium: 'medium', high: 'high' },
  gemini: { low: 'low', medium: 'medium', high: 'high' },
}

/** A best-effort generic declaration when even the protocol is unknown. */
const GENERIC_FALLBACK: ReasoningEfforts = { low: 'low', medium: 'medium', high: 'high' }

/** Normalize one route fact for matching/inference. */
function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim()
}

/** Match the knowledge base: first match wins, longest pattern wins. */
export function matchKnowledgeBase(modelId: string, displayName?: string): KnowledgeEntry | undefined {
  const haystack = `${normalize(modelId)} ${normalize(displayName)}`
  let best: { entry: KnowledgeEntry; length: number } | undefined
  for (const entry of KNOWLEDGE_BASE) {
    for (const pattern of entry.patterns) {
      if (haystack.includes(pattern) && (best === undefined || pattern.length > best.length)) {
        best = { entry, length: pattern.length }
      }
    }
  }
  return best?.entry
}

/** Infer a protocol's level set from the route facts. */
export function inferProtocol(route: RouteFacts): string {
  const api = normalize(route.api)
  if (api.length > 0) return api
  const url = normalize(route.baseURL)
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('anthropic')) return 'anthropic'
  if (url.includes('gemini') || url.includes('generativelanguage')) return 'gemini'
  // Anything OpenAI-shaped (the overwhelming majority of gateways) is safest.
  return 'openai'
}

/**
 * Resolve the suggestion for one model on one route.
 * @param modelId - the model id (or display name) to match.
 * @param route - route facts used when the knowledge base misses.
 * @returns a suggestion, or undefined when nothing derivable (never happens —
 *   protocol inference always has a fallback).
 */
export function suggestEfforts(modelId: string, route: RouteFacts): EffortSuggestion {
  const entry = matchKnowledgeBase(modelId)
  if (entry !== undefined) {
    return {
      efforts: entry.efforts,
      ...entry.compat === undefined ? {} : { compat: entry.compat },
      matched: true,
      entryId: entry.id,
      source: entry.id,
    }
  }
  const protocol = inferProtocol(route)
  const efforts = PROTOCOL_INFERENCE[protocol] ?? GENERIC_FALLBACK
  // A compat block is only written when the route *names* an OpenAI-compatible
  // protocol: it tells pi-ai to speak the OpenAI dialect to this endpoint, and
  // guessing that for an endpoint with no clues could send requests the
  // gateway rejects. `inferProtocol`'s openai default is a fallback for the
  // level set alone.
  const api = normalize(route.api)
  const url = normalize(route.baseURL)
  const explicitOpenai = api === 'openai' || (url.length > 0 && url.includes('openai'))
  return {
    efforts,
    ...(explicitOpenai ? { compat: { thinkingFormat: 'openai', supportsReasoningEffort: true } } : {}),
    matched: false,
    source: `protocol:${protocol}`,
  }
}

/** The four preset level sets offered by the UI's one-click apply. */
export const PRESETS: ReadonlyArray<{ key: string; labelKey: string; efforts: ReasoningEfforts }> = [
  {
    key: 'deepseek',
    labelKey: 'presetDeepseek',
    efforts: { off: null, high: 'high', max: 'max' },
  },
  {
    key: 'openai',
    labelKey: 'presetOpenai',
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
  },
  {
    key: 'compact',
    labelKey: 'presetCompact',
    efforts: { off: null, high: 'high' },
  },
  {
    key: 'minimal',
    labelKey: 'presetMinimal',
    efforts: { off: null, low: 'low', high: 'high' },
  },
]

/** Look up one preset by key. */
export function presetOf(key: string): ReasoningEfforts | undefined {
  return PRESETS.find(preset => preset.key === key)?.efforts
}

/** Whether a value looks like a valid reasoningEfforts dict (schema-tolerant). */
export function isValidEfforts(value: unknown): value is ReasoningEfforts {
  if (value === undefined) return true
  if (value === false) return true
  if (!record(value)) return false
  const entries = Object.entries(value)
  if (entries.length === 0) return false
  return entries.every(([level, wire]) => {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) return false
    if (wire === null) return level === 'off'
    return typeof wire === 'string' && wire.length > 0
  })
}
