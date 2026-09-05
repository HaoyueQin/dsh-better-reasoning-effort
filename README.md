# DSH Better Reasoning Effort

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
    <img src="docs/banner.svg" alt="DSH Better Reasoning Effort" width="720">
  </picture>
</p>

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
[![npm downloads](https://img.shields.io/npm/dw/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe)
![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ecosystem-4d6bfe)
![Version](https://img.shields.io/badge/version-0.3.4-4d6bfe)
![Docs](https://img.shields.io/badge/docs-EN%20%7C%20ZH-4d6bfe)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![Commit activity](https://img.shields.io/github/commit-activity/t/HaoyueQin/dsh-better-reasoning-effort)](https://github.com/HaoyueQin/dsh-better-reasoning-effort/graphs/commit-activity)
[![Last commit](https://img.shields.io/github/last-commit/HaoyueQin/dsh-better-reasoning-effort)](https://github.com/HaoyueQin/dsh-better-reasoning-effort/commits)

**English** | [中文](README.zh.md)

Reasoning-effort **and input-modality** editing for **third-party models** in DeepSeek Harness — thinking levels and image-input support declared per model, auto-adapted from a model knowledge base + wire-protocol inference, edited right inside the official Models page card. Plus a **quick reasoning-effort slider inside the official model menu** (white round thumb, integrated from HanaAyane's dsh-reasoning-effort — see [Acknowledgements](#acknowledgements)) — the composer's official bottom-right *model · effort* display is left untouched.

<p align="center">
  <img src="docs/demo.svg" alt="demo" width="640">
</p>

<p align="center">
  <img src="assets/models-page-effort-editor.png" alt="The thinking-effort editor injected into a model row on the official Models page" width="720">
</p>

## Why

The `llm-pi-ai` adapter of DeepSeek Harness natively supports per-model `reasoningEfforts` declarations (which thinking levels a model accepts, and the exact string to send on the wire for each). But the official Models page editor **deliberately keeps this field out of reach** — the official notes say it is a per-model capability and a provider-level knob would break some models. As a result:

- Third-party models get **no thinking-level picker** in the composer (`getSupportedThinkingLevels` short-circuits to `["off"]`);
- Only the official DeepSeek API (the built-in catalog) can set reasoning effort;
- Setting levels for a third-party model meant hand-writing the `reasoningEfforts` / `compat` blocks in `settings.yaml`.
- Hand-declared third-party models are treated as **text-only** (`input` defaults to `["text"]`): image attachments are refused before they are sent, the read-image tool refuses, and every gateway path in between gates on the same flag. The core already accepts a per-model `input: ["text", "image"]` declaration — the official page just does not expose it either.

This plugin brings both configuration surfaces back into the UI: **edit right inside the official model editor card**, plus **one-click auto-adapt**.

## Features

- **In-page injection**: an editor block appears in the official Models page under each model row's disclosure, next to context window / max tokens — not a separate settings page, but part of the official editing flow (same `settings.mutate` contract, same save style). The block spans the full row; its level rows split into the same two columns as the official capacity pair. It now carries two sections — **Reasoning effort** and **Input modalities** — owned by one pair of Apply/Reset buttons at the bottom.
- **Staging on unsaved rows**: the editor also appears on rows that are not saved yet, through one pipeline for two shapes — a provider's create card (auto-adapt reads the typed protocol/endpoint straight off the card), and a **new model row added under an already-saved provider** (auto-adapt then works from the stored route facts plus the display name typed on the row). **Stage** holds the declaration in memory; it lands automatically the moment that row (or provider) is saved, and a declaration already in the document is never overwritten. Note staging cannot express a deliberate "unset": applying an all-clear draft simply withdraws the staging and lets host auto-fill fill its suggestion back in — to declare nothing durably, save the row first, then clear every level and Apply.
- **Input-modality declaration**: one checkbox ("Image input") turns a hand-declared model vision-capable end to end — composer attachments, the read-image tool, and proxy gating all key off the same flag. Unchecking narrows the declaration to text-only; clearing it writes a durable `inputUnset` marker that host auto-fill respects, exactly like its reasoning-efforts sibling.
- **Zoned suggestion display**: Auto-adapt reports what it applied (source · confidence) on its own line, says where modality advice came from (endpoint listing / knowledge base / name heuristic — the last one explicitly flagged low-confidence), and renders reference capacities (context window, max output) in a separate read-only block marked "hints only, never auto-filled". Values are thousands-grouped so you can copy them straight into the official capacity inputs by hand.
- **Auto-adapt**: a built-in model knowledge base (DeepSeek V3/V4/R1 with its vision experiment; OpenAI GPT-4o/GPT-4.1/GPT-5.1–5.6 by generation including the codex variants, the o-series, the gpt-oss open weights and the non-reasoning `-chat` lines; Claude 3.x/4.5–5 with per-generation effort ladders (only the models Anthropic officially lists as effort-capable get one), Gemini, Grok 4.3–4.6, Mistral Small 2603 / Medium 3-5 (the reasoning_effort models; the deprecated magistral line declares no effort control), Qwen incl. Qwen-VL/QvQ and the 3.8 generation, GLM incl. GLM-4V/4.5V/4.6V/5V and GLM-5.2/5.3, Kimi K2.5/K2.6/K2.7-Code/K3, MiniMax M3's thinking toggle, Doubao, Hunyuan hy3, Step incl. 3.5/3.6/3.7, Baidu ERNIE (no effort control on the official surface) — every entry re-verified against each vendor's official docs in 2026-08 and cross-checked against the public OpenRouter catalog; vision-capable variants carry their own entries so the base stem never claims images for them) plus protocol inference keyed by pi-ai's real wire protocols (`openai-completions` / `openai-responses` / `anthropic-messages`, plus a DeepSeek endpoint dialect from `baseURL` — only `api.deepseek.com`, the verified official host) fills recommended levels and wire spellings in one click. Families whose endpoints expose no effort-style control reachable here (Llama, Nova, Phi, Cohere, Perplexity sonar) deliberately carry no entry — the low-confidence generic suggestion is more honest. Compat suggestions are gated per protocol: the openai-completions gate takes thinkingFormat/supportsReasoningEffort, and adaptive-thinking Claude families on anthropic-messages routes get the `forceAdaptiveThinking` pin that makes pi-ai dispatch their declared efforts as `output_config.effort`.
- **Endpoint evidence**: Auto-adapt also probes the provider's RAW `/models` listing through a same-origin host route (credential resolved server-side, never echoed) and fuses the signal by confidence — an explicit "does not reason" wins outright; knowledge-base wire values stay authoritative; every suggestion is labeled high / medium / low so you know what to double-check. The same probe reads **modality disclosures** (OpenRouter-style `architecture.input_modalities`, models.dev-style nesting, `supported_features`/`capabilities` vision flags, `supports_vision`) and the advertised **context length**; an explicit listing outranks the knowledge base, silence changes nothing. The probe mirrors the harness's own model discovery on the `0.1.2-rc.1` kernel: it interrogates the same protocol set (OpenAI-compatible and, newly, **Anthropic Messages** — its native `/v1/models` route with `x-api-key` plus the fixed `anthropic-version`), accepts the enriched `models`-map listing shape alongside the standard `data` array, carries the provider profile's configured request headers (a resolved credential still wins its name), and applies the same 4 MB listing ceiling — deployments that authenticate through a custom header now probe as cleanly as they list. The harness's own attribution headers are deliberately not sent: this is a same-origin diagnostic, not a harness request.
- **Host auto-fill**: on every settings update, models without a `reasoningEfforts` declaration get a recommended one — and missing input-modality declarations are filled too (opt out via `modalityAutofill: false`; declared parts, explicit `false`, and deliberately unset markers are never touched, and capacities are never written at all). The write is optimistic-locked: if your edit moved the namespace first, the fill backs off and waits for the next update — it never fights you for the write.
- **Three intents**: all levels off = unset the declaration (back to inheritance — persisted as a `reasoningEffortsUnset` marker so auto-fill respects it, even across restarts); only `off` armed = disable reasoning (`false`); levels armed = write the declaration. The editor stays in sync with official-page re-renders and pushed settings changes without clobbering your in-flight edits.
- **Composer reasoning-effort slider (full popover replication)**: when the official model menu (the bottom-right seat's popover) opens, its body is replaced on the same painted frame by the upstream design — the slider (white round thumb, gradient pill track, radiation canvas + flare; levels from the current model's adapter-advertised ladder) with 14px padding, a separator, and ONE model row reading *name · current effort ›* whose click opens the official model list. The official "Effort" drill-in row is gone because the slider IS the effort control; the official menu shell and the bottom-right trigger stay untouched. Dragging commits through the official session model-selection seam (optimistic, rolled back on refusal); a refused selection announces in the menu. Models with fewer than two levels show the quiet hint plus the model row. The replica mounts synchronously with the menu, so no official window flashes first. Model switches keep your level: a switch submitted without an explicit effort (the official model list) re-applies the level you last picked **for that model** — remembered per provider/model id — or the vendor's documented default from the knowledge base when it has none, in the same atomic commit so no "Default" state flashes in between (gated by the slider toggle; a model without the level on its ladder stays on the official default).
- **Models-page toggle**: the "Reasoning effort slider" switch moved out of the general settings and onto the **Models** settings page, below the *Add provider* / *Add custom provider* actions, inside a boxed container (same item form as the upstream plugin). On the `0.1.2-rc.1` kernel the toggle rides the official `settings.models.footer` slot, which it takes unconditionally; a DOM fallback below the add actions exists only for the first scans before the slot render retires it.
- **Defensive injection**: the injector keys off the official page's DOM (aria-labels / classes). If an official upgrade changes the structure, injection simply stops and the official page is untouched; the next scan re-injects once the structure is back.
- Bilingual copy (中文 / English).

## Install

Requires DeepSeek Harness **`0.1.2-rc.1` or `0.1.3-alpha.1`** (the current 0.1.x kernel release line; the `@deepseek-ai/dsh-api-remotes@>=0.1.2-rc.1` peer range already covers both, the host half also peers on `@deepseek-ai/dsh-settings` with the same range and on `@deepseek-ai/schemastery@^3.18.0`).

> **On an older DeepSeek Harness?** This line of the plugin targets the `0.1.2-rc` and `0.1.3-alpha` kernel release lines — the `0.1.1-rc.x` line and the `0.1.2-alpha.1`–`alpha.5` pre-releases are **no longer supported**. Please upgrade Harness, or install an older plugin release that matches your kernel (for example `dsh-better-reasoning-effort@0.3.4` for the `0.1.1-rc` / `0.1.2-alpha` lines).

Since `0.1.2-rc.1` is the compilation baseline and `0.1.3-alpha.1` leaves every seam this plugin rides **unchanged** (verified source-level: the settings Remote wire, the Models-page anchors, the model-directory types, slots / locale, and the llm-pi-ai profile schema are identical), the same artifact runs on both kernels; a smoke test on `0.1.3-alpha.1` is recommended once it lands on npm. Seam details: the settings Remote is the generated Typert `ctx.remote.settings` stub (argument-less `describe`, positional `mutate(ns, ops, expectedRevision)`, `{ok, value | error}` envelopes, `settings/conflict` / `settings/rejected` refusal codes), the Models-page anchors (`Capacities`/容量, Model ID, Display name, Provider ID, Base URL, API protocol; the `settings.models.footer` slot) are unchanged, and the raw-listing probe mirrors the kernel's own model discovery — the same protocol set (now including **Anthropic Messages** via its native `/v1/models` route with `x-api-key` + `anthropic-version`), the same dual `data`/`models` listing shapes, and the same 4 MB ceiling. The client bundle requests no official module at runtime, so it loads unchanged.

**One DOM-bypass path for the per-model editor (no version sniffing):** the injector keys off the official Capacity disclosure anchors (`Capacities`/`容量`), so the editor mounts under every model row that expands — inside the *edit → custom settings* flow — including unsaved rows on a provider's create card (staged, flushed the moment the row is saved). The slider toggle rides the official `settings.models.footer` slot, declared through the plugin's own `remote.settings` inject — the same service contract the official Models page consumes. The Models page's other sanctioned seat, the keyed `settings.models.provider-card` (per provider card), is the migration path for card-level UI — but no slot reaches a single model row, which is why the per-model editor keeps the DOM bypass.

### From npm

```bash
# under the dsh web profile
dsh plugin --profile web add dsh-better-reasoning-effort
```

### From GitHub

```bash
# under the dsh web profile
dsh plugin --profile web add github:HaoyueQin/dsh-better-reasoning-effort
```

The `github:` source only pulls source; `lib/` is built by the package's `prepare` hook. pnpm does not run build scripts of git dependencies by default — the installer prints the `allowBuilds` key it needs; follow that and `add` again.

### Local development

```bash
npm install && npm run build
dsh plugin --profile web add link:D:/Project/dsh-better-reasoning-effort
```

Restart `dsh web`, hard-refresh the browser. Each model row's disclosure on the official Models page now carries a "Reasoning effort" block.

## Usage

1. Configure a third-party provider (API key etc.) on the official Models page.
2. Expand a model row: the editor block sits under the official capacity fields.
   - Check levels (off / minimal / low / medium / high / xhigh / max) and fill the wire values (e.g. give `high` the spelling `ultra`, and the gateway receives `ultra` when you pick High in the composer);
   - Toggle **Image input** under *Input modalities* to declare what the model accepts (unchecked with no declaration = inherit the provider default, usually text-only);
   - Click **Auto-adapt** to fill recommended levels and modalities from the knowledge base / protocol / endpoint listing — reference capacities show up as read-only hints you can copy into the official fields yourself;
   - Click **Apply** to write the setting.
3. All levels off + Apply = unset the declaration; only `off` checked + Apply = disable reasoning (`false`); *Clear declaration* on the modality row + Apply = back to inheriting the provider default.

Declared models are immediately selectable for reasoning effort in the composer's model picker, and image-declared models accept attachments end to end.

## Configuration

The host half accepts optional configuration on its profile row (the values below are the defaults):

```yaml
- insert:
    - id: dsh-better-reasoning-effort
      name: dsh-better-reasoning-effort
      config:
        # Auto-fill undeclared models on boot and after settings updates.
        autofill: true
        # Whether the auto-fill above also fills input-modality declarations.
        modalityAutofill: true
        # Upstream /models probe fetch timeout, in milliseconds.
        probeTimeoutMs: 15000
        # Boot-fill retry backoff schedule; [] means "try exactly once".
        bootRetryDelaysMs: [1000, 2000, 4000, 8000, 16000, 30000]
```

Set `autofill: false` to disable the silent auto-fill entirely — the browser-side **Auto-adapt** button keeps working.

## How it works

```
Browser (lib/client.js)                  Host (lib/index.js)
├─ DOM injector                          └─ Auto-fill
│   MutationObserver on the models page      settings/updated → adds a
│   → mounts EffortEditor in each            recommended reasoningEfforts
│     model row's disclosure                 for undeclared models
├─ EffortEditor (React component)             (knowledge base + inference)
│   level checkboxes / wire values /
│   input-modality toggle /
│   auto-adapt (zoned suggestions) / apply
│   └─ writes settings.mutate (llm-pi-ai)
```

- **Knowledge base + protocol inference**: `suggestEfforts()` in `src/knowledge.ts`, a pure function shared by host and browser — fusing endpoint signals, curated entries (levels, modalities, reference capacities), a name heuristic, and protocol inference.
- **DOM injection**: `reconcile()` in `src/client/injector.ts` locates model rows by the official button aria-label (`Capacities`/`容量`) and mounts the editor into the capacity disclosure.
- **Writing**: `createEditorApi()` in `src/client/ops.ts` rewrites `providers.<route>.models[i].reasoningEfforts` — and, when an intent travels, `.input` — via `settings.mutate`, preserving every other row field; on a revision conflict it re-reads and retries once (the same recovery the official settings form uses).
- **Shared constants**: `src/constants.ts` carries the plugin id, settings namespace, and DOM marker used by both halves.

## Development

```bash
npm run typecheck   # tsc strict check on src
npm test            # vitest: knowledge / inference / autofill / DOM injection / writing
npm run build       # lib/*.js + lib/client.js (module-loader bundle)
```

Contract version: `@deepseek-ai/dsh-api-remotes@0.1.2-rc.1` (client contract types), verified by typecheck, the test suite, and a full build against the `0.1.2-rc.1` packages. The `0.1.3-alpha.1` contract surface is source-identical; a runtime smoke test will follow once it is published to npm.

## Known limitations

- Injection depends on the official Models page's current DOM (aria-label/class). If an official upgrade changes the structure, injection pauses until adapted; the official page is unaffected meanwhile.
- The official model menu's Arrow-key roving focus walks its own (hidden) root cells, which is a no-op on display:none nodes — keyboard users reach the replica via Tab, and the replica row's Enter opens the official model list.
- The auto-adapt probe route answers **loopback and IP-literal Hosts only** — the core `/api` fence's Host-allowlist discipline without its `trustedHosts` escape hatch (a rebound page always names the attacker's *domain* in Host, so named hosts are refused outright). LAN deployments serving the GUI under a domain name get a 403 from this one route (IP-literal LAN hosts keep working); every other feature is unaffected.
- `reasoningEfforts` declarations are suggestions: which levels/spellings an endpoint actually accepts is up to its docs — tweak each in the UI.
- The knowledge base is not exhaustive — spellings drift as vendors ship models, and families without an effort ladder carry no entry at all; unlisted models fall back to protocol inference + generic levels and can be adjusted by hand.
- The modality vocabulary follows pi-ai's core (`text` / `image` today). Wider support some gateways serve (PDF, audio, video) is recorded per family until the core vocabulary grows — declaring them is impossible today by design, not oversight.
- Name-heuristic modality advice (vision-flavored ids like `*-vl*` / `*vision*` / `gpt-4o`) is deliberately low-confidence and labeled as such — verify before relying on it.

## Acknowledgements

The composer reasoning-effort slider is **adapted from [dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) by [HanaAyane](https://github.com/HanaAyane)** (MIT license) — thank you for the original work and the codex-style effort control idea.

What this plugin took from it:

- the session model-selection contract it rides (per-session model directory → adapter-advertised effort ladder → `selectModel` submit, with optimistic snap and rollback on refusal);
- the slider interaction shape (drag / keyboard, level label next to the thumb).

What was deliberately **changed** in this integration:

- **White round thumb only.** The chibi-runner "big fish" knob is not carried over (it swaps the thumb for the fish sprite); everything else is upstream verbatim — the gradient pill track, the left-clipped radiation canvas effect and the flare glow, the drag/keyboard contract, the optimistic commit with rollback.
- **The official model seat is never replaced.** The upstream plugin shadows the whole seat (its own trigger + menu); here the official bottom-right *model · effort* display stays untouched, and the slider is injected into the top of the official menu when it opens.
- **Different placement / fewer settings.** The upstream "推理强度滑块 / 大肥鱼滑块" items lived in the general settings page; here only the *Reasoning effort slider* toggle remains, in a boxed container on the **Models** page below the add-provider actions. The "大肥鱼滑块" item is dropped together with the feature.
- **Maintained on the `0.1.2-rc` and `0.1.3-alpha` lines.** This is a reduced re-implementation over the harness wire contract (not a fork of the upstream bundle): it runs on the `0.1.2-rc.1` and `0.1.3-alpha.1` kernels (every seam it rides is identical — see the compatibility note above) without the upstream's `0.1.0-rc.6` pins, and the whole mount/unmount lifetime is managed by this plugin's DOM injector. If the upstream project resumes publishing, keep both in mind: running both plugins doubles up — the upstream shadows the official seat again, so the official trigger would disappear once more.

If you used the upstream plugin before, remove it to avoid two effort controls on the same seat:

```bash
dsh plugin --profile web remove dsh-reasoning-effort
```

## Activity

[![HaoyueQin/dsh-better-reasoning-effort GitStock K-Line Chart](https://gitstock.org/HaoyueQin/dsh-better-reasoning-effort/stock.svg)](https://gitstock.org/HaoyueQin/dsh-better-reasoning-effort)

## License

MIT
