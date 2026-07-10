import type { LLMPort, ChatMessage } from "../domain/ports/LLMPort";
import type { SearchPort, SearchHit } from "../domain/ports/SearchPort";
import type { ResearchResult, ResearchCitation } from "../domain/models/ResearchResult";
import { WEB_SEARCH_TOOL } from "../config/tools";
import { MAX_TOOL_ITERATIONS, MAX_SEARCH_RESULTS, MAX_INPUT_CHARS } from "../config/constants";
import { truncateText } from "../utils/truncate";

export class ResearchService {
  constructor(
    private readonly llm: LLMPort,
    private readonly search: SearchPort,
  ) {}

  async research(topic: string): Promise<ResearchResult> {
    const citations: ResearchCitation[] = [];
    let truncated = false;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "Investigas temas usando la herramienta web_search. Cita SIEMPRE las fuentes (URL) que uses. " +
          "Si no encuentras fuentes fiables, dilo; NO inventes URLs.",
      },
      { role: "user", content: `Investiga: ${topic}` },
    ];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // loop ACOTADO: evita runaway
      const res = await this.llm.chat(messages, { tools: [WEB_SEARCH_TOOL], toolChoice: "auto" });

      if (!res.toolCalls?.length) {
        return { answer: res.content, citations, truncated }; // el modelo terminó
      }

      // Turno del asistente pidiendo las tools (formato OpenAI/vLLM real: tool_calls + luego role "tool").
      messages.push({
        role: "assistant",
        content: res.content || null,
        toolCalls: res.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      });

      for (const call of res.toolCalls) {
        if (call.name !== "web_search") {
          messages.push({ role: "tool", content: "Herramienta no soportada.", toolCallId: call.id, name: call.name });
          continue;
        }
        const query = safeParseQuery(call.argumentsJson);
        if (!query) {
          messages.push({ role: "tool", content: "Consulta inválida, omitida.", toolCallId: call.id, name: call.name });
          continue;
        }
        const hits = await this.search.search(query, MAX_SEARCH_RESULTS);
        // Truncado defensivo: un snippet de búsqueda extremadamente largo no debe exceder el contexto.
        const processedHits = hits.map((h) => {
          const { text, truncated: wasTruncated } = truncateText(h.content, MAX_INPUT_CHARS);
          if (wasTruncated) truncated = true;
          return { ...h, content: text };
        });
        processedHits.forEach((h) => citations.push({ title: h.title, url: h.url, snippet: h.content.slice(0, 240) }));
        messages.push({
          role: "tool",
          content: this.formatHits(processedHits),
          toolCallId: call.id,
          name: call.name,
        });
      }
    }

    // Se agotaron las iteraciones: pedir síntesis final con lo recabado.
    const final = await this.llm.chat([
      ...messages,
      { role: "user", content: "Sintetiza ahora la respuesta citando SOLO las fuentes anteriores." },
    ]);
    return { answer: final.content, citations, truncated };
  }

  private formatHits(hits: readonly SearchHit[]): string {
    if (hits.length === 0) return "Sin resultados para esta búsqueda.";
    return hits.map((h, i) => `(${i + 1}) ${h.title} — ${h.url}\n${h.content}`).join("\n\n");
  }
}

function safeParseQuery(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson);
    return typeof parsed?.query === "string" ? parsed.query : "";
  } catch {
    return "";
  }
}
