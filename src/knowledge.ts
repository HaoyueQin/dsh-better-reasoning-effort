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
  /**
   * Anthropic-messages protocol only: force adaptive thinking so the
   * declared efforts dispatch as `output_config.effort` instead of falling
   * into the older budget-based thinking path. pi-ai offers this field on
   * exactly the anthropic-messages compat gate, and the oracle models that
   * take an effort ladder all have adaptive thinking.
   */
  forceAdaptiveThinking?: boolean
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
   * The model family takes an effort ladder on the anthropic-messages
   * protocol too: pi-ai only routes declared efforts to `output_config.effort`
   * when `forceAdaptiveThinking` is set, so this pin adds that compat block
   * on anthropic-messages routes (and nothing on any other protocol).
   */
  anthropicAdaptive?: boolean
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
 * Sources of truth (per family, re-checked 2026-08): official API docs --
 * api-docs.deepseek.com (news/pricing/thinking/vision/API reference),
 * developers.openai.com model pages + guides (platform.openai.com blocked;
 * Azure learn mirror cross-checked), platform.claude.com (effort page,
 * models overview, OpenAI-SDK compatibility page), ai.google.dev (thinking +
 * OpenAI-compat pages), docs.x.ai (model pages + reasoning capability),
 * docs.bigmodel.cn (thinking + model pages), platform.kimi.com (models /
 * use-thinking-models / use-reasoning-effort), platform.stepfun.com (model
 * pages + reasoning), docs.byteplus.com / volcengine ModelArk (deep
 * reasoning), cloud.baidu.com (Qianfan pricing/thinking model list),
 * plus first-party GitHub cards (openai/gpt-oss, mistralai/mistral-common,
 * Tencent-Hunyuan/Hy3, MiniMax-AI/MiniMax-M3) -- cross-checked against the
 * public OpenRouter catalog (input_modalities, supported_parameters) where
 * noted. Capacities are REFERENCE values: aggregators disagree, so the note
 * says so where the spread is wide, and families whose numbers stay contested
 * simply carry none.
 */
export const KNOWLEDGE_BASE: readonly KnowledgeEntry[] = [
  {
    id: 'deepseek-v4-vision',
    // Must precede deepseek-v4 semantically -- guaranteed anyway by the
    // longest-boundary-hit rule, since these patterns are strictly longer.
    patterns: ['deepseek-v4-flash-vision', 'deepseek-v4-vision'],
    efforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
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
    // placeholder that arms the deepseek format's disabled branch. The
    // placeholder must stay 'none': pi-ai's deepseek completions branch only
    // checks non-null (any string arms thinking:disabled), while the same map
    // rides the Responses API as reasoning.effort, whose official DeepSeek
    // values are none/low/high/max -- 'off' would be a 400 there.
    patterns: ['deepseek-v4'],
    efforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 1_048_576,
    maxTokens: 384_000,
    note: 'DeepSeek V4 官方枚举 Low / High / Max（默认 High；medium、xhigh 兼容映射到 High），Off 即 thinking:"disabled"（Responses API 下 off 以 effort:"none" 表示）。官方容量 1M 上下文 / 最大输出 384K；vision 实验版见单独条目。',
  },
  {
    id: 'deepseek-v3',
    // deepseek-reasoner belongs to the R1 entry: it is the reasoning model's
    // API name and must not match here. The old alias pair
    // (deepseek-chat / deepseek-reasoner) was retired upstream in 2026-07;
    // the id patterns stay for third-party gateways still serving V3.x.
    patterns: ['deepseek-v3', 'deepseek-chat'],
    efforts: { off: 'none', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 163_840,
    maxTokens: 65_536,
    note: 'DeepSeek V3 档位：Off / High / Max。官方已停售 V3 代（定价页仅剩 V4 三型），容量取目录现役值。',
  },
  {
    id: 'deepseek-r1',
    patterns: ['deepseek-r1', 'deepseek-reasoner'],
    // R1's reasoning cannot be switched off at the API level; the harness
    // treats it as a thinking model whose only declared level is the default.
    efforts: { high: 'high' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 163_840,
    maxTokens: 32_768,
    note: 'DeepSeek-R1 为推理模型，仅提供 High。官方已下架 R1 代，容量取目录 r1-0528 值。',
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
    note: 'GPT-5.2 档位：None / Low / Medium / High / XHigh（默认 None）。官方另支持 PDF 输入（核心词表暂不含）。gpt-5.2-pro 官方页未单列档位行，按本条目同档处理；gpt-5.2-codex 见单独条目。',
  },
  {
    id: 'openai-gpt-5-2-codex',
    // The codex variant's official model page names low/medium/high/xhigh
    // only -- NO none -- so the shared gpt-5.2 entry must not claim an off
    // for it (a 'none' request would 400). Longer pattern wins over 'gpt-5.2'.
    patterns: ['gpt-5.2-codex'],
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.2-Codex 档位：Low / Medium / High / XHigh（无 None 档，勿勾 Off），带图输入、400K。',
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
    note: 'GPT-5.6（别名即 sol）档位：None / Low / Medium(默认) / High / XHigh / Max；sol/luna/terra 同档，带图输入。',
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
    note: 'GPT-5.5 档位：None / Low / Medium(默认) / High / XHigh，带图输入。pro 变体仅 Medium / High(默认) / XHigh 且仅 Responses API。',
  },
  {
    id: 'openai-gpt-5-4',
    patterns: ['gpt-5.4'],
    // Official model page: none (default) / low / medium / high / xhigh;
    // pro drops none+low and is Responses-only; mini/nano sit on 400K.
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_050_000,
    maxTokens: 128_000,
    note: 'GPT-5.4 档位：None(默认) / Low / Medium / High / XHigh，带图输入。pro 变体仅 Medium/High/XHigh；mini/nano 为 400K 上下文。',
  },
  {
    id: 'openai-gpt-5-3',
    patterns: ['gpt-5.3'],
    // Official model page: low / medium / high / xhigh only -- no none.
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.3-Codex 档位：Low / Medium / High / XHigh（无 None 档），带图输入、400K；gpt-5.3-chat 为非推理聊天模型（见 chat 条目）。',
  },
  {
    id: 'openai-gpt-5-1',
    patterns: ['gpt-5.1'],
    // gpt-5.1 (2025-11): none replaces minimal; no xhigh outside codex-max.
    // The codex variants split into their own entry: their official pages
    // publish no effort line, and the codex line's 5.2/5.3 successors take
    // no none -- so the conservative declaration there drops both none and
    // xhigh (see openai-gpt-5-1-codex).
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.1 档位：None / Low / Medium / High（默认 None）。',
  },
  {
    id: 'openai-gpt-5-1-codex',
    // Official model pages for 5.1-codex / -codex-max / -codex-mini publish no
    // reasoning-effort line (unlike gpt-5.1 itself); the codex successors
    // 5.2/5.3 are low/medium/high/xhigh without none, so none is NOT declared
    // here either. xhigh is likewise unproven for 5.1-codex (the 5.1 page's
    // own ladder stops at high) and is withheld.
    patterns: ['gpt-5.1-codex'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 400_000,
    maxTokens: 128_000,
    note: 'GPT-5.1-Codex 系列：官方模型页未单列 effort 值域，按同代保守档 Low / Medium / High（无 None；xhigh 未证实）。如端点支持 xhigh/none 可手调。',
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
    id: 'openai-chat',
    // Non-reasoning chat lines across generations: they take no
    // reasoning_effort at all (official model pages list no "Reasoning").
    // Official ids are the *-chat-latest snapshots; the bare -chat spellings
    // stay for gateways serving them. gpt-5-chat-latest was removed upstream
    // on 2026-07-23 and gpt-chat-latest has no model page anymore -- the
    // patterns persist for compatibility only.
    patterns: [
      'gpt-5.1-chat-latest', 'gpt-5.2-chat-latest', 'gpt-5.3-chat-latest', 'gpt-5-chat-latest',
      'gpt-chat-latest', 'gpt-5-chat', 'gpt-5.1-chat', 'gpt-5.2-chat', 'gpt-5.3-chat',
    ],
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    note: '-chat 系列（官方 id 为 gpt-5.x-chat-latest）为非推理聊天模型，不支持 effort 参数（勿勾思考档）；官方支持图片输入，128K / 16,384 输出。gpt-5-chat-latest 已于 2026-07-23 下架、gpt-chat-latest 已无官方页面（保留模式供网关）。',
  },
  {
    id: 'openai-o',
    // The o-series scheduled-removal notice (2026-06-11): o1/o1-pro/o3-mini/
    // o4-mini are removed 2026-10-23 and o3/o3-pro on 2026-12-11, with
    // gpt-5.6-sol / gpt-5.6-terra replacing them; the tokens stay for
    // gateways and local deployments still serving them, and match only on
    // word boundaries (see matchKnowledgeBase), so 'o1' hits 'o1-mini' but
    // not 'ko1'.
    patterns: ['o1', 'o3', 'o4'],
    // o-series had no none: not sending the parameter meant medium (think
    // on), so no off level is offered.
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 100_000,
    note: 'OpenAI o 系档位：Low / Medium / High。官方已于 2026-06 公告退役（o1/o1-pro/o3-mini/o4-mini 2026-10-23 移除、o3/o3-pro 2026-12-11），网关残留仍可命中；多数 o 系端点收图（o3-mini 例外）。',
  },
  {
    id: 'openai-gpt-oss',
    // Official README: configurable reasoning effort low / medium / high
    // (CLI default: low); official model page: 131,072 context and exactly
    // the same 131,072 max output tokens, text input only.
    patterns: ['gpt-oss'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 131_072,
    maxTokens: 131_072,
    note: 'GPT-OSS 开源权重（Ollama/vLLM 常见）：reasoning effort Low / Medium / High（官方默认 Low），纯文本，131K 上下文 / 131K 输出。',
  },
  {
    id: 'openai-gpt-4o',
    // Boundary matching keeps 'gpt-4' from hitting 'gpt-4o', so the vision
    // generation needs its own entry. gpt-4.1 keeps its own entry below
    // (1M context, larger output cap).
    patterns: ['gpt-4o'],
    // GPT-4o is not a reasoning model (official catalog lists no reasoning,
    // the API refuses reasoning_effort): suggest `false` so the editor
    // marks the row "does not reason" instead of wiring a rejected ladder.
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    note: 'GPT-4o 代际：非推理模型，不支持 effort 参数（勿勾思考档）；图片输入全系标配，128K / 16,384 输出。',
  },
  {
    id: 'openai-gpt-4-1',
    // Official model page: 1,047,576 context / 32,768 max output, text+image
    // on every variant (4.1 / mini / nano alike -- the old "nano is
    // text-only" claim was wrong). No reasoning step at all.
    patterns: ['gpt-4.1'],
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 1_047_576,
    maxTokens: 32_768,
    note: 'GPT-4.1 全系（含 mini/nano）：非推理模型，不支持 effort 参数；官方 1,047,576 上下文 / 32,768 输出，全系带图输入。',
  },
  {
    id: 'openai-gpt-4-turbo-preview',
    // The preview snapshot is text-only (later turbo snapshots take images;
    // the shared preview spelling must not claim them). Longest-boundary-hit
    // keeps it ahead of 'gpt-4-turbo'.
    patterns: ['gpt-4-turbo-preview'],
    efforts: false,
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 4_096,
    note: 'GPT-4 Turbo Preview：非推理模型，纯文本输入（正式 turbo 快照支持图片，见下条），128K。',
  },
  {
    id: 'openai-gpt-4-turbo',
    patterns: ['gpt-4-turbo'],
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 4_096,
    note: 'GPT-4 Turbo：非推理模型，官方支持图片输入，128K / 4,096 输出。',
  },
  {
    id: 'openai-gpt',
    patterns: ['gpt-4', 'gpt-3.5'],
    // Same reasoning as gpt-4o above: the GPT-4/3.5 generations take no
    // reasoning_effort -- suggest `false` rather than a rejected ladder.
    // gpt-4 remains text-only (8K window); the vision-bearing 4o/4.1/turbo
    // lines have their own entries.
    efforts: false,
    input: ['text'],
    note: 'GPT-4/3.5 代际：非推理模型，不支持 effort 参数（勿勾思考档）。gpt-4-turbo/4.1 起支持图片，见单独条目；新代请用 GPT-5 系（见 openai-chat/gpt-5.x 条目）。',
  },
  {
    id: 'anthropic-claude-5',
    // Claude 5th generation (fable/mythos/opus-5/sonnet-5, 2026): adaptive
    // thinking with an effort ladder that adds xhigh and max; the fable and
    // mythos entries think always-on, so no off level. Mythos Preview is
    // split into its own entry: it takes max but NOT xhigh (official effort
    // matrix), so the shared ladder's xhigh would be a 400.
    patterns: ['claude-fable-5', 'claude-mythos-5', 'claude-opus-5', 'claude-sonnet-5'],
    // Ladder per the official effort matrix (platform.claude.com
    // docs/build-with-claude/effort). NOTE: Anthropic's own OpenAI-SDK
    // compatibility layer IGNORES reasoning_effort (thinking is driven by
    // its own param, on by default for Claude 5) -- the declaration bites
    // on third-party gateways that map it; on the native
    // anthropic-messages protocol, anthropicAdaptive pins the compat that
    // makes pi-ai dispatch these as output_config.effort.
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    // No thinkingFormat: pi-ai has no 'anthropic' member, and the
    // openai-completions compat gate that takes thinkingFormat is not the
    // protocol an Anthropic endpoint speaks.
    compat: { supportsReasoningEffort: true },
    anthropicAdaptive: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude 5 代档位：Low / Medium / High / XHigh / Max（默认 High）；Mythos Preview 仅至 Max（见单独条目）。官方支持 PDF 输入。注意：Anthropic 官方 OpenAI 兼容层会忽略 effort 参数，声明在第三方网关映射时生效。',
  },
  {
    id: 'anthropic-claude-mythos-preview',
    // Official effort matrix: max is available, xhigh is NOT (the matrix's
    // xhigh list covers Fable 5 / Mythos 5 / Opus 5 / Opus 4.8 / Opus 4.7 /
    // Sonnet 5 only).
    patterns: ['claude-mythos-preview'],
    efforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
    compat: { supportsReasoningEffort: true },
    anthropicAdaptive: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude Mythos Preview：官方档位 Low / Medium / High / Max（无 XHigh），1M 上下文。',
  },
  {
    id: 'anthropic-claude-opus-4-high',
    patterns: ['claude-opus-4-8', 'claude-opus-4-7'],
    // Official effort page: Opus 4.7/4.8 take the full ladder including
    // xhigh and max (xhigh is the recommended coding start on 4.7).
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    compat: { supportsReasoningEffort: true },
    anthropicAdaptive: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude Opus 4.7/4.8 档位：Low / Medium / High(默认) / XHigh / Max；xhigh 为官方推荐的编码起步档。1M 上下文。',
  },
  {
    id: 'anthropic-claude-4-6',
    patterns: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    // Official effort page: the 4.6 generation supports max but NOT xhigh
    // ("some models that support max don't support xhigh").
    efforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
    compat: { supportsReasoningEffort: true },
    anthropicAdaptive: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    note: 'Claude 4.6 代档位：Low / Medium / High / Max（无 XHigh——官方明言「支持 max 的部分型号不支持 xhigh」）。1M 上下文。',
  },
  {
    id: 'anthropic-claude-opus-4-5',
    // The only extended-thinking-only model in Anthropic's official effort
    // support list (claude-opus-4-5-20251101): effort works alongside
    // budget_tokens, and the max/xhigh columns of the official matrix do not
    // name it -- so the ladder tops out at high.
    patterns: ['claude-opus-4-5'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 64_000,
    note: 'Claude Opus 4.5：官方 effort 支持列表（20251101 快照），档位 Low / Medium / High（无 XHigh/Max），可与 budget_tokens 并用；200K / 64K。',
  },
  {
    id: 'anthropic-claude',
    // Everything else in the Claude line: 3.x and the 4.5-generation
    // Sonnet/Haiku. Anthropic's official effort support list names exactly
    // fable-5 / mythos-5 / mythos-preview / opus-5 / opus-4-8 / opus-4-7 /
    // opus-4-6 / sonnet-5 / sonnet-4-6 / opus-4-5-20251101 -- none of the
    // models matching this entry take the effort parameter (their thinking
    // rides thinking.type), so a ladder here would be refused. `false` is
    // the honest "no effort control" declaration, matching the openai-chat
    // convention.
    patterns: ['claude'],
    efforts: false,
    input: ['text', 'image'],
    contextWindow: 200_000,
    maxTokens: 64_000,
    note: 'Claude 3.x 与 Sonnet 4.5 / Haiku 4.5：官方 effort 参数不支持（仅 Fable/Mythos 5、Opus 5/4.6-4.8、Sonnet 5/4.6、Opus 4.5 支持），思考由 thinking.type 控制——勿勾思考档。参考容量 200K / 64K（Haiku 3.5 为纯文本，按需取消图片）。',
  },
  {
    id: 'google-gemini',
    patterns: ['gemini'],
    // Gemini over the OpenAI-compat layer maps reasoning_effort per family
    // (3.1+/3.x -> thinking_level, 2.5 -> thinking_budget). The official
    // compatibility sheet is a full grid (minimal / low / medium / high x
    // family), but the declared ladder stays low/medium/high: the safest
    // universal set, since minimal lands on a non-native value on Gemini
    // 3.1 Pro and none is reserved for 2.5 non-Pro. Users wanting the finer
    // grid tune by hand.
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    note: 'Gemini 通用安全档：Low / Medium / High（官方 OpenAI 兼容映射表另收 minimal：2.5 系映射为 1,024 预算、3.1 Flash-Lite/3 Flash 原生 minimal、3.1 Pro 落 low）。none 仅能关 2.5 非 Pro；2.5 Pro 与 3 代不可关；各型默认不一（flash-lite 默认关）。官方另收音频/视频/PDF。',
  },
  {
    id: 'xai-grok-high',
    patterns: ['grok-4.6'],
    // grok-4.6 adds xhigh on top of low/medium/high (default) and cannot
    // close thinking (docs.x.ai model page + reasoning capability page).
    // grok-4.7 does NOT exist upstream (404, re-checked 2026-08-24).
    efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 500_000,
    note: 'Grok 4.6 档位：Low / Medium / High(默认) / XHigh，思考不可关闭；带图输入、500K 上下文。grok-4.7 不存在（官方 404 已核），已除名。',
  },
  {
    id: 'xai-grok-4-5',
    // grok-4.5 keeps the three-step ladder (default high) with image input
    // and a 500K context window; an xhigh request is silently treated as
    // high (official reasoning page), so it is not declared here.
    patterns: ['grok-4.5'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 500_000,
    note: 'Grok 4.5 档位：Low / Medium / High(默认)，思考不可关闭；带图输入。传入 xhigh 会被官方静默按 High 处理。',
  },
  {
    id: 'xai-grok-4-3',
    // Official reasoning-capability pages: grok-4.3 documents FOUR effort
    // levels (none / low / medium / high) with a 1M context window; the
    // deprecated grok-4-fast/grok-4-1-fast/grok-4-0709 slugs redirect to
    // grok-4.3 at low/none. The old "no none for 4.3" reading of the docs
    // was wrong and is fixed here.
    patterns: ['grok-4.3'],
    efforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    note: 'Grok 4.3：官方四级 reasoning effort（None / Low / Medium / High），1M 上下文、带图输入；grok-4-fast 等旧 slug 2026-05-15 起自动重定向到本型号。',
  },
  {
    id: 'xai-grok',
    // grok-4.5 (and 4.1-fast etc.) take the standard three-step ladder;
    // grok-4 and older reject reasoning_effort outright -- gateways serving
    // them will refuse the value and the user can clear it by hand. Grok
    // 4/4.1 and grok-3 retired 2026-05-15 (redirected to grok-4.3), and
    // grok-build-0.1 (early-access coding model) publishes no effort
    // contract.
    patterns: ['grok'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    note: 'Grok 通用档位：Low / Medium / High。初代 grok-4、grok-4.20 与 grok-build-0.1 不接受该参数（grok-4 系与 grok-3 已于 2026-05-15 退役并重定向至 4.3）；grok-4.20-multi-agent 的四档控制的是 agent 数量而非思考深度。新旧代际请优先选 4.5/4.6/4.3；多模态变体按需勾选图片。',
  },
  {
    id: 'mistral-magistral',
    // The native magistral line is a run-together thinking family with no
    // reasoning_effort control of its own (its thinking is driven by
    // prompt_mode / always-on), and Mistral marked the whole line
    // deprecated on 2026-07-28 (phased out through mid-2026; reasoning now
    // rides the generalist models). `false` is the honest "no effort
    // control" declaration; gateways that happen to map an effort
    // parameter onto magistral ids can be tuned by hand.
    patterns: ['magistral'],
    efforts: false,
    input: ['text'],
    contextWindow: 32_768,
    maxTokens: 32_768,
    note: 'Magistral 原生思考线（无 effort 参数，为 prompt_mode 语义），官方已于 2026-07-28 声明弃用、逐步撤出；现役推理走 mistral-small-2603 / mistral-medium-3-5 的 reasoning_effort（见下条）。',
  },
  {
    id: 'mistral-medium-3',
    // Official reasoning page + mistral-common request.py (the first-party
    // protocol enum) name the reasoning_effort models: values are exactly
    // none/high. The API ids today are mistral-medium-3-5 (Medium 3.5's
    // model page names the dotted spelling too) and mistral-small-2603
    // (Mistral Small 4); mistral-small-latest is its alias. The dated
    // "small-2506" builds are retiring and are NOT matched; the bare
    // 'mistral-medium-3' stem was dropped so the 3.1 generation (no
    // reasoning_effort) does not get the ladder.
    // Normalization folds '.' and '-' to the same space, so the one dotted
    // spelling also keys the API id (mistral-medium-3-5).
    patterns: ['mistral-medium-3.5', 'mistral-small-latest', 'mistral-small-2603'],
    efforts: { off: 'none', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    note: 'Mistral 现役推理档：None / High——官方 reasoning_effort 枚举（mistral-common 协议库）即 none/high；mistral-small-2603（Small 4）与 mistral-medium-3-5 经它控制，Medium 3.5 带视觉。容量未在官方目录页单列，不提供。',
  },
  {
    id: 'qwen-vision',
    // The DashScope vision lines: -vl suffixes and QvQ. Normalization folds
    // 'qwen2.5-vl' to 'qwen2 5 vl', hence the spelled-out middle pattern.
    // Note the modern generations (3.8-max / 3.7-plus / 3.7-flash and the
    // 3.5-omni line) are multimodal too -- see the qwen-3-8 entry and the
    // plain qwen entry note.
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
    id: 'qwen-3-8',
    // The 3.8 generation moved from the bare enable_thinking switch to an
    // official reasoning_effort ladder: the Qwen3.8 README ("Flexible
    // Thinking Control"), the Qwen3.8-27B model card, the Qwen3.8-Flash-Next
    // card and the qwen.ai Flash-Next blog all document reasoning_effort
    // with xhigh as the DEFAULT (xhigh/medium/low), alongside the
    // per-request enable_thinking toggle (chat_template_kwargs on
    // open-weight serving). qwen3.8-max stays the current flagship (1M
    // context; Model Studio lists it under image/video understanding), so
    // the plain qwen entry's text-only declaration must not claim it.
    patterns: ['qwen3.8'],
    efforts: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    note: 'Qwen 3.8 系：官方 reasoning_effort 档位 XHigh(默认) / Medium / Low，thinking 默认开、可按请求关闭；原生多模态（qwen3.8-max 图像/视频理解，视频未入核心词表）。1M 档上下文。27B 与 Flash-Next 开源款见单独条目。',
  },
  {
    id: 'qwen-3-8-27b',
    // Open-weight dense release (2026-08-14, HF Qwen/Qwen3.8-27B model
    // card): "native vision-language model", 262,144 context natively
    // "extensible up to 1,000,000 tokens", reasoning_effort xhigh (default)
    // / medium / low with per-request thinking disable. Longer than the
    // bare 'qwen3.8' pattern, so it wins for -27B ids.
    patterns: ['qwen3.8-27b'],
    efforts: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 262_144,
    note: 'Qwen3.8-27B（dense，2026-08-14 开源）：官方 reasoning_effort 档位 XHigh(默认) / Medium / Low，thinking 默认开、可按请求关；原生图像+视频理解（视频未入核心词表）。262,144 原生上下文、官方声明可扩至 1M。来源：HF Qwen/Qwen3.8-27B 模型卡。',
  },
  {
    id: 'qwen-3-8-flash-next',
    // Open-weight experimental architecture preview (HF
    // Qwen/Qwen3.8-Flash-Next card + the qwen.ai blog): the
    // Qwen4-underpinning hybrid (QSA, n-gram embedding; 125B with 6B
    // activated), native vision encoder, 262,144 context natively
    // extensible to 1M. Thinking control identical to the 3.8 generation:
    // enable_thinking toggle plus reasoning_effort xhigh (default) /
    // medium / low. Longest pattern, so it wins for -flash-next ids.
    patterns: ['qwen3.8-flash-next'],
    efforts: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
    compat: { thinkingFormat: 'qwen', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 262_144,
    note: 'Qwen3.8-Flash-Next（125B-A6B 实验架构，Qwen4 前身）：官方 reasoning_effort 档位 XHigh(默认) / Medium / Low + enable_thinking 开关；原生视觉（Vision Encoder）。262,144 原生上下文、可扩至 1M。来源：HF 模型卡与 qwen.ai 官方博客。',
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
    note: '通义千问：enable_thinking 开关（无 effort 档），开=High；现役旗舰为 qwen3.8 系（1M 档上下文，见 qwen-3-8 条目）。3.6/3.7 代的 Plus/Flash 亦默认多模态（图片/视频），如接入请按需勾选图片；视觉线见 qwen-vision 条目。',
  },
  {
    id: 'glm-vision',
    // Zhipu's vision lines: glm-4v / glm-4.6v / glm-4.5v / glm-5v. Longer
    // than the plain 'glm' patterns, so they win for those ids.
    // 'glm-4-6v' (not 'glm-46v'): normalization folds 'glm-4.6v' to
    // 'glm 4 6v', so the pattern must carry the same inner separator; the
    // same fold gives 'glm-4.5v' -> 'glm 4 5v'.
    patterns: ['glm-4v', 'glm-4-6v', 'glm-4-5v', 'glm-5v'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'zai' },
    input: ['text', 'image'],
    contextWindow: 131_072,
    maxTokens: 32_768,
    note: '智谱视觉线（GLM-4V/4.5V/4.6V/5V）：thinking 开关（开=High），收图。GLM-4.5V 为强制思考（传 disabled 报错，请手动删 Off 档）。',
  },
  {
    id: 'glm-5-3-flash',
    // Official model page (docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash,
    // page dated 2026-08-28): input modalities "视频、图像、文本、文件", 1M
    // context / 128K max output, and "thinking.type 仅支持 enabled" — forced
    // thinking, no off switch. "文本参数与 GLM-5.3 保持一致" gives the flash
    // variant the 5.3 ladder (low/high/max). Native multimodal (320B), which
    // the text-only glm-5.3 entry must NOT claim — hence this separate entry;
    // the longer pattern wins over plain 'glm-5.3'.
    patterns: ['glm-5.3-flash'],
    efforts: { low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    maxTokens: 131_072,
    note: 'GLM-5.3-Flash（320B，官方文档 vlm 分类）：强制思考（thinking.type 仅 enabled，不支持关闭），文本参数与 GLM-5.3 一致——档位 Low / High / Max。输入模态：视频、图像、文本、文件（视频/文件未入核心词表，图片可勾）。官方 1M 上下文 / 128K 最大输出。来源：docs.bigmodel.cn 模型页。',
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
    note: 'GLM 通用：thinking 开关（无 effort 档），开=High；effort 阶梯仅 GLM-5.2+ 支持（见上两条目）。注意 GLM-4.7/GLM-4.5V 为强制思考，传 disabled 会报错（请手动删 Off 档）。视觉线见 glm-vision 条目。',
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
    note: 'Kimi K3 档位：Low / High / Max(默认 Max)，走顶层 reasoning_effort；始终推理、勿传 thinking 对象。原生视觉理解，1M 上下文（最大输出官方未单独列，不提供）。',
  },
  {
    id: 'kimi-k2-vision',
    // K2.5/K2.6 are multimodal thinking models with a toggleable
    // thinking.type switch (official use-thinking-models table); K2.5 was
    // re-verified as MULTIMODAL on 2026-08-24 (the old "text-only" note was
    // wrong). Longer patterns beat the plain 'kimi' stem below.
    patterns: ['kimi-k2.6', 'kimi-k2.5'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'deepseek' },
    input: ['text', 'image'],
    contextWindow: 262_144,
    note: 'Kimi K2.5/K2.6 视觉代：thinking.type 开关（默认开、可关），开=High；带视觉，256K。K2.7 Code 始终思考，见单独条目。',
  },
  {
    id: 'kimi-k27-code',
    // K2.7 Code (and its highspeed twin) ALWAYS think: thinking.type only
    // accepts "enabled", sending "disabled" errors -- so no Off level.
    patterns: ['kimi-k2.7'],
    efforts: { high: 'high' },
    compat: { thinkingFormat: 'deepseek' },
    input: ['text', 'image'],
    contextWindow: 262_144,
    note: 'Kimi K2.7 Code（含高速版）：始终思考——thinking.type 仅接受 enabled（传 disabled 报错），无 Off 档；带视觉，256K。',
  },
  {
    id: 'kimi-moonshot-v1-vision',
    // Legacy Moonshot V1 vision variants (official model list): plain
    // generation models with no thinking control, but they DO accept images
    // -- the generic 'moonshot' pattern must not declare text-only for them.
    patterns: ['moonshot-v1-8k-vision', 'moonshot-v1-32k-vision', 'moonshot-v1-128k-vision'],
    efforts: false,
    input: ['text', 'image'],
    note: 'Moonshot V1 视觉旧代（8k/32k/128k 各一）：无思考控件（生成模型）、支持图片输入；该线已停止对新用户开放（2026-08-31 全量下线，网关残留仍可命中）。',
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
    note: 'Kimi 通用：thinking 开关（无 effort 档），开=High。k2 系列 2026-05-25 下线、kimi-latest 2026-01-28 下线、moonshot-v1 系 2026-08-31 全量下线（网关残留仍可命中；moonshot-v1 本身非思考模型）。视觉代与 K2.7 Code 见单独条目。',
  },
  {
    id: 'hunyuan-hy3',
    // Open-weight contract (Tencent-Hunyuan/Hy3 README): reasoning_effort
    // travels inside chat_template_kwargs as "no_think" (default) / "low" /
    // "high"; the same README's spec table states a 256K context length.
    patterns: ['hy3'],
    efforts: { low: 'low', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 262_144,
    note: '混元 hy3：开源契约经 chat_template_kwargs.reasoning_effort = no_think(默认)/low/high；官方模型卡 256K 上下文（295B MoE，2026 开源）。',
  },
  {
    id: 'hunyuan-hy4',
    // Open-weight contract (Tencent-Hunyuan/Hy4-preview README): reasoning
    // defaults to "high" (deep chain-of-thought) and is disabled with
    // extra_body={"chat_template_kwargs": {"reasoning_effort": "no_think"}}
    // — the same chat-template channel as hy3, with the default flipped to
    // high. The spec table states a 1M context length; the model is a
    // 770B-A49B MoE with Gated DSA attention. The README documents no levels
    // beyond high/no_think, so a low rung is NOT declared without evidence.
    patterns: ['hy4-preview', 'hy-4-preview'],
    efforts: { off: 'no_think', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    contextWindow: 1_000_000,
    note: '混元 Hy4 preview：官方 README——reasoning 默认 high（深度思考），关闭经 chat_template_kwargs.reasoning_effort=no_think；官方规格表 1M 上下文（770B-A49B MoE，Gated DSA）。low 档官方未列，如有请手调；视觉未声明，按需手勾。来源：Tencent-Hunyuan/Hy4-preview 官方 README。',
  },
  {
    id: 'step-3-7',
    // StepFun step-3.7 is the vision-capable generation; 3.5 stayed
    // text-only on the official serving plan.
    patterns: ['step-3.7', 'step-3.6'],
    efforts: { low: 'low', medium: 'medium', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text', 'image'],
    contextWindow: 262_144,
    note: '阶跃 Step-3.6/3.7 档位：Low / Medium(默认推荐) / High，原生图片+视频理解。上下文为输入+输出总和上限。',
  },
  {
    id: 'step-3-5',
    // step-3.5-flash (official listing): only low/high, text-only.
    patterns: ['step-3.5'],
    efforts: { low: 'low', high: 'high' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    input: ['text'],
    contextWindow: 262_144,
    note: '阶跃 Step-3.5 Flash 档位：Low / High（纯文本推理旗舰）。上下文为输入+输出总和上限。',
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
    note: '豆包档位：Off / Low / Medium / High——effort 阶梯仍是社区证据、官方 Ark 文档明列的为 thinking.type 开关（2026-08-24 复核仍未见到 effort 官方明文）。seed 代收图（1.5-pro 例外）。',
  },
  {
    id: 'minimax-m3',
    // Official M3 README: a thinking parameter with enabled / adaptive /
    // disabled -- NO reasoning_effort ladder. That is exactly the
    // deepseek-shaped toggle, so the kimi-style declaration fits; "adaptive"
    // is not expressible in the level vocabulary and defaults apply.
    patterns: ['minimax-m3'],
    efforts: { off: null, high: 'high' },
    compat: { thinkingFormat: 'deepseek' },
    input: ['text', 'image'],
    contextWindow: 1_048_576,
    note: 'MiniMax-M3：官方 thinking 参数 enabled/adaptive/disabled（无 effort 档），开=High、关=disabled；原生多模态（图/视频，核心词表仅含图），1M 上下文。',
  },
  {
    id: 'baidu-ernie',
    // Baidu Qianfan's OpenAI-compatible surface accepts no reasoning_effort
    // parameter (the v2 API parameter tables carry none); thinking is a
    // per-variant property: the -Thinking / ERNIE 5.0-Thinking-* family is
    // always-on thinking, the plain ERNIE 4.5/5.0/5.1 generations are not
    // thinking models at all. The official pricing page (2026-08) lists
    // ERNIE 5.1 / 5.0 / 5.0-Thinking-Preview|Latest|Exp / 4.5-Turbo(-VL).
    patterns: ['ernie'],
    efforts: false,
    input: ['text'],
    contextWindow: 131_072,
    note: '百度千帆 ERNIE 系：官方 OpenAI 兼容接口无 reasoning_effort 参数——思考由模型变体决定（-Thinking 系列始终思考、普通系列不思考），勿勾思考档。ERNIE 4.5 Turbo VL 支持图片，按需手勾；参考容量取 Turbo 128K 档。',
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
  // The live V4 contract: low/high/max (+ thinking toggle for off, spelled
  // 'none' so an off selection also maps to the official Responses-API value
  // reasoning.effort: none).
  deepseek: { off: 'none', low: 'low', high: 'high', max: 'max' },
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
  // api.deepseek.com is the official endpoint (api-docs.deepseek.com). The
  // 'deepseek.ai' form was dropped: it resolves to a Vercel-hosted site
  // (76.76.21.21), not DeepSeek infrastructure, so nothing warrants assuming
  // the native dialect for it.
  'deepseek.com': 'deepseek',
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
 * this protocol only -- with one exception: the anthropic-messages gate
 * offers forceAdaptiveThinking, which is what makes declared efforts reach
 * the wire as output_config.effort (see {@link KnowledgeEntry.anthropicAdaptive}).
 */
const COMPAT_CAPABLE_PROTOCOL = 'openai-completions'
const ANTHROPIC_PROTOCOL = 'anthropic-messages'

/** Gate a compat block against the route's real protocol. */
function compatForRoute(entry: KnowledgeEntry, route: RouteFacts): CompatSuggestion | undefined {
  const api = normalize(route.api)
  if (api === COMPAT_CAPABLE_PROTOCOL) return entry.compat
  if (api === ANTHROPIC_PROTOCOL && entry.anthropicAdaptive === true) {
    return { forceAdaptiveThinking: true }
  }
  return undefined
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
    const compat = compatForRoute(entry, route)
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
