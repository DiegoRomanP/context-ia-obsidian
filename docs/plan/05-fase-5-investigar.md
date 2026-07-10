# Fase 5 — Investigar temas (búsqueda real + citas)

> **IA:** ✅ `deepseek-v4-flash` con **tool/function calling** (soportado por DeepSeek-V4) + una API de
> **búsqueda web** real. El `plan.md` exige: *"Requiere una API con búsqueda real, no solo el LLM (para evitar
> alucinar fuentes)"* y *"mostrar resultados con fuente citada"*. Esto es exactamente un **loop de tool-calling**.

---

## 1. Objetivo
Responder una pregunta de investigación con información **verificable**: el modelo decide cuándo buscar,
un `SearchPort` real trae fuentes, y la respuesta final **cita** esas fuentes (URLs). Sin fuentes alucinadas.

## 2. Definition of Ready
- Fase 3 "Done" (`chat()` con soporte de `tools`/`toolCalls` ya existe en `LLMPort`).
- Una API de búsqueda con clave. **Decisión:** `SearchPort` con `TavilySearchService` por defecto (free tier,
  pensado para RAG, devuelve `content` + `url`). Alternativas pluggables: Brave Search API, SearXNG self-host.
  ⚠️ Requiere un `TAVILY_API_KEY` gratuito en el `.env` (además del de NVIDIA).

## 3. Alcance
**In:** `SearchPort` + `TavilySearchService`, `ResearchService` (orquesta el loop), DTOs `ResearchResult`/
`ResearchCitation`, definición de la tool `web_search`, comando "Investigar tema", render con citas.
**Out:** persistir el reporte en la nota (opcional, se puede añadir en Fase 7); imagen.

## 4. Diseño técnico

### 4.1 DTOs — `src/domain/models/ResearchResult.ts`
```ts
export interface ResearchCitation {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}
export interface ResearchResult {
  readonly answer: string;                       // síntesis del modelo
  readonly citations: readonly ResearchCitation[]; // fuentes reales usadas
}
```

### 4.2 Puerto de búsqueda — `src/domain/ports/SearchPort.ts`
```ts
export interface SearchHit { readonly title: string; readonly url: string; readonly content: string; }
export interface SearchPort {
  search(query: string, maxResults: number): Promise<readonly SearchHit[]>;
}
```

### 4.3 Adapter — `src/services/TavilySearchService.ts` (vía `requestUrl`)
```ts
import { requestUrl } from "obsidian";
import type { SearchPort, SearchHit } from "../domain/ports/SearchPort";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, NetworkError, UpstreamError } from "../errors/ApiErrors";

export class TavilySearchService implements SearchPort {
  constructor(private readonly secrets: SecretsPort, private readonly endpoint = "https://api.tavily.com/search") {}

  async search(query: string, maxResults: number): Promise<readonly SearchHit[]> {
    const key = await this.secrets.get("TAVILY_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu TAVILY_API_KEY para investigar.");
    let resp;
    try {
      resp = await requestUrl({
        url: this.endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: maxResults, search_depth: "basic" }),
        throw: false,
      });
    } catch { throw new NetworkError("Sin conexión con la API de búsqueda"); }
    if (resp.status === 401) throw new InvalidKeyError("Clave de búsqueda inválida");
    if (resp.status === 429) throw new RateLimitError("Límite de búsquedas alcanzado");
    if (resp.status >= 400) throw new UpstreamError(`Búsqueda falló (HTTP ${resp.status})`);
    return (resp.json?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, content: r.content }));
  }
}
```
> ⚠️ **Verificar al construir:** forma exacta del request/response de Tavily (campo `api_key` en body vs header
> `Authorization`). Encapsulado ⇒ cambio en un solo archivo.

### 4.4 Definición de la tool `web_search` (formato OpenAI/NIM)
```ts
// src/config/tools.ts
export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Busca en la web información actual y devuelve fuentes con URL.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Consulta de búsqueda" } },
      required: ["query"],
    },
  },
} as const;
```

### 4.5 Orquestador — `src/services/ResearchService.ts` (loop acotado)
```ts
import type { LLMPort, ChatMessage } from "../domain/ports/LLMPort";
import type { SearchPort } from "../domain/ports/SearchPort";
import type { ResearchResult, ResearchCitation } from "../domain/models/ResearchResult";
import { WEB_SEARCH_TOOL } from "../config/tools";
import { MAX_TOOL_ITERATIONS, MAX_SEARCH_RESULTS } from "../config/constants";

export class ResearchService {
  constructor(private readonly llm: LLMPort, private readonly search: SearchPort) {}

  async research(topic: string): Promise<ResearchResult> {
    const citations: ResearchCitation[] = [];
    const messages: ChatMessage[] = [
      { role: "system", content:
        "Investigas temas usando la herramienta web_search. Cita SIEMPRE las fuentes (URL) que uses. " +
        "Si no encuentras fuentes fiables, dilo; NO inventes URLs." },
      { role: "user", content: `Investiga: ${topic}` },
    ];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) { // loop ACOTADO: evita runaway
      const res = await this.llm.chat(messages, { tools: [WEB_SEARCH_TOOL], toolChoice: "auto" });

      if (!res.toolCalls?.length) {
        return { answer: res.content, citations }; // el modelo terminó
      }
      for (const call of res.toolCalls) {
        if (call.name !== "web_search") continue;
        const query = safeParseQuery(call.argumentsJson);
        const hits = await this.search.search(query, MAX_SEARCH_RESULTS);
        hits.forEach((h) => citations.push({ title: h.title, url: h.url, snippet: h.content.slice(0, 240) }));
        // Devolver el resultado de la tool al modelo:
        messages.push({ role: "assistant", content: `[tool_call ${call.id}: web_search(${query})]` });
        messages.push({ role: "assistant", content: this.formatHits(hits) }); // rol tool según acepte NIM
      }
    }
    // Se agotaron las iteraciones: pedir síntesis final con lo recabado.
    const final = await this.llm.chat([...messages,
      { role: "user", content: "Sintetiza ahora la respuesta citando SOLO las fuentes anteriores." }]);
    return { answer: final.content, citations };
  }

  private formatHits(hits: readonly { title: string; url: string; content: string }[]): string {
    return hits.map((h, i) => `(${i + 1}) ${h.title} — ${h.url}\n${h.content}`).join("\n\n");
  }
}
```
> ⚠️ **Verificar al construir:** el rol correcto para devolver el resultado de la tool en NIM (OpenAI usa
> `role: "tool"` con `tool_call_id`). Ajustar `messages.push` a esa forma; encapsulado en este servicio.

### 4.6 Render con citas
`ResultModal` muestra `answer` + una lista de citas (`title` como enlace a `url`). **Nunca** insertar texto
sin marcar el origen (requisito del `plan.md`).

## 5. Pasos numerados
1. DTOs `ResearchResult`/`ResearchCitation`; `SearchPort`.
2. `TavilySearchService`.
3. `tools.ts` (definición `web_search`); constantes `MAX_TOOL_ITERATIONS`, `MAX_SEARCH_RESULTS`.
4. `ResearchService` (loop acotado).
5. Comando "Investigar tema" (input por `Modal` con campo de texto) + render con citas.
6. Tests con `LLMPort` y `SearchPort` mockeados.

## 6. Frameworks / librerías
API de Obsidian (`requestUrl`, `Modal`) + una API de búsqueda (Tavily/Brave/SearXNG). Sin SDK propietario.

## 7. Seguridad (de esta fase)
- Segunda credencial (`TAVILY_API_KEY`) por el **mismo** `SecretsPort` (mismas reglas anti-fuga).
- Loop **acotado** (`MAX_TOOL_ITERATIONS`, `MAX_SEARCH_RESULTS`) ⇒ evita bucles infinitos y consumo runaway.
- No se ejecuta código devuelto por el modelo; la única "tool" es una búsqueda de sólo lectura.
- Se muestran fuentes verificables; el system prompt prohíbe inventar URLs.

## 8. Manejo de errores / edge cases
- Sin `TAVILY_API_KEY` → `InvalidKeyError` → `Notice` claro.
- Búsqueda sin resultados → el modelo debe declararlo; `citations` vacío mostrado como "sin fuentes fiables".
- `argumentsJson` malformado → `safeParseQuery` cae a string vacío / se salta la tool.
- El modelo no llama a la tool → devuelve respuesta directa (sin citas) marcada como "sin verificar".

## 9. Tests (Vitest)
```ts
it("hace una búsqueda y adjunta citas", async () => {
  const llm = fakeLLM([
    { toolCalls: [{ id: "1", name: "web_search", argumentsJson: '{"query":"x"}' }] }, // 1ª llamada pide tool
    { content: "respuesta [1]", toolCalls: [] },                                       // 2ª sintetiza
  ]);
  const search = { search: async () => [{ title: "T", url: "http://a", content: "c" }] };
  const out = await new ResearchService(llm, search).research("tema");
  expect(out.citations[0].url).toBe("http://a");
  expect(out.answer).toContain("respuesta");
});
it("respeta el tope de iteraciones", async () => { /* siempre devuelve toolCalls ⇒ termina con síntesis */ });
```
**Casos borde:** sin resultados, JSON de args malformado, tope de iteraciones, sin clave de búsqueda.

## 10. CI para la fase
Tests en `ci.yml`. Sin llamadas de red reales en tests (todo mockeado).

## 11. Definition of Done
- [ ] "Investigar tema" devuelve respuesta **con fuentes citadas** (URLs reales, clicables).
- [ ] Con una consulta de prueba, las fuentes citadas existen y son verificables (revisión manual de 3-4).
- [ ] Loop acotado comprobado (no bucle infinito).
- [ ] Tests verdes (incl. casos borde).

## 12. Validación manual (del `plan.md`)
> "Verificar manualmente que 3-4 respuestas de prueba realmente citan fuentes verificables."

## 13. Commit / PR sugerido
```
feat(ai): acción Investigar con tool-calling + búsqueda web (citas)

- SearchPort + TavilySearchService; tool web_search; ResearchService (loop acotado).
- ResearchResult con citas verificables; system prompt anti-alucinación.
- Tests con LLM/Search mockeados (búsqueda, sin resultados, tope de iteraciones).
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| Formato de tool-result de NIM difiere de OpenAI | ⚠️ Verificar `role: "tool"` + `tool_call_id`; encapsulado en `ResearchService`. |
| Free tier de búsqueda agotado | `SearchPort` permite cambiar a Brave/SearXNG en un archivo. |
| Modelo ignora la tool | System prompt fuerte + marcar respuesta como "sin verificar" si no hay citas. |
| Coste/latencia por iteraciones | Topes en `constants.ts`; `search_depth: "basic"`. |
