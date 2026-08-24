/**
 * The reasoning-effort + input-modality knowledge base + wire-protocol
 * inference engine.
 *
 * Every model a third-party provider route serves must declare its
 * 'reasoningEfforts' (which DSH thinking levels it accepts, and the exact
 * string to send on the wire for each) before the composer's model picker
 * offers any reasoning control for it. This module answers "what should this
 * model's declaration be?" from three sources, in order:
 *
 *   1. An endpoint listing signal (when the route was probed): an explicit
 *      "does not reason", a modality disclosure, or a context length.
 *   2. A curated knowledge base keyed by model id/name patterns, carrying the
 *      exact level set, wire spellings, request modalities, and reference
 *      capacities known to work against that family of endpoints.
 *   3. Wire-protocol inference from the route's 'api' / 'baseURL', plus a
 *      conservative name heuristic for modalities, for families nothing else
 *      names.
 *
 * All outputs stay on the adapter's own vocabulary (THINKING_LEVELS,
 * INPUT_MODALITIES, the reasoningEfforts/input dict shapes) so a suggested
 * declaration can be written to llm-pi-ai settings with no translation step.
 * A suggestion is a *preset*: the user can accept it, tune it, or ignore it.
 * The plugin never silently overwrites a declaration the user already made.
 *
 * @module dsh-better-reasoning-effort/knowledge
 */

/** The canonical pi-ai escalation order accepted by llm-pi-ai. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * The request-modality vocabulary llm-pi-ai accepts on a model entry -- a
 * local mirror of pi-ai's MODALITY_GATE (text/image today). The core schema
 * refuses anything else at write time, and its drift gate forces the
 * vocabulary to grow exactly when pi-ai's Model['input'] does; the vocabulary
 * spec pins this mirror against upstream so the UI follows.
 */
export const INPUT_MODALITIES = ['text', 'image'] as const

export type InputModality = (typeof INPUT_MODALITIES)[number]

/** One level's wire spelling; null means "send nothing for this level". */
export type WireSpelling = string | null

/** A full reasoning-effort declaration value: level -> wire spelling. */
export type ReasoningEfforts = Partial<Record<ThinkingLevel, WireSpelling>>

/** A full input-modality declaration value: the modalities a model accepts. */
export type InputModalities = readonly InputModality[]

/** The compat fields this plugin may suggest (a subset of the profile schema). */
export interface CompatSuggestion {
  /** Wire format the endpoint speaks; omitted when unknown. */
  thinkingFormat?: string
  /** Whether the endpoint accepts a reasoning-effort-style parameter. */
  supportsReasoningEffort?: boolean
}

/** One knowledge-base entry: which model families it matches and what to declare. */
export interface KnowledgeEntry {
  /** Stable id (also used to de-duplicate user overrides). */
  id: string
  /** Model id/name patterns (lowercase substring match). */
  patterns: readonly string[]
  /**
   * Level set + wire spellings to declare. `false` marks a family the
   * official catalog serves WITHOUT any reasoning control (GPT-4o / GPT-4
   * generations): suggesting a ladder there would have the composer send
   * reasoning_effort and get a 400 from the real endpoint.
   */
  efforts: ReasoningEfforts | false
  /** Optional compat block to declare alongside the efforts. */
  compat?: CompatSuggestion
  /**
   * Request modalities to declare, in core vocabulary. Absent = no modality
   * suggestion for this family. Wider support a gateway may serve (pdf,
   * audio, video) is recorded in 'note' until the core vocabulary grows.
   */
  input?: InputModalities
  /**
   * Reference context window in tokens (display-only advice; the official
   * capacity inputs are never auto-filled).
   */
  contextWindow?: number
  /** Reference max output tokens in tokens (display-only advice). */
  maxTokens?: number
  /** Human note shown next to the suggestion (localized by the caller). */
  note?: string
}

/** What a provider route names about itself that inference can use. */
export interface RouteFacts {
  /** Wire protocol as configured ('api'), if any. */
  api?: string
  /** Endpoint URL, if any. */
  baseURL?: string
  /** Display name, if any. */
  displayName?: string
}

/** The endpoint facts a suggestion fuses, as the probe route reports them. */
export interface EndpointFacts {
  /** Tri-state reasoning signal: true / false / 'unknown' (listing silent). */
  reasoning: boolean | 'unknown'
  /** The listing field that produced the reasoning signal, null when none did. */
  source: string | null
  /**
   * The listing's input-modality disclosure, normalized to lowercase strings,
   * when the listing named such a field at all. Present-but-empty means the
   * field existed with no usable members; absent means the listing never
   * spoke about modalities (or the probe never ran) -- the tri-state
   * discipline: silence is not refusal.
   */
  input?: readonly string[]
  /** Context length the listing disclosed, when it carries one. */
  contextLength?: number
}

/** How a suggestion's input-modality part was derived. */
export type InputSource = 'knowledge' | 'endpoint' | 'heuristic'

/** A resolved suggestion for one model on one route. */
export interface EffortSuggestion {
  /**
   * The reasoning-effort declaration to write, if one is derivable. False
   * arrives when the endpoint explicitly reports the model does not reason.
   */
  efforts?: ReasoningEfforts | false
  /** The compat block to write alongside, if any. */
  compat?: CompatSuggestion
  /** Request modalities to declare, when derivable. */
  input?: InputModalities
  /** Where the modality part came from -- its confidence rides this. */
  inputSource?: InputSource
  /** Reference context window (display-only; never auto-filled anywhere). */
  contextWindow?: number
  /** Reference max output tokens (display-only). */
  maxTokens?: number
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
 *
 * Sources of truth (per family, checked 2026-08): official API docs --
 * api-docs.deepseek.com, platform.openai.com, platform.claude.com,
 * ai.google.dev, docs.x.ai, docs.mistral.ai, platform.stepfun.com,
 * cloud.tencent.com (TokenHub), platform.kimi.ai, docs.bigmodel.cn,
 * help.aliyun.com -- cross-checked against the public models.dev catalog
 * (modalities.input, limit.context/output) with multi-provider agreement.
 * Capacities are REFERENCE values: aggregators disagree, so the note says so
 * where the spread is wide, and families whose numbers stay contested simply
 * carry none.
 */
export const KNOWLEDGE_BASE: readonly KnowledgeEntry[] = [
  {
    id: 'deepseek-v4-vision',
    // Must precede deepseek-v4 semantically -- guaranteed anyway by the
    // longest-boundary-hit rule, since these patterns are strictly longer.
    patterns: ['deepseek-v4-flash-vision', 'deepseek-v4-vision'],
    efforts: { off: 'off', low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    note: 'DeepSeek V4 视觉实验版：官方目录标注图片输入。',
  },
  {
    id: 'deepseek-v4',
    // One pattern covers the family: every serving suffixes the base id
    // (deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-flash-free ...), so
    // the shared stem keys them all -- including free/aggregator spellings
    // the official catalog never lists. Closing thinking is the
    // 'thinking: disabled' object, so the off spelling is a non-null
    // placeholder that arms the deepseek format's disabled branch.
    patterns: ['deepseek-v4'],
    efforts: { off: 'off', low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    note: 'DeepSeek V4 官方档位：Off / Low / High / Max。官方容量通栏 1M / 384K；vision 实验版见单独条目。',
  },
  {
    id: 'deepseek-v3',
    // deepseek-reasoner belongs to the R1 entry: it is the reasoning model's
    // API name and must not match here. The old alias pair
    // (deepseek-chat / deepseek-reasoner) was retired upstream in 2026-07;
    // the id patterns stay for third-party gateways still serving V3.x.
    patterns: ['deepseek-v3', 'deepseek-chat'],
    efforts: { off: 'off', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 32_000,
    note: 'DeepSeek V3 档位：Off / High / Max。',
  },
  {
    id: 'deepseek-r1',
    patterns: ['deepseek-r1', 'deepseek-reasoner'],
    // R1's reasoning cannot be switched off at the API level; the harness
    // treats it as a thinking model whose only declared level is the default.
    efforts: { high: 'high' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 32_000,
    note: 'DeepSeek-R1 为推理模型，仅提供 High。',
  },
  {
    id: 'openai-gpt-5-2',
    patterns: ['gpt-5.2'],
    // gpt-5.2 (2025-12) took 'none' as the explicit no-thinking value
    // (replacing gpt-5's 'minimal') and added xhigh; its default is none.
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.2 档位：None / Low / Medium / High / XHigh（默认 None）。官方另支持 PDF 输入（核心词表暂不含）。',
  },
  {
    id: 'openai-gpt-5-6',
    patterns: ['gpt-5.6'],
    // gpt-5.6 spans the full modern ladder including max; the sol/luna/terra
    // variants share it (official reasoning guide: values "can include none
    // minimal low medium high xhigh, and max").
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    note: 'GPT-5.6 档位：None / Low / Medium / High / XHigh / Max；sol/luna/terra 变体同档。',
  },
  {
    id: 'openai-gpt-5-5',
    patterns: ['gpt-5.5'],
    // gpt-5.5 defaults to medium (official reasoning guide) and tops out at
    // xhigh; the -pro variant drops none/low (medium/high/xhigh only).
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    note: 'GPT-5.5 档位：None / Low / Medium / High / XHigh（默认 Medium）。pro 变体仅 Medium/High/XHigh，按需删档。',
  },
  {
    id: 'openai-gpt-5-1',
    patterns: ['gpt-5.1'],
    // gpt-5.1 (2025-11): none replaces minimal; no xhigh until 5.2.
    // Codex variants take no 'none' -- drop that level by hand there.
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.1 档位：None / Low / Medium / High（默认 None）。',
  },
  {
    id: 'openai-gpt-5',
    patterns: ['gpt-5'],
    // The 2025-08 first generation: minimal is the floor, there is no none,
    // and the default (medium) thinks -- so no off level is offered.
    efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5 初代档位：Minimal / Low / Medium / High，无关闭档。',
  },
  {
    id: 'openai-o',
    // The o-series endpoints were retired upstream (2026-07); the tokens
    // stay for gateways and local deployments still serving them, and match
    // only on word boundaries (see matchKnowledgeBase), so 'o1' hits
    // 'o1-mini' but not 'ko1'.
    patterns: ['o1', 'o3', 'o4'],
    // o-series had no none: not sending the parameter meant medium (think
    // on), so no off level is offered.
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 100_000,
    note: 'OpenAI o 系档位：Low / Medium / High。多数 o 系端点收图（o3-mini 例外）；部分网关标纯文本，以端点取证为准。',
  },
  {
    id: 'openai-gpt-4o',
    // Boundary matching keeps 'gpt-4' from hitting 'gpt-4o', so the vision
    // generation needs its own entry. gpt-4.1 keeps the base entry (its
    // nano variant is text-only; tune by hand).
    patterns: ['gpt-4o'],
    // GPT-4o is not a reasoning model (official catalog lists no reasoning,
    // the API refuses reasoning_effort): suggest `false` so the editor
    // marks the row "does not reason" instead of wiring a rejected ladder.
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    note: 'GPT-4o 代际：非推理模型，不支持 effort 参数（勿勾思考档）；图片输入全系标配。',
  },
  {
    id: 'openai-gpt',
    patterns: ['gpt-4', 'gpt-3.5'],
    // Same reasoning as gpt-4o above: the GPT-4/3.5 generations take no
    // reasoning_effort -- suggest `false` rather than a rejected ladder.
    efforts: false,
    input: ['text'],
    note: 'GPT-4/3.5 代际：非推理模型，不支持 effort 参数（勿勾思考档）；gpt-4-turbo/4.1 起支持图片，按需手勾。',
  },
  {
    id: 'anthropic-claude-5',
    // Claude 5th generation (fable/mythos/opus/sonnet-5, 2026): adaptive
    // thinking with an effort ladder that adds xhigh and max; the fable and
    // mythos entries think always-on, so no off level.
    patterns: ['claude-fable', 'claude-mythos', 'claude-opus-5', 'claude-sonet-5', 'claude-sonnet-5'],
    // Anthropic's OpenAI-compat layer maps reasoning_effort to effort
    // (platform.claude.com/docs effort matrix: low/medium/high/xhigh/max).
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    // No thinkingFormat: pi-ai has no 'anthropic' member, and the
    // anthropic-messages compat gate offers neither field.
    compat: { supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude 5 代档位（经 OpenAI 兼容层）：Low / Medium / High / XHigh / Max。官方支持 PDF 输入（核心词表暂不含）。',
  },
  {
    id: 'anthropic-claude-opus-4-high',
    patterns: ['claude-opus-4-8', 'claude-opus-4-7'],
    // Official effort page: Opus 4.7/4.8 take the full ladder including
    // xhigh and max (xhigh is the recommended coding start on 4.7).
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    compat: { supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude Opus 4.7/4.8 档位（经 OpenAI 兼容层）：Low / Medium / High / XHigh / Max。',
  },
  {
    id: 'anthropic-claude-4-6',
    patterns: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    // Official effort page: the 4.6 generation supports max but NOT xhigh
    // ("some models that support max don't support xhigh").
    efforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
    compat: { supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude 4.6 代档位（经 OpenAI 兼容层）：Low / Medium / High / Max（无 XHigh）。',
  },
  {
    id: 'anthropic-claude',
    // 4.x generation through OpenAI-compatible gateways. Every current
    // model takes low/medium/high; xhigh/max arrive with 4.6+/5 (see the
    // claude-5 entry) and off is not part of the effort vocabulary.
    patterns: ['claude'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 64_000,
    note: 'Claude 4.x 档位（经 OpenAI 兼容层）：Low / Medium / High。4.5 代走 budget_tokens 无 effort 档；4.6 代与 Opus 4.7+ 见单独条目。',
  },
  {
    id: 'google-gemini',
    patterns: ['gemini'],
    // Gemini 3.x over the OpenAI-compat layer maps reasoning_effort to
    // thinking_level; the ladder is minimal/low/medium/high with no off
    // ('none' is rejected -- minimal is the floor, and the 3.x default is
    // high thinking).
    efforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    note: 'Gemini 3.x 档位：Minimal / Low / Medium / High，无关闭档。官方另收音频/视频/PDF（核心词表暂不含）。',
  },
  {
    id: 'xai-grok-high',
    patterns: ['grok-4.7', 'grok-4.6'],
    // grok 4.6/4.7 add xhigh on top of low/medium/high and cannot fully
    // close thinking (docs.x.ai reasoning page).
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 500_000,
    maxTokens: 500_000,
    note: 'Grok 4.6/4.7 档位：Low / Medium / High / XHigh，无关闭档。官方另支持 PDF 输入（4.7 容量待核实）。',
  },
  {
    id: 'xai-grok-4-5',
    // grok-4.5 keeps the three-step ladder but gained image input and
    // 500K/500K capacities (official listing).
    patterns: ['grok-4.5'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 500_000,
    maxTokens: 500_000,
    note: 'Grok 4.5 档位：Low / Medium / High（带视觉）。',
  },
  {
    id: 'xai-grok-4-3',
    // grok-4.3 (official listing): none reappears as the no-thinking value,
    // 1M context with a 30K output cap.
    patterns: ['grok-4.3'],
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 30_000,
    note: 'Grok 4.3 档位：None / Low / Medium / High（带视觉）。',
  },
  {
    id: 'xai-grok',
    // grok-4.5 (and 4.1-fast etc.) take the standard three-step ladder;
    // grok-4 and older reject reasoning_effort outright -- gateways serving
    // them will refuse the value and the user can clear it by hand.
    patterns: ['grok'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    note: 'Grok 通用档位：Low / Medium / High（grok-4 不支持该参数）。grok-4-fast 等多模态变体请手动勾选图片。',
  },
  {
    id: 'mistral-magistral',
    // Only magistral-1.2 and mistral-medium-3.5 take reasoning_effort
    // (docs.mistral.ai); unsupported models 422 on it. Magistral is the
    // text-only reasoning line -- the medium-3.x vision line is a separate
    // entry below (longer patterns win).
    patterns: ['magistral'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 32_768,
    maxTokens: 32_768,
    note: 'Magistral 档位：Low / Medium / High（纯文本线）。',
  },
  {
    id: 'mistral-medium-3',
    // The 2603/2604 generation (Small 2603, Medium 3.5) collapsed
    // reasoning_effort to none/high in the official listing; older Medium
    // builds (2505/2508) do not reason at all.
    patterns: ['mistral-medium-3', 'mistral-medium-2604', 'mistral-small-2603'],
    efforts: { off: 'none', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 262_144,
    maxTokens: 262_144,
    note: 'Mistral Small 2603 / Medium 3.5 档位：None / High（带视觉）。更早的 Medium 2508 非推理。',
  },
  {
    id: 'qwen-vision',
    // The DashScope vision lines: -vl suffixes and QvQ. Normalization folds
    // 'qwen2.5-vl' to 'qwen2 5 vl', hence the spelled-out middle pattern.
    patterns: ['qwen-vl', 'qwen2-vl', 'qwen2-5-vl', 'qwen3-vl', 'qvq'],
    // DashScope takes NO reasoning_effort: thinking is the enable_thinking
    // boolean -- pi-ai's 'qwen' format dispatches exactly that switch.
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'qwen' },
    input: ['text', 'image'],
    contextWindow: 131_072,
    maxTokens: 8_192,
    note: '通义视觉线（Qwen-VL/QvQ）：enable_thinking 开关（开=High），收图。qwen3-vl 容量更大，按需上调。',
  },
  {
    id: 'qwen',
    patterns: ['qwen', 'qwq'],
    // DashScope takes NO reasoning_effort: thinking is the enable_thinking
    // boolean (plus thinking_budget) -- pi-ai's 'qwen' format dispatches
    // exactly that switch, so the ladder is honestly open/close with one
    // nominal thinking level. QwQ is think-always; clearing the off level
    // there is one click.
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'qwen' },
    input: ['text'],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    note: '通义千问：enable_thinking 开关（无 effort 档），开=High。容量取 qwen-plus/max 现役值，各代不一。视觉线见 qwen-vision 条目。',
  },
  {
    id: 'glm-vision',
    // Zhipu's vision lines: glm-4v / glm-4.6v / glm-5v. Longer than the
    // plain 'glm' patterns, so they win for those ids.
    // 'glm-4-6v' (not 'glm-46v'): normalization folds 'glm-4.6v' to
    // 'glm 4 6v', so the pattern must carry the same inner separator.
    patterns: ['glm-4v', 'glm-4-6v', 'glm-5v'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'zai' },
    input: ['text', 'image'],
    contextWindow: 131_072,
    maxTokens: 32_768,
    note: '智谱视觉线（GLM-4V/5V）：thinking 开关（开=High），收图。',
  },
  {
    id: 'glm-5-3',
    patterns: ['glm-5.3'],
    // glm-5.3 accepts exactly max/high/low; anything else (including the
    // 5.2 ladder's minimal/none) errors, and thinking cannot be disabled.
    efforts: { low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    note: 'GLM-5.3 档位：Low / High / Max（强制思考，其余值报错）。官方容量 1M / 128K。',
  },
  {
    id: 'glm-5-2',
    patterns: ['glm-5.2'],
    // glm-5.2 takes the widest ladder in the wild: none/minimal/low/medium/
    // high/xhigh/max (default max). The zai format arms thinking:disabled
    // for off and sends the effort for the rest.
    efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    // Official capability page: none/minimal stop thinking, low/medium map
    // to high, xhigh maps to max -- all seven spellings are accepted.
    note: 'GLM-5.2 档位：None / Minimal / Low / Medium / High / XHigh / Max（官方映射：Low·Medium→High、XHigh→Max、None·Minimal=停止思考）。视觉线见 glm-vision 条目。',
  },
  {
    id: 'glm',
    patterns: ['glm', 'zhipu', 'chatglm'],
    // GLM 4.x: thinking.type enabled/disabled only, no effort ladder --
    // the zai format sends exactly that switch (and no effort value,
    // because supportsReasoningEffort is not declared).
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'zai' },
    input: ['text'],
    note: 'GLM 4.x：thinking 开关（无 effort 档），开=High。容量各代不一，未给参考值；视觉线见 glm-vision 条目。',
  },
  {
    id: 'kimi-k3',
    patterns: ['kimi-k3'],
    // kimi-k3: top-level reasoning_effort low/high/max (default max),
    // always thinking -- the thinking object must not be sent at all.
    efforts: { low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    note: 'Kimi K3 档位：Low / High / Max（始终思考）。官方目录标注图片输入。',
  },
  {
    id: 'kimi-k2-vision',
    // K2.6/K2.7 gained image input (the official listing marks K2.5
    // text-only; K2.7 Code is documented as multi-modal); longer patterns
    // beat the plain 'kimi' stem below.
    patterns: ['kimi-k2.6', 'kimi-k2.7'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'deepseek' },
    input: ['text', 'image'],
    contextWindow: 256_000,
    maxTokens: 256_000,
    note: 'Kimi K2.6/2.7 视觉代：thinking 开关（开=High），收图。K2.5 无图，见 kimi 通用条目。',
  },
  {
    id: 'kimi',
    // k2.5/2.6 use the DeepSeek-shaped thinking.type enabled/disabled
    // switch, which the 'deepseek' format dispatches; the old k2 preview
    // ids and moonshot-v1 names are retired upstream (2026-05/08) but live
    // on gateways. Effort ladders are not part of their contract.
    patterns: ['kimi', 'moonshot'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'deepseek' },
    input: ['text'],
    contextWindow: 262_144,
    maxTokens: 262_144,
    note: 'Kimi K2.x（含 K2.5）：thinking 开关（无 effort 档），开=High。视觉代见 kimi-k2-vision 条目。',
  },
  {
    id: 'hunyuan-hy3',
    // Tencent's TokenHub hy3: reasoning_effort low/high (default low; a low
    // request with tools is lifted to high automatically).
    patterns: ['hy3'],
    efforts: { low: 'low', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 262_144,
    maxTokens: 64_000,
    note: '混元 hy3 档位：Low / High（默认 Low）。',
  },
  {
    id: 'step-3-7',
    // StepFun step-3.7 is the vision-capable generation; 3.5 stayed
    // text-only on the official serving plan.
    patterns: ['step-3.7', 'step-3.6'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 256_000,
    maxTokens: 256_000,
    note: '阶跃 Step-3.6/3.7 档位：Low / Medium / High（带视觉）。',
  },
  {
    id: 'step-3-5',
    // step-3.5-flash (official listing): only low/high, text-only.
    patterns: ['step-3.5'],
    efforts: { low: 'low', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 256_000,
    maxTokens: 256_000,
    note: '阶跃 Step-3.5 档位：Low / High（纯文本）。',
  },
  {
    id: 'step',
    // StepFun step-3.x: reasoning_effort low/medium/high (default medium);
    // thinking cannot be turned off, only tuned.
    patterns: ['step-3', 'step-2'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    note: '阶跃 Step 档位：Low / Medium / High（默认 Medium，不可关闭）。3.6/3.7 视觉代见单独条目。',
  },
  {
    id: 'doubao',
    // Volcengine Ark: officially documented is the thinking.type
    // enabled/disabled/auto switch; the reasoning_effort ladder on
    // seed-2.x has community evidence (chatbox/compshare) but no first-
    // party doc yet -- kept as the conventional ladder, verify per gateway.
    // 'doubao' already covers every doubao-* spelling; the bare 'seed' token
    // (boundary-checked) catches seed-first ids some gateways serve. The
    // seed generations are vision-capable; doubao-1.5-pro stays text-only.
    patterns: ['doubao', 'seed'],
    efforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 256_000,
    maxTokens: 32_000,
    note: '豆包档位（待官方确认）：Off / Low / Medium / High。seed 代收图（1.5-pro 例外），部分目录另标视频。',
  },
]

/**
 * The generic OpenAI-compatible ladder -- the single source for every
 * OpenAI-shaped protocol row below and the fallback when nothing matches.
 */
export const GENERIC_OPENAI_EFFORTS: ReasoningEfforts = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

/**
 * Level sets keyed by pi-ai's REAL wire protocols -- the only values a
 * route's 'api' may take are 'openai-completions' | 'openai-responses' |
 * 'anthropic-messages' (llm-pi-ai provider.ts PROTOCOLS) -- plus the
 * 'deepseek' URL dialect for routes that name no api but point at DeepSeek's
 * own endpoint, which takes its native off/high/max ladder.
 *
 * 'off: null' is only offered where a no-thinking mode is plausible; the
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
 * display-name / pattern separators ('-', '_', '.', spaces) compare equal:
 * pattern 'deepseek-v3' matches display name "DeepSeek V3".
 */
function normalizeLoose(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ')
}

/**
 * Whether the occurrence of a pattern at index 'at' sits on a word boundary
 * in the haystack: neither neighbor may be a letter/digit. Keeps short family
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
  const haystack = normalizeLoose(modelId) + ' ' + normalizeLoose(displayName ?? '')
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
 * Infer which PROTOCOL_INFERENCE key applies to a route. A configured 'api'
 * is already a pi-ai protocol name and wins as-is; otherwise the endpoint's
 * HOST names the dialect -- matched on the registrable domain so an aggregator
 * path like https://gw.example.com/deepseek/v1 stays generic -- and anything
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
 * Name-heuristic modality tokens -- the last-resort tier (the practice
 * one-api/new-api bake into code): vision-flavored tokens that appear in
 * vendor ids often enough to suggest image input at LOW confidence. Boundary
 * matching keeps 'vl' from hitting 'eval' or 'svelte'.
 */
const VISION_NAME_TOKENS: readonly string[] = [
  'vl',
  'vision',
  'omni',
  '4o',
  'pixtral',
  'internvl',
]

/** Lowest-confidence modality guess from the model id alone, or undefined. */
export function inferModalitiesFromName(modelId: string): InputModalities | undefined {
  const haystack = normalizeLoose(modelId)
  for (const token of VISION_NAME_TOKENS) {
    const needle = normalizeLoose(token)
    let at = haystack.indexOf(needle)
    while (at >= 0) {
      if (onBoundary(haystack, at, needle.length)) return ['text', 'image']
      at = haystack.indexOf(needle, at + 1)
    }
  }
  return undefined
}

/**
 * Intersect a raw listing disclosure with the core vocabulary. Returns
 * undefined when the listing never named a modality field OR named one whose
 * members all fall outside the core vocabulary (an audio-only declaration
 * must NOT read as "text only"). A present disclosure always yields at least
 * text-only when image is absent -- so an explicit text-only listing can
 * strip an image claim.
 */
function declaredCoreInput(raw: readonly string[] | undefined): InputModalities | undefined {
  if (raw === undefined) return undefined
  const lowered = raw.map(value => value.toLowerCase())
  if (!lowered.some(value => (INPUT_MODALITIES as readonly string[]).includes(value))) return undefined
  return lowered.includes('image') ? ['text', 'image'] : ['text']
}

/**
 * Resolve the suggestion for one model on one route, fusing the available
 * signals by confidence:
 *
 *   L1  endpoint listing signal (when supplied) -- answers "does it reason at
 *       all" and, independently, "what does it accept": an explicit false
 *       wins the effort ladder outright (suggest false, high); a modality
 *       disclosure or a context length feeds those parts regardless;
 *   L2  knowledge base -- the ONLY source of wire spellings and compat, plus
 *       modality/capacity references when the endpoint stays silent;
 *   L3  name heuristic -- a low-confidence image guess for vision-flavored
 *       ids when both sources above are silent;
 *   L4  protocol inference -- level-ladder skeleton when nothing better exists.
 *
 * @param modelId - the model id (or display name) to match.
 * @param route - route facts used when the knowledge base misses; its
 *   displayName participates in knowledge-base matching.
 * @param endpoint - optional raw-listing facts for this model (from the
 *   host's same-origin probe route); omit when the endpoint was not asked.
 * @returns a suggestion (always derivable -- protocol inference has a fallback).
 */
export function suggestEfforts(
  modelId: string,
  route: RouteFacts,
  endpoint?: EndpointFacts,
): EffortSuggestion {
  const entry = matchKnowledgeBase(modelId, route.displayName)

  // ---- Modality + capacity parts (orthogonal to the effort ladder) ----
  let input: InputModalities | undefined
  let inputSource: InputSource | undefined
  let contextWindow: number | undefined
  let maxTokens: number | undefined

  if (entry?.input !== undefined) {
    input = entry.input
    inputSource = 'knowledge'
  }
  if (entry?.contextWindow !== undefined) contextWindow = entry.contextWindow
  if (entry?.maxTokens !== undefined) maxTokens = entry.maxTokens

  // An endpoint disclosure outranks the knowledge base; a disclosed context
  // length likewise replaces the reference value. Silence changes nothing.
  const listedInput = declaredCoreInput(endpoint?.input)
  if (listedInput !== undefined) {
    input = listedInput
    inputSource = 'endpoint'
  }
  if (endpoint?.contextLength !== undefined && Number.isFinite(endpoint.contextLength) && endpoint.contextLength > 0) {
    contextWindow = endpoint.contextLength
  }

  // L3: nothing named the modalities -- fall back to the name heuristic.
  if (input === undefined) {
    const guessed = inferModalitiesFromName(modelId)
    if (guessed !== undefined) {
      input = guessed
      inputSource = 'heuristic'
    }
  }

  const modalityParts = {
    ...(input === undefined ? {} : { input }),
    ...(inputSource === undefined ? {} : { inputSource }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }

  const endpointPart = endpoint === undefined
    ? {}
    : { endpoint: { reasoning: endpoint.reasoning, source: endpoint.source } }

  // L1: an explicit "does not reason" from the endpoint outranks everything.
  if (endpoint?.reasoning === false) {
    return {
      efforts: false,
      matched: false,
      source: 'endpoint:' + (endpoint.source ?? 'listing'),
      confidence: 'high',
      ...endpointPart,
      ...modalityParts,
    }
  }

  if (entry !== undefined) {
    const compat = compatForRoute(entry.compat, route)
    return {
      efforts: entry.efforts,
      ...(compat === undefined ? {} : { compat }),
      matched: true,
      entryId: entry.id,
      source: entry.id,
      // Knowledge base carries the wire values; an agreeing endpoint signal
      // only reinforces it. A DISAGREEING signal (endpoint says no reasoning)
      // was handled above; unknown changes nothing.
      confidence: 'high',
      ...endpointPart,
      ...modalityParts,
    }
  }

  // L2 missed: the ladder comes from protocol inference. An explicit endpoint
  // "reasons" upgrades confidence to medium -- support is confirmed, but the
  // level set and spellings are inferred, so the user should double-check.
  const protocol = inferProtocol(route)
  const efforts = PROTOCOL_INFERENCE[protocol] ?? GENERIC_FALLBACK
  const compat = normalize(route.api) === COMPAT_CAPABLE_PROTOCOL
    ? { thinkingFormat: 'openai', supportsReasoningEffort: true }
    : undefined
  if (endpoint?.reasoning === true) {
    return {
      efforts: { ...ENDPOINT_CONFIRMED_LADDER },
      // compat was already gated to the protocol above; no second gate.
      ...(compat === undefined ? {} : { compat }),
      matched: false,
      source: 'endpoint:' + (endpoint.source ?? 'listing'),
      confidence: 'medium',
      ...endpointPart,
      ...modalityParts,
    }
  }
  return {
    efforts,
    ...(compat === undefined ? {} : { compat }),
    matched: false,
    source: 'protocol:' + protocol,
    confidence: 'low',
    ...endpointPart,
    ...modalityParts,
  }
}
