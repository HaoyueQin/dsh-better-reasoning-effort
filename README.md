# DSH Better Reasoning Effort

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
[![npm downloads](https://img.shields.io/npm/dw/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe)
![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ecosystem-4d6bfe)
![Version](https://img.shields.io/badge/version-0.2.1-4d6bfe)
![Docs](https://img.shields.io/badge/docs-EN%20%7C%20ZH-4d6bfe)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**English** | [中文](README.zh.md)

Reasoning-effort **and input-modality** editing for **third-party models** in DeepSeek Harness — thinking levels and image-input support declared per model, auto-adapted from a model knowledge base + wire-protocol inference, edited right inside the official Models page card.

![The thinking-effort editor injected into a model row on the official Models page](assets/models-page-effort-editor.png)

## Why

The `llm-pi-ai` adapter of DeepSeek Harness natively supports per-model `reasoningEfforts` declarations (which thinking levels a model accepts, and the exact string to send on the wire for each). But the official Models page editor **deliberately keeps this field out of reach** — the official notes say it is a per-model capability and a provider-level knob would break some models. As a result:

- Third-party models get **no thinking-level picker** in the composer (`getSupportedThinkingLevels` short-circuits to `["off"]`);
- Only the official DeepSeek API (the built-in catalog) can set reasoning effort;
- Setting levels for a third-party model meant hand-writing the `reasoningEfforts` / `compat` blocks in `settings.yaml`.
- Hand-declared third-party models are treated as **text-only** (`input` defaults to `["text"]`): image attachments are refused before they are sent, the read-image tool refuses, and every gateway path in between gates on the same flag. The core already accepts a per-model `input: ["text", "image"]` declaration — the official page just does not expose it either.

This plugin brings both configuration surfaces back into the UI: **edit right inside the official model editor card**, plus **one-click auto-adapt**.

## Features

- **In-page injection**: an editor block appears in the official Models page under each model row's disclosure, next to context window / max tokens — not a separate settings page, but part of the official editing flow (same `settings.mutate` contract, same save style). The block spans the full row; its level rows split into the same two columns as the official capacity pair. It now carries two sections — **Reasoning effort** and **Input modalities** — owned by one pair of Apply/Reset buttons at the bottom.
- **Create-card staging**: the editor also appears while a provider is still being created — auto-adapt works from the typed protocol/endpoint, **Stage** holds the declaration, and the plugin writes it automatically the moment the provider is saved (a declaration already in the document is never overwritten).
- **Input-modality declaration**: one checkbox ("Image input") turns a hand-declared model vision-capable end to end — composer attachments, the read-image tool, and proxy gating all key off the same flag. Unchecking narrows the declaration to text-only; clearing it writes a durable `inputUnset` marker that host auto-fill respects, exactly like its reasoning-efforts sibling.
- **Zoned suggestion display**: Auto-adapt reports what it applied (source · confidence) on its own line, says where modality advice came from (endpoint listing / knowledge base / name heuristic — the last one explicitly flagged low-confidence), and renders reference capacities (context window, max output) in a separate read-only block marked "hints only, never auto-filled". Values are thousands-grouped so you can copy them straight into the official capacity inputs by hand.
- **Auto-adapt**: a built-in model knowledge base (DeepSeek V3/V4/R1 with its vision experiment; OpenAI GPT-4o/GPT-5.1–5.6 by generation, the o-series, the gpt-oss open weights and the non-reasoning `-chat` lines; Claude 4.x/4.6/Opus-4.7+/5, Gemini, Grok 4.3–4.6, Mistral Magistral / Medium 3.5 / Small latest; Qwen incl. Qwen-VL/QvQ, GLM incl. GLM-4V/5V and GLM-5.2/5.3, Kimi K2.5/K2.6/K2.7-Code/K3, MiniMax M3's thinking toggle, Doubao, Hunyuan hy3, Step incl. 3.5/3.6/3.7 — every entry re-verified against each vendor's official docs on 2026-08-24 and cross-checked against the public OpenRouter catalog; vision-capable variants carry their own entries so the base stem never claims images for them) plus protocol inference keyed by pi-ai's real wire protocols (`openai-completions` / `openai-responses` / `anthropic-messages`, plus a DeepSeek endpoint dialect from `baseURL`) fills recommended levels and wire spellings in one click. Families whose endpoints expose no effort-style control reachable here (Llama, Nova, Phi, Cohere, Perplexity sonar) deliberately carry no entry — the low-confidence generic suggestion is more honest. Compat suggestions are gated to the one protocol whose gate accepts them.
- **Endpoint evidence**: Auto-adapt also probes the provider's RAW `/models` listing through a same-origin host route (credential resolved server-side, never echoed) and fuses the signal by confidence — an explicit "does not reason" wins outright; knowledge-base wire values stay authoritative; every suggestion is labeled high / medium / low so you know what to double-check. The same probe reads **modality disclosures** (OpenRouter-style `architecture.input_modalities`, models.dev-style nesting, `supported_features`/`capabilities` vision flags, `supports_vision`) and the advertised **context length**; an explicit listing outranks the knowledge base, silence changes nothing.
- **Host auto-fill**: on every settings update, models without a `reasoningEfforts` declaration get a recommended one — and missing input-modality declarations are filled too (opt out via `modalityAutofill: false`; declared parts, explicit `false`, and deliberately unset markers are never touched, and capacities are never written at all). The write is optimistic-locked: if your edit moved the namespace first, the fill backs off and waits for the next update — it never fights you for the write.
- **Three intents**: all levels off = unset the declaration (back to inheritance — persisted as a `reasoningEffortsUnset` marker so auto-fill respects it, even across restarts); only `off` armed = disable reasoning (`false`); levels armed = write the declaration. The editor stays in sync with official-page re-renders and pushed settings changes without clobbering your in-flight edits.
- **Defensive injection**: the injector keys off the official page's DOM (aria-labels / classes). If an official upgrade changes the structure, injection simply stops and the official page is untouched; the next scan re-injects once the structure is back.
- Bilingual copy (中文 / English).

## Install

Requires DeepSeek Harness `0.1.1-rc.1` or newer (`@deepseek-ai/dsh-api-remotes@^0.1.1-rc.1`; the host half also peers on `@deepseek-ai/dsh-settings@^0.1.1-rc.1` and `@deepseek-ai/schemastery@^3.18.0`). The wire contract is verified against `0.1.1-rc.2`; older release-candidate lines are not supported.

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

Contract version: `@deepseek-ai/dsh-api-remotes@0.1.1-rc.2` (client contract types), verified by typecheck, the test suite, and a full build against the `0.1.1-rc.2` packages.

## Known limitations

- Injection depends on the official Models page's current DOM (aria-label/class). If an official upgrade changes the structure, injection pauses until adapted; the official page is unaffected meanwhile.
- The auto-adapt probe route answers **loopback and IP-literal Hosts only** — the core `/api` fence's Host-allowlist discipline without its `trustedHosts` escape hatch (a rebound page always names the attacker's *domain* in Host, so named hosts are refused outright). LAN deployments serving the GUI under a domain name get a 403 from this one route (IP-literal LAN hosts keep working); every other feature is unaffected.
- `reasoningEfforts` declarations are suggestions: which levels/spellings an endpoint actually accepts is up to its docs — tweak each in the UI.
- The knowledge base is not exhaustive — spellings drift as vendors ship models, and families without an effort ladder carry no entry at all; unlisted models fall back to protocol inference + generic levels and can be adjusted by hand.
- The modality vocabulary follows pi-ai's core (`text` / `image` today). Wider support some gateways serve (PDF, audio, video) is recorded per family until the core vocabulary grows — declaring them is impossible today by design, not oversight.
- Name-heuristic modality advice (vision-flavored ids like `*-vl*` / `*vision*` / `gpt-4o`) is deliberately low-confidence and labeled as such — verify before relying on it.

## License

MIT
