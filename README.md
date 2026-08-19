# dsh-better-reasoning-effort

![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe)
![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ecosystem-4d6bfe)
![Version](https://img.shields.io/badge/version-0.1.0-4d6bfe)
![Docs](https://img.shields.io/badge/docs-EN%20%7C%20ZH-4d6bfe)

**English** | [中文](README.zh.md)

Reasoning-effort editing for **third-party models** in DeepSeek Harness — thinking levels declared per model, auto-adapted from a model knowledge base + wire-protocol inference, edited right inside the official Models page card.

## Why

The `llm-pi-ai` adapter of DeepSeek Harness natively supports per-model `reasoningEfforts` declarations (which thinking levels a model accepts, and the exact string to send on the wire for each). But the official Models page editor **deliberately keeps this field out of reach** — the official notes say it is a per-model capability and a provider-level knob would break some models. As a result:

- Third-party models get **no thinking-level picker** in the composer (`getSupportedThinkingLevels` short-circuits to `["off"]`);
- Only the official DeepSeek API (the built-in catalog) can set reasoning effort;
- Setting levels for a third-party model meant hand-writing the `reasoningEfforts` / `compat` blocks in `settings.yaml`.

This plugin brings that configuration back into the UI: **edit right inside the official model editor card**, plus **one-click auto-adapt**.

## Features

- **In-page injection**: a "Reasoning effort" block appears in the official Models page under each model row's disclosure, next to context window / max tokens — not a separate settings page, but part of the official editing flow (same `settings.mutate` contract, same save style). The block spans the full row at the same density as the official capacity fields.
- **Auto-adapt**: a built-in model knowledge base (DeepSeek V3/R1, OpenAI o-series, Qwen, GLM, Kimi, MiniMax, Doubao…) plus protocol inference (openai / deepseek / anthropic / gemini dialects, judged from `api` / `baseURL`) fills recommended levels and wire spellings in one click.
- **Host auto-fill**: on every settings update, models without a `reasoningEfforts` declaration get a recommended one (declared models and explicit `false` are never touched). The write is optimistic-locked: if your edit moved the namespace first, the fill backs off and waits for the next update — it never fights you for the write.
- **Three intents**: all levels off = unset the declaration (back to inheritance); only `off` armed = disable reasoning (`false`); levels armed = write the declaration. The editor stays in sync with official-page re-renders and never clobbers your in-flight edits.
- **Defensive injection**: the injector keys off the official page's DOM (aria-labels / classes). If an official upgrade changes the structure, injection simply stops and the official page is untouched; the next scan re-injects once the structure is back.
- Bilingual copy (中文 / English).

## Install

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
2. Expand a model row: the "Reasoning effort" block sits under the official capacity fields.
   - Check levels (off / minimal / low / medium / high / xhigh / max) and fill the wire values (e.g. give `high` the spelling `ultra`, and the gateway receives `ultra` when you pick High in the composer);
   - Click **Auto-adapt** to fill recommended levels from the knowledge base / protocol;
   - Click **Apply** to write the setting.
3. All levels off + Apply = unset the declaration; only `off` checked + Apply = disable reasoning (`false`).

Declared models are immediately selectable for reasoning effort in the composer's model picker.

## How it works

```
Browser (lib/client.js)                  Host (lib/index.js)
├─ DOM injector                          └─ Auto-fill
│   MutationObserver on the models page      settings/updated → adds a
│   → mounts EffortEditor in each            recommended reasoningEfforts
│     model row's disclosure                 for undeclared models
├─ EffortEditor (React component)             (knowledge base + inference)
│   level checkboxes / wire values /
│   auto-adapt / apply
│   └─ writes settings.mutate (llm-pi-ai)
```

- **Knowledge base + protocol inference**: `suggestEfforts()` in `src/knowledge.ts`, a pure function shared by host and browser.
- **DOM injection**: `reconcile()` in `src/client/injector.ts` locates model rows by the official button aria-label (`Capacities`/`容量`) and mounts the editor into the capacity disclosure.
- **Writing**: `createEditorApi()` in `src/client/ops.ts` rewrites `providers.<route>.models[i].reasoningEfforts` via `settings.mutate`, preserving every other row field; on a revision conflict it re-reads and retries once (the same recovery the official settings form uses).
- **Shared constants**: `src/constants.ts` carries the plugin id, settings namespace, and DOM marker used by both halves.

## Comparison

| | better-model-provider | dsh-reasoning-effort-autofill | HanaAyane/dsh-reasoning-effort | This plugin |
|---|---|---|---|---|
| Edit entry | separate settings page | no UI (silent fill) | separate settings page (paste YAML) | **inside the official model editor card** |
| Auto-adapt | none | hard-coded OpenAI levels | diagnose + paste | **knowledge base + protocol inference**, one click |
| Official page fusion | no | no | no | **yes** (DOM injection) |

## Development

```bash
npm run typecheck   # tsc strict check on src
npm test            # vitest: knowledge / inference / autofill / DOM injection / writing
npm run build       # lib/*.js + lib/client.js (module-loader bundle)
```

Contract version: `@deepseek-ai/dsh-api-remotes@0.1.0-rc.7` (client contract types), tested with the dsh CLI `0.1.0-rc.6`.

## Known limitations

- Injection depends on the official Models page's current DOM (aria-label/class). If an official upgrade changes the structure, injection pauses until adapted; the official page is unaffected meanwhile.
- `reasoningEfforts` declarations are suggestions: which levels/spellings an endpoint actually accepts is up to its docs — tweak each in the UI.
- The knowledge base is not exhaustive — unlisted models fall back to protocol inference + generic levels and can be adjusted by hand.

## License

MIT
