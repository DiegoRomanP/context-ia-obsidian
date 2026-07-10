import type { NoteContext } from "../models/NoteContext";
import type { SummaryResult } from "../models/SummaryResult";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

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

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}
