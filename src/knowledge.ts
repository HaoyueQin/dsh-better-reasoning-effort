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
  /**
   * The reasoning-effort declaration to write, if one is derivable. `false`
   * arrives when the endpoint explicitly reports the model does not reason.
   */
  efforts?: ReasoningEfforts | false
  /** The compat block to write alongside, if any. */
  compat?: CompatSuggestion
  /** Whether a knowledge-base entry matched (vs protocol inference). */
  matched: boolean
  /** The knowledge entry id when one matched. */
  entryId?: string
  /** Human-readable source of the suggestion. */
  source: string
  /**
   * Overall confidence for the UI: high = knowledge base (wire values) and/or
   * an explicit endpoint signal; medium = endpoint confirmed reasoning but the
   * level ladder is inferred; low = protocol inference alone.
   */
  confidence: 'high' | 'medium' | 'low'
  /** The endpoint signal behind this suggestion, when one was supplied. */
  endpoint?: { reasoning: boolean | 'unknown'; source: string | null }
}

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
    // 'gpt-5.1'/'gpt-5.2' are covered by the 'gpt-5' substring; the o-series
    // tokens only match on word boundaries (see matchKnowledgeBase), so
    // 'o1' hits 'o1-mini' but not 'ko1'.
    patterns: ['o1', 'o3', 'o4', 'gpt-5'],
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
    // No thinkingFormat here: pi-ai's nameable formats have no 'anthropic'
    // member (SUPPORTED_THINKING_FORMATS), and the anthropic-messages compat
    // gate offers neither field. suggestEfforts gates this block against the
    // route's real protocol anyway, so a Claude served through an
    // openai-completions gateway gets `supportsReasoningEffort` only.
    compat: { supportsReasoningEffort: true },
    note: 'Anthropic 档位（经 OpenAI 兼容网关时）。',
  },
]

/**
 * The generic OpenAI-compatible ladder — the single source for every
 * OpenAI-shaped protocol row below and the fallback when nothing matches.
 */
export const GENERIC_OPENAI_EFFORTS: ReasoningEfforts = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

/**
 * Level sets keyed by pi-ai's REAL wire protocols — the only values a route's
 * `api` may take are 'openai-completions' | 'openai-responses' |
 * 'anthropic-messages' (llm-pi-ai provider.ts PROTOCOLS) — plus the
 * 'deepseek' URL dialect for routes that name no api but point at DeepSeek's
 * own endpoint, which takes its native off/high/max ladder.
 *
 * `off: null` is only offered where a no-thinking mode is plausible; the
 * conservative choice elsewhere is to omit it so the picker never promises an
 * Off the endpoint would reject. Exported for the vocabulary grid tests that
 * pin these ladders against pi-ai's resolution rules.
 */
export const PROTOCOL_INFERENCE: Readonly<Record<string, ReasoningEfforts>> = {
  'openai-completions': GENERIC_OPENAI_EFFORTS,
  'openai-responses': GENERIC_OPENAI_EFFORTS,
  'anthropic-messages': GENERIC_OPENAI_EFFORTS,
  deepseek: { off: null, high: 'high', max: 'max' },
}

/** A best-effort generic declaration when even the protocol is unknown. */
const GENERIC_FALLBACK: ReasoningEfforts = { low: 'low', medium: 'medium', high: 'high' }

/** Normalize one route fact for matching/inference. */
function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim()
}

/** Whether a character is a lowercase letter or digit (word-boundary test). */
function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9]/.test(ch)
}

/**
 * Lowercase and collapse every non-alphanumeric run to one space, so id /
 * display-name / pattern separators (`-`, `_`, `.`, spaces) compare equal:
 * pattern 'deepseek-v3' matches display name "DeepSeek V3".
 */
function normalizeLoose(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ')
}

/**
 * Whether the occurrence of a pattern at index `at` sits on a word boundary
 * in `haystack`: neither neighbor may be a letter/digit. Keeps short family
 * tokens from false-hitting ('o1' must hit 'o1 mini' but not 'ko1 pro';
 * 'seed' hits 'doubao seed 1 6' but not 'seedling').
 */
function onBoundary(haystack: string, at: number, length: number): boolean {
  const before = at === 0 ? undefined : haystack[at - 1]
  const after = haystack[at + length]
  return !isAlnum(before) && !isAlnum(after)
}

/** Match the knowledge base: first match wins, longest boundary hit wins. */
export function matchKnowledgeBase(modelId: string, displayName?: string): KnowledgeEntry | undefined {
  const haystack = `${normalizeLoose(modelId)} ${normalizeLoose(displayName ?? '')}`
  let best: { entry: KnowledgeEntry; length: number } | undefined
  for (const entry of KNOWLEDGE_BASE) {
    for (const pattern of entry.patterns) {
      const needle = normalizeLoose(pattern)
      let at = haystack.indexOf(needle)
      while (at >= 0) {
        if (onBoundary(haystack, at, needle.length)) {
          if (best === undefined || needle.length > best.length) {
            best = { entry, length: needle.length }
          }
          break
        }
        at = haystack.indexOf(needle, at + 1)
      }
    }
  }
  return best?.entry
}

/**
 * Infer which PROTOCOL_INFERENCE key applies to a route. A configured `api`
 * is already a pi-ai protocol name and wins as-is; otherwise the endpoint's
 * HOST names the dialect — matched on the registrable domain so an aggregator
 * path like `https://gw.example.com/deepseek/v1` stays generic — and anything
 * unrecognized resolves to the OpenAI-compatible ladder (the overwhelming
 * majority of gateways).
 */
const NATIVE_DIALECT_DOMAINS: Readonly<Record<string, string>> = {
  'deepseek.com': 'deepseek',
  'deepseek.ai': 'deepseek',
  'anthropic.com': 'anthropic-messages',
}

export function inferProtocol(route: RouteFacts): string {
  const api = normalize(route.api)
  if (api.length > 0) return api
  const baseURL = route.baseURL
  if (baseURL !== undefined && baseURL.length > 0) {
    try {
      const host = new URL(baseURL).hostname.toLowerCase()
      const parts = host.split('.')
      if (parts.length >= 2) {
        const dialect = NATIVE_DIALECT_DOMAINS[parts.slice(-2).join('.')]
        if (dialect !== undefined) return dialect
      }
    } catch {
      // Malformed URL: fall through to the generic ladder.
    }
  }
  // Former 'gemini' guessing removed: pi-ai has no gemini protocol, and
  // Gemini gateways speak the OpenAI-compatible dialect.
  return 'openai-completions'
}

/**
 * The one wire protocol whose compat gate offers thinkingFormat /
 * supportsReasoningEffort (llm-pi-ai COMPLETIONS_COMPAT_GATE). pi-ai refuses
 * a model-level compat field its resolved protocol does not take
 * (assertServiceable throws at the write), so compat suggestions are gated to
 * this protocol only.
 */
const COMPAT_CAPABLE_PROTOCOL = 'openai-completions'

/** Gate a compat block against the route's real protocol. */
function compatForRoute(compat: CompatSuggestion | undefined, route: RouteFacts): CompatSuggestion | undefined {
  if (compat === undefined) return undefined
  return normalize(route.api) === COMPAT_CAPABLE_PROTOCOL ? compat : undefined
}

/** Conservative ladder offered when the endpoint confirms reasoning but nothing names the levels. */
const ENDPOINT_CONFIRMED_LADDER: ReasoningEfforts = { off: null, low: 'low', medium: 'medium', high: 'high' }

/**
 * Resolve the suggestion for one model on one route, fusing the available
 * signals by confidence:
 *
 *   L1  endpoint listing signal (when supplied) — answers "does it reason at
 *       all"; an explicit `false` wins outright (suggest `false`, high);
 *   L2  knowledge base — the ONLY source of wire spellings and compat;
 *   L4  protocol inference — level-ladder skeleton when nothing better exists.
 *
 * @param modelId - the model id (or display name) to match.
 * @param route - route facts used when the knowledge base misses; its
 *   displayName participates in knowledge-base matching.
 * @param endpoint - optional raw-listing signal for this model (from the
 *   host's same-origin probe route); omit when the endpoint was not asked.
 * @returns a suggestion (always derivable — protocol inference has a fallback).
 */
export function suggestEfforts(
  modelId: string,
  route: RouteFacts,
  endpoint?: { reasoning: boolean | 'unknown'; source: string | null },
): EffortSuggestion {
  // L1: an explicit "does not reason" from the endpoint outranks everything.
  if (endpoint?.reasoning === false) {
    return {
      efforts: false,
      matched: false,
      source: `endpoint:${endpoint.source ?? 'listing'}`,
      confidence: 'high',
      endpoint,
    }
  }

  const entry = matchKnowledgeBase(modelId, route.displayName)
  if (entry !== undefined) {
    const compat = compatForRoute(entry.compat, route)
    return {
      efforts: entry.efforts,
      ...compat === undefined ? {} : { compat },
      matched: true,
      entryId: entry.id,
      source: entry.id,
      // Knowledge base carries the wire values; an agreeing endpoint signal
      // only reinforces it. A DISAGREEING signal (endpoint says no reasoning)
      // was handled above; unknown changes nothing.
      confidence: 'high',
      ...(endpoint === undefined ? {} : { endpoint }),
    }
  }

  // L2 missed: the ladder comes from protocol inference. An explicit endpoint
  // "reasons" upgrades confidence to medium — support is confirmed, but the
  // level set and spellings are inferred, so the user should double-check.
  const protocol = inferProtocol(route)
  const efforts = PROTOCOL_INFERENCE[protocol] ?? GENERIC_FALLBACK
  const compat = normalize(route.api) === COMPAT_CAPABLE_PROTOCOL
    ? { thinkingFormat: 'openai', supportsReasoningEffort: true }
    : undefined
  if (endpoint?.reasoning === true) {
    return {
      efforts: { ...ENDPOINT_CONFIRMED_LADDER },
      ...compatForRoute(compat, route) === undefined ? {} : { compat },
      matched: false,
      source: `endpoint:${endpoint.source ?? 'listing'}`,
      confidence: 'medium',
      endpoint,
    }
  }
  return {
    efforts,
    ...compat === undefined ? {} : { compat },
    matched: false,
    source: `protocol:${protocol}`,
    confidence: 'low',
    ...(endpoint === undefined ? {} : { endpoint }),
  }
}
