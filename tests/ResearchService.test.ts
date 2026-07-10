import { describe, expect, it, vi } from "vitest";
import { ResearchService } from "../src/services/ResearchService";
import type { LLMPort, ChatMessage, ChatResponse } from "../src/domain/ports/LLMPort";
import type { SearchPort, SearchHit } from "../src/domain/ports/SearchPort";
import { InvalidKeyError } from "../src/errors/ApiErrors";
import { MAX_TOOL_ITERATIONS } from "../src/config/constants";

function fakeLLM(responses: ChatResponse[]): LLMPort {
  let i = 0;
  return {
    summarize: vi.fn(),
    explain: vi.fn(),
    chat: vi.fn(async (): Promise<ChatResponse> => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    }),
  };
}

function fakeSearch(hits: readonly SearchHit[]): SearchPort {
  return { search: vi.fn(async () => hits) };
}

describe("ResearchService", () => {
  it("hace una búsqueda y adjunta citas", async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "web_search", argumentsJson: '{"query":"x"}' }] },
      { content: "respuesta [1]", toolCalls: [] },
    ]);
    const search = fakeSearch([{ title: "T", url: "http://a", content: "c" }]);
    const out = await new ResearchService(llm, search).research("tema");
    expect(out.citations[0].url).toBe("http://a");
    expect(out.answer).toContain("respuesta");
  });

  it("respeta el tope de iteraciones (no bucle infinito)", async () => {
    // Siempre pide la tool ⇒ nunca "termina solo"; debe forzar una síntesis final tras el tope.
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "web_search", argumentsJson: '{"query":"x"}' }] },
    ]);
    const search = fakeSearch([{ title: "T", url: "http://a", content: "c" }]);
    await new ResearchService(llm, search).research("tema");
    // MAX_TOOL_ITERATIONS llamadas del loop + 1 llamada final de síntesis.
    expect(llm.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
  });

  it("maneja una búsqueda sin resultados (citations vacío)", async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "web_search", argumentsJson: '{"query":"x"}' }] },
      { content: "No encontré fuentes fiables.", toolCalls: [] },
    ]);
    const search = fakeSearch([]);
    const out = await new ResearchService(llm, search).research("tema oscuro");
    expect(out.citations).toEqual([]);
    expect(out.answer).toContain("No encontré");
  });

  it("omite la tool y no llama a search si argumentsJson es JSON inválido", async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "web_search", argumentsJson: "no es json" }] },
      { content: "respuesta sin fuentes", toolCalls: [] },
    ]);
    const search = fakeSearch([{ title: "T", url: "http://a", content: "c" }]);
    const out = await new ResearchService(llm, search).research("tema");
    expect(search.search).not.toHaveBeenCalled();
    expect(out.citations).toEqual([]);
  });

  it("ignora tool_calls de herramientas no soportadas", async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "otra_tool", argumentsJson: "{}" }] },
      { content: "respuesta", toolCalls: [] },
    ]);
    const search = fakeSearch([]);
    const out = await new ResearchService(llm, search).research("tema");
    expect(search.search).not.toHaveBeenCalled();
    expect(out.answer).toBe("respuesta");
  });

  it('reenvía el resultado de la tool con role "tool" y el tool_call_id correcto', async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "call-123", name: "web_search", argumentsJson: '{"query":"x"}' }] },
      { content: "ok", toolCalls: [] },
    ]);
    const search = fakeSearch([{ title: "T", url: "http://a", content: "c" }]);
    await new ResearchService(llm, search).research("tema");

    const secondCallMessages = vi.mocked(llm.chat).mock.calls[1][0] as readonly ChatMessage[];
    const toolMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolMsg?.toolCallId).toBe("call-123");
    expect(toolMsg?.name).toBe("web_search");

    const assistantMsg = secondCallMessages.find((m) => m.role === "assistant" && m.toolCalls);
    expect(assistantMsg?.toolCalls?.[0]).toEqual({
      id: "call-123",
      type: "function",
      function: { name: "web_search", arguments: '{"query":"x"}' },
    });
  });

  it("propaga errores del SearchPort sin capturarlos (p.ej. TAVILY_API_KEY ausente)", async () => {
    const llm = fakeLLM([
      { content: "", toolCalls: [{ id: "1", name: "web_search", argumentsJson: '{"query":"x"}' }] },
    ]);
    const search: SearchPort = {
      search: vi.fn(async () => {
        throw new InvalidKeyError("sin clave");
      }),
    };
    await expect(new ResearchService(llm, search).research("tema")).rejects.toBeInstanceOf(InvalidKeyError);
  });
});
