import type { NoteContext } from "../models/NoteContext";
import type { SummaryResult } from "../models/SummaryResult";

export interface ToolCallRequest {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  /** Solo en mensajes role "assistant" que piden ejecutar tools (formato OpenAI/vLLM). */
  readonly toolCalls?: readonly ToolCallRequest[];
  /** Solo en mensajes role "tool": a qué llamada responde. */
  readonly toolCallId?: string;
  /** Solo en mensajes role "tool": nombre de la función invocada. */
  readonly name?: string;
}

export interface LLMPort {
  summarize(context: NoteContext, noteBody: string): Promise<SummaryResult>;
  /** Reutiliza SummaryResult (campo text) — no crear un DTO casi idéntico (DRY). */
  explain(selection: string, context: NoteContext): Promise<SummaryResult>;
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

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}
