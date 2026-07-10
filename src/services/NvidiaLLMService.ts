import { requestUrl } from "obsidian";
import type { LLMPort, ChatMessage, ChatOptions, ChatResponse } from "../domain/ports/LLMPort";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import type { NoteContext } from "../domain/models/NoteContext";
import type { SummaryResult } from "../domain/models/SummaryResult";
import type { ReasoningEffort } from "../domain/models/PluginSettings";
import {
  InvalidKeyError,
  RateLimitError,
  NetworkError,
  EmptyResponseError,
  UpstreamError,
  EmptySelectionError,
} from "../errors/ApiErrors";
import { REQUEST_TIMEOUT_MS } from "../config/constants";

export class NvidiaLLMService implements LLMPort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly reasoningEffort: ReasoningEffort,
  ) {}

  async summarize(context: NoteContext, noteBody: string): Promise<SummaryResult> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "Eres un asistente que resume notas de forma clara y estructurada en español.",
      },
      { role: "user", content: this.buildSummaryPrompt(context, noteBody) },
    ];
    const res = await this.chat(messages, { maxTokens: 2048 });
    if (!res.content.trim()) throw new EmptyResponseError("Respuesta vacía del modelo");
    return { text: res.content, reasoning: res.reasoning, model: this.model };
  }

  async explain(selection: string, context: NoteContext): Promise<SummaryResult> {
    const trimmed = selection.trim();
    if (!trimmed) throw new EmptySelectionError("Selecciona el texto que quieres explicar.");

    const messages: ChatMessage[] = [
      { role: "system", content: "Explicas fragmentos de texto de forma clara y didáctica en español." },
      {
        role: "user",
        content: `En la nota "${context.title}", explica este fragmento en detalle y con un ejemplo si aplica:\n\n"""${trimmed}"""`,
      },
    ];
    const res = await this.chat(messages, { maxTokens: 1500 });
    if (!res.content.trim()) throw new EmptyResponseError("Respuesta vacía del modelo");
    return { text: res.content, reasoning: res.reasoning, model: this.model };
  }

  async chat(messages: readonly ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const key = await this.secrets.get("NVIDIA_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu NVIDIA_API_KEY en Settings/.env");

    const body = {
      model: this.model,
      // Mapeo explícito al formato OpenAI/vLLM real (confirmado: vLLM, motor de NIM,
      // espera tool_calls / tool_call_id en snake_case, no los nombres internos camelCase).
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: tc.type, function: tc.function })) }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      temperature: 1,
      top_p: 0.95,
      max_tokens: opts.maxTokens ?? 4096,
      stream: false,
      // Campo de nivel raíz (confirmado contra docs.api.nvidia.com/nim/reference/
      // deepseek-ai-deepseek-v4-flash-infer): valores "none" | "high" | "max".
      // NO se anida en chat_template_kwargs para llamadas REST directas (eso es
      // solo la traducción interna que hace el SDK de Python con extra_body).
      reasoning_effort: this.reasoningEffort,
      ...(opts.tools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" } : {}),
    };

    let resp;
    try {
      resp = await this.withTimeout(
        requestUrl({
          url: `${this.baseUrl}/chat/completions`,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          throw: false, // manejamos los status nosotros
        }),
      );
    } catch (e) {
      if (e instanceof NetworkError) throw e; // ya viene con mensaje propio (p.ej. timeout)
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

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new NetworkError("Tiempo de espera agotado al contactar NVIDIA NIM"));
      }, REQUEST_TIMEOUT_MS);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
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
    return raw.map((t: any) => ({
      id: t.id,
      name: t.function?.name,
      argumentsJson: t.function?.arguments ?? "{}",
    }));
  }
}
