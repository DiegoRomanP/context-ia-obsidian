# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian plugin (TypeScript + esbuild) that reads the active note and its
relationships (outgoing links, backlinks, headings) and offers four AI actions
over that context: summarize, explain a selection, and research a topic with
cited sources (tool-calling) via NVIDIA NIM; generate an image via Hugging
Face Inference Providers. This repo is meant to live at
`<vault>/.obsidian/plugins/context-ia-obsidian` — it is not a standalone web app.

## Commands

```bash
npm install         # install deps
npm run dev          # esbuild watch/rebuild (no bundling of secrets — read at runtime)
npm run build        # tsc --noEmit && esbuild production build -> main.js
npm run lint          # eslint . --ext .ts
npm run typecheck     # tsc --noEmit
npm test              # vitest run (full suite)
npm run test:watch    # vitest watch mode
npm run format         # prettier --write .
```

Run a single test file: `npm test -- HuggingFaceImageService` (vitest's
run-mode positional arg matches by filename substring). For watch mode on one
file use `npm run test:watch -- HuggingFaceImageService`.

CI (`ci.yml`) runs, in order: `lint` → `typecheck` → `test` → `build` → a grep
over the built `main.js` for `nvapi-`/`tvly-`/`hf_[A-Za-z0-9]{20,}` patterns.
Reproduce that last check locally with
`grep -RE "nvapi-|tvly-|hf_[A-Za-z0-9]{20,}" main.js` after a build — this is
the actual gate that decides whether a change is safe to ship, not just the
test suite. Note the `hf_` pattern requires 20+ contiguous alphanumeric chars:
`@huggingface/inference` bundles legitimate internal identifiers like
`hf_hub_download` that a looser single-char pattern would false-positive on.

## Architecture

Strict ports & adapters (hexagonal). The rule that matters: **domain and
services never import from `obsidian` except through the adapters that
implement a port** — `NoteContextService`, `NvidiaLLMService`,
`TavilySearchService`, `SettingsSecretsAdapter` are the only files touching
the Obsidian API (`requestUrl`, `App`, `TFile`, etc.). `HuggingFaceImageService`
is the one adapter that instead wraps a third-party SDK (`@huggingface/inference`)
— see below. This boundary is what makes everything else unit-testable
without a real Obsidian environment.

```
src/
  main.ts            # Plugin lifecycle, command registration, constructor DI wiring
  domain/
    models/           # Immutable DTOs (NoteContext, SummaryResult, ResearchResult, ImageResult, PluginSettings)
    ports/            # Interfaces: VaultPort, SecretsPort, LLMPort, SearchPort, ImagePort
  services/           # Port implementations (adapters)
  secrets/            # SecretsPort adapters: DotenvSecretsAdapter (.env) / SettingsSecretsAdapter (Secret Storage)
  ui/                 # SettingsTab, ResultModal, PromptModal
  config/             # constants.ts (endpoints, model IDs, limits), tools.ts (tool-calling schema)
  errors/             # Typed errors: InvalidKeyError, RateLimitError, NetworkError, EmptyResponseError,
                       # UpstreamError, EmptySelectionError, PayloadTooLargeError
  utils/              # Pure helpers: truncateText, base64, sanitizeFileNamePart, debounce
tests/                # Mirrors src/, one file per service/util
__mocks__/obsidian.ts # Stub used by tests (aliased in vitest.config.ts) — the real `obsidian`
                       # npm package has no resolvable entry point for Vite/Vitest
docs/plan/            # Phase-by-phase design docs from the original build (phases 0-7, all complete, v0.1.0)
```

`main.ts` wires everything via getters (`get llm()`, `get search()`,
`get images()`, `get secrets()`) that construct a fresh adapter per call from
current `this.settings` — there is no long-lived singleton service instance,
so a settings change takes effect on the very next command invocation.

### Image generation is on a completely different provider than text

Text (`NvidiaLLMService`) and image (`HuggingFaceImageService`) don't share a
host, an auth scheme, a secret, or even a transport mechanism — don't assume
patterns transfer between them.

Image generation has already burned through two prior models before landing
on the current one, for two different reasons — worth knowing before picking
a replacement:
- `qwen/qwen-image` (NVIDIA NIM): never cloud-invocable at all
  (`"nvcfFunctionId": "None"` in its build.nvidia.com catalog page — self-host
  only). If evaluating any NVIDIA NIM model, verify its catalog page actually
  exposes a cloud function before wiring it in.
- `black-forest-labs/flux.2-klein-4b` (NVIDIA NIM, native GenAI format at
  `ai.api.nvidia.com/v1/genai/{namespace}/{model}`): was cloud-invocable and
  worked in isolated tests, but proved unreliable in practice (inconsistent
  404s / hangs with no response), likely free-tier capacity limits on a
  preview model.
- `krea/Krea-2-Turbo` (current): served via **Hugging Face Inference
  Providers**, routed to the `fal-ai` backend.

### Why `HuggingFaceImageService` uses an SDK instead of `requestUrl`

Every other adapter in this project uses `requestUrl` and never `fetch`, to
avoid CORS issues in Obsidian's renderer — see `NvidiaLLMService` and
`TavilySearchService`. `HuggingFaceImageService` is the deliberate exception,
for a reason specific to this one API: Hugging Face's own docs state that the
raw HTTP contract for non-chat tasks (like text-to-image) routed through a
third-party provider is **not** a stable, provider-agnostic format for direct
callers — "the exact HTTP request may vary between providers... When using
our official client libraries, these provider-specific differences are
handled automatically." Reverse-engineering it would repeat the exact mistake
that broke the two NVIDIA image models above. The CORS risk that `requestUrl`
normally guards against doesn't apply here: Hugging Face's own web playground
calls this same router endpoint via browser `fetch`, evidence of permissive
CORS headers.

Two non-obvious things if touching `HuggingFaceImageService`:
- `client.textToImage(args)` is generated from an **overloaded** function
  where each overload only differs in an optional `options.outputType`
  literal. Calling it with a single argument makes TypeScript resolve to the
  *first* declared overload (`outputType: "url"` → `Promise<string>`), not
  the `Blob` one, even though `"blob"` is the SDK's actual runtime default.
  You must pass `{ outputType: "blob" }` explicitly as the second argument to
  get the correct return type.
- The SDK's error classes (`InferenceClientProviderApiError`,
  `InferenceClientHubApiError`) expose the failed request's status as
  `error.httpResponse.status` — not `.response.status` as the prose in HF's
  own docs README describes it. Verified against the installed package's
  `.d.ts`, not the docs prose, after that exact mismatch was caught once already.

### Other API gotchas worth knowing before touching `NvidiaLLMService`

- `reasoning_effort` is a **root-level** field on the chat/completions body
  (confirmed against docs.api.nvidia.com), with values `"none" | "high" |
  "max"` — not nested under `chat_template_kwargs`, and not the generic
  `"low"/"medium"/"high"` scale.
- Tool-calling follows the OpenAI/vLLM wire format: the assistant message
  carries a `tool_calls` array; each tool's result is a **separate** message
  with `role: "tool"`, `tool_call_id`, and `name` — it does not get appended
  back onto an `assistant` message. See `ChatMessage` in `LLMPort.ts` and the
  loop in `ResearchService.research()`.
- Tavily authenticates via `Authorization: Bearer <key>` header, not an
  `api_key` field in the request body.
- `requestUrl` (used everywhere instead of `fetch`, to avoid CORS in the
  Obsidian renderer) has no native timeout — `NvidiaLLMService.withTimeout()`
  wraps it in a `Promise.race`-style timeout using `REQUEST_TIMEOUT_MS`.

### Secrets

`SecretsPort` has two adapters selected by `settings.secretSource`:
`DotenvSecretsAdapter` (reads a `.env` file from the plugin folder at
runtime via `fs`) and `SettingsSecretsAdapter` (Obsidian's native Secret
Storage / keychain, since Obsidian ≥ 1.11.4). Three keys exist:
`NVIDIA_API_KEY`, `TAVILY_API_KEY`, `HF_TOKEN` (see `SecretKey` in
`SecretsPort.ts`). Secrets are **never** read at build time or passed through
esbuild `define` — `esbuild.config.mjs` has an explicit comment forbidding
this, since that would bake the key into `main.js`. `.env`, `data.json`, and
`main.js` are gitignored from the first commit.

A saved `data.json` value **overrides** the corresponding `DEFAULT_SETTINGS`
constant on every load (`loadSettings()` does `{...DEFAULT_SETTINGS,
...savedData}`) — there's no UI field to change `imageModel`/`textModel`
directly, only the constructor default. This means changing a
`DEFAULT_*_MODEL` constant in `constants.ts` has **no effect** on a vault that
already has an old value persisted in its `data.json`; that stale value must
be edited too (or the settings key cleared) or the plugin silently keeps
calling the old model. This exact trap already caused one real incident in
this project (switching image models didn't take effect until `data.json`
was fixed directly).

### Binary/attachment handling

When writing generated images to the vault (`main.ts#insertImage`), bytes
are `.slice()`d before taking `.buffer` — a `Uint8Array` from `Buffer.from()`
can point into Node's shared internal buffer pool, which is larger than the
actual payload; skipping the slice would write garbage past the real image
data. The saved file's extension is derived from the real `ImageResult.mimeType`
(via `extensionForMimeType()`) rather than hardcoded, since which provider/model
is active determines the actual format returned (`HuggingFaceImageService` sets
`mimeType` from the response `Blob`'s real `.type`, whatever the provider sent).

### CI/workflow permissions

Each workflow in `.github/workflows/` sets the minimal `permissions:` block
it needs (see `codeql.yml` and `secret-scan.yml`) rather than inheriting the
repo default. If a workflow needs to pass `GITHUB_TOKEN` to a third-party
action (e.g. `gitleaks-action` needs it to authenticate its license-eligibility
check), scope that job down explicitly — don't rely on the ambient default
token permissions.
