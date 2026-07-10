# Fase 3 — Primera integración de IA: Resumen

> **IA:** ✅ `deepseek-ai/deepseek-v4-flash` vía NVIDIA NIM. Es la acción más simple; sirve para **validar el
> pipeline completo** (contexto → prompt → `requestUrl` → parseo → UI → errores) antes de replicarlo.

---

## 1. Objetivo
Resumir la nota activa usando su contexto (Fase 1) y las claves (Fase 2), con **manejo de errores explícito**
por cada modo de fallo, mostrado al usuario con `Notice` — nunca un crash silencioso.

## 2. Definition of Ready
- Fases 1 y 2 "Done".
- Un `.env` con `NVIDIA_API_KEY` válida en el vault de pruebas.

## 3. Alcance
**In:** `LLMPort`, `NvidiaLLMService.summarize()`, errores tipados (`ApiErrors`), comando "Resumir nota",
render en `ResultModal`.
**Out:** explicar/investigar/imagen (fases siguientes); streaming (se usa `stream:false`).

## 4. Diseño técnico

### 4.1 DTO — `src/domain/models/SummaryResult.ts`
```ts
export interface SummaryResult {
  readonly text: string;             // resumen final
  readonly reasoning?: string;       // reasoning_content (opcional, para depurar)
  readonly model: string;
}
```

### 4.2 Puerto — `src/domain/ports/LLMPort.ts`
```ts
import type { NoteContext } from "../models/NoteContext";
import type { SummaryResult } from "../models/SummaryResult";

export interface ChatMessage { readonly role: "system" | "user" | "assistant"; readonly content: string; }

export interface LLMPort {
  summarize(context: NoteContext, noteBody: string): Promise<SummaryResult>;
  /** Primitiva reutilizada por Explicar/Investigar. */
  chat(messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

export interface ChatOptions {
  readonly tools?: readonly unknown[];
  readonly toolChoice?: "auto" | "none";
  readonly maxTokens?: number;
}
export interface ChatResponse {
  readonly content: string;
  readonly reasoning?: string;
  readonly toolCalls?: readonly ToolCall[];
}
export interface ToolCall { readonly id: string; readonly name: string; readonly argumentsJson: string; }
```

### 4.3 Errores tipados — `src/errors/ApiErrors.ts`
```ts
export class InvalidKeyError extends Error {}     // 401/403 o key ausente
export class RateLimitError extends Error {}      // 429
export class NetworkError extends Error {}        // sin conexión / timeout
export class EmptyResponseError extends Error {}  // 200 pero sin contenido
export class UpstreamError extends Error {}       // 5xx u otros
```

### 4.4 Adapter — `src/services/NvidiaLLMService.ts` (usa `requestUrl`, NO fetch)
```ts
import { requestUrl } from "obsidian";
import type { LLMPort, ChatMessage, ChatOptions, ChatResponse } from "../domain/ports/LLMPort";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import type { NoteContext } from "../domain/models/NoteContext";
import type { SummaryResult } from "../domain/models/SummaryResult";
import { InvalidKeyError, RateLimitError, NetworkError, EmptyResponseError, UpstreamError } from "../errors/ApiErrors";
import { REQUEST_TIMEOUT_MS } from "../config/constants";

export class NvidiaLLMService implements LLMPort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly reasoningEffort: "low" | "medium" | "high",
  ) {}

  async summarize(context: NoteContext, noteBody: string): Promise<SummaryResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: "Eres un asistente que resume notas de forma clara y estructurada en español." },
      { role: "user", content: this.buildSummaryPrompt(context, noteBody) },
    ];
    const res = await this.chat(messages, { maxTokens: 2048 });
    if (!res.content.trim()) throw new EmptyResponseError("Respuesta vacía del modelo");
    return { text: res.content, reasoning: res.reasoning, model: this.model };
  }

  async chat(messages: readonly ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const key = await this.secrets.get("NVIDIA_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu NVIDIA_API_KEY en Settings/.env");

    const body = {
      model: this.model,
      messages,
      temperature: 1,
      top_p: 0.95,
      max_tokens: opts.maxTokens ?? 4096,
      stream: false,
      ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" } : {}),
      // Parámetros de razonamiento de DeepSeek-V4 (van a nivel raíz en NIM):
      chat_template_kwargs: { thinking: true, reasoning_effort: this.reasoningEffort },
    };

    let resp;
    try {
      resp = await requestUrl({
        url: `${this.baseUrl}/chat/completions`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        throw: false, // manejamos los status nosotros
      });
    } catch (e) {
      throw new NetworkError("Sin conexión con NVIDIA NIM"); // no exponemos la key
    }

    this.assertStatus(resp.status);
    const msg = resp.json?.choices?.[0]?.message;
    return {
      content: msg?.content ?? "",
      reasoning: msg?.reasoning_content ?? msg?.reasoning,
      toolCalls: this.parseToolCalls(msg?.tool_calls),
    };
  }

  private assertStatus(status: number): void {
    if (status === 401 || status === 403) throw new InvalidKeyError("API key inválida o sin permisos");
    if (status === 429) throw new RateLimitError("Límite de peticiones alcanzado; espera un momento");
    if (status >= 500) throw new UpstreamError("NVIDIA NIM devolvió un error del servidor");
    if (status >= 400) throw new UpstreamError(`Error inesperado (HTTP ${status})`);
  }

  private buildSummaryPrompt(c: NoteContext, body: string): string {
    const links = c.outgoingLinks.map((l) => l.title).join(", ") || "ninguno";
    return [
      `Nota: "${c.title}" (${c.wordCount} palabras).`,
      `Enlaza a: ${links}.`,
      `Headings: ${c.headings.map((h) => h.text).join(" / ") || "ninguno"}.`,
      `Contenido:\n${body}`,
      `\nDevuelve un resumen conciso (5-8 viñetas) en español.`,
    ].join("\n");
  }

  private parseToolCalls(raw: unknown): ChatResponse["toolCalls"] {
    if (!Array.isArray(raw)) return undefined;
    return raw.map((t: any) => ({ id: t.id, name: t.function?.name, argumentsJson: t.function?.arguments ?? "{}" }));
  }
}
```
> ⚠️ **Verificar al construir:** que `chat_template_kwargs` se acepte a nivel raíz del body en el endpoint REST
> de NIM (en el SDK de Python va dentro de `extra_body`, que el SDK aplana al body). Si NIM lo rechaza, mover
> a la forma que documente NVIDIA. El resto (mensajes, temperature, top_p, max_tokens) es OpenAI-estándar.

### 4.5 Comando (en `main.ts`)
```ts
this.addCommand({
  id: "summarize-note",
  name: "Resumir nota activa con IA",
  callback: () => this.runAction(async (vault, llm) => {
    const ctx = await vault.getActiveNoteContext();
    if (!ctx) throw new Error("Abre una nota markdown primero.");
    const body = await vault.readNote(ctx.path);
    const result = await llm.summarize(ctx, body);
    new ResultModal(this.app, `Resumen: ${ctx.title}`, result.text).open();
  }),
});
```
`runAction` es un helper que centraliza el **manejo de errores** (traduce cada error tipado a un `Notice`):
```ts
private async runAction(fn: (v: VaultPort, l: LLMPort) => Promise<void>): Promise<void> {
  try { await fn(this.vault, this.llm); }
  catch (e) {
    if (e instanceof InvalidKeyError) new Notice("🔑 " + e.message);
    else if (e instanceof RateLimitError) new Notice("⏳ " + e.message);
    else if (e instanceof NetworkError) new Notice("📡 " + e.message);
    else if (e instanceof EmptyResponseError) new Notice("🕳️ El modelo no devolvió contenido.");
    else new Notice("⚠️ " + (e as Error).message);
  }
}
```

## 5. Pasos numerados
1. `ApiErrors.ts`, `LLMPort.ts`, `SummaryResult.ts`.
2. `NvidiaLLMService` con `chat()` + `summarize()`.
3. `constants.ts`: `REQUEST_TIMEOUT_MS`, defaults de URL/modelo.
4. Helper `runAction` y comando "Resumir".
5. Probar caso feliz y los 4 de error (§8).

## 6. Frameworks / librerías
API de Obsidian (`requestUrl`, `Notice`, `Modal`). Sin deps nuevas (no OpenAI SDK).

## 7. Seguridad (de esta fase)
- La key se obtiene por `SecretsPort` justo antes de la request; **no** se guarda en campos ni logs.
- Ningún mensaje de error incluye la key ni la URL con credenciales.
- `throw: false` + traducción a errores tipados evita volcar el body de la respuesta en consola.

## 8. Manejo de errores / edge cases (los 4 del `plan.md`)
| Caso | Cómo se fuerza en QA | Resultado esperado |
|------|----------------------|--------------------|
| Key inválida | poner `nvapi-mal` en `.env` | `Notice` "🔑 API key inválida" (401→`InvalidKeyError`). |
| Sin conexión | apagar wifi | `Notice` "📡 Sin conexión" (`NetworkError`). |
| Rate limit | disparar muchas veces | `Notice` "⏳ Límite alcanzado" (429→`RateLimitError`). |
| Respuesta vacía | prompt que fuerce vacío / mock | `Notice` "🕳️" (`EmptyResponseError`). |
| Sin nota activa | comando sin nota | `Notice` pidiendo abrir nota. |

## 9. Tests (Vitest, mockeando `requestUrl` y `SecretsPort`)
```ts
vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));
import { requestUrl } from "obsidian";

it("mapea 401 a InvalidKeyError", async () => {
  (requestUrl as any).mockResolvedValue({ status: 401, json: {} });
  const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
  await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(InvalidKeyError);
});

it("devuelve el contenido en caso feliz", async () => {
  (requestUrl as any).mockResolvedValue({ status: 200, json: { choices: [{ message: { content: "resumen" } }] } });
  const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
  expect((await svc.chat([{ role: "user", content: "x" }])).content).toBe("resumen");
});
```
**Casos borde:** key ausente (`InvalidKeyError` antes de la red), 429, 500, `content` vacío.

## 10. CI para la fase
Tests en `ci.yml`. El paso anti-secreto del bundle sigue vigente.

## 11. Definition of Done
- [ ] "Resumir nota" produce un resumen coherente en el vault de pruebas.
- [ ] Los **4 casos de error** muestran su `Notice` distinto (probados manualmente).
- [ ] Tests de mapeo de status y caso feliz verdes.
- [ ] Ninguna traza de la key en consola.

## 12. Validación manual (del `plan.md`)
> "Probar los 4 casos de error de forma manual (key mal puesta, wifi apagado, etc.) antes de dar por cerrada
> la fase."

## 13. Commit / PR sugerido
```
feat(ai): acción Resumir con deepseek-v4-flash (NVIDIA NIM)

- LLMPort + NvidiaLLMService vía requestUrl (sin fetch/SDK).
- Errores tipados (InvalidKey/RateLimit/Network/Empty/Upstream) → Notice.
- Tests de mapeo de status y caso feliz.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| `chat_template_kwargs` no aceptado por NIM | Verificar doc viva; mover al formato correcto (⚠️ §4.4). |
| Modelo cambia de nombre | `textModel` en settings/constants: cambio en un punto. |
| Respuestas lentas | `REQUEST_TIMEOUT_MS` + `Notice` de "generando…"; considerar streaming en Fase 7. |
