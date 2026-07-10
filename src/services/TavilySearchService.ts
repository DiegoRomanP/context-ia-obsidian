import { requestUrl } from "obsidian";
import type { SearchPort, SearchHit } from "../domain/ports/SearchPort";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, NetworkError, UpstreamError } from "../errors/ApiErrors";

export class TavilySearchService implements SearchPort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly endpoint = "https://api.tavily.com/search",
  ) {}

  async search(query: string, maxResults: number): Promise<readonly SearchHit[]> {
    const key = await this.secrets.get("TAVILY_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu TAVILY_API_KEY para investigar.");

    let resp;
    try {
      resp = await requestUrl({
        url: this.endpoint,
        method: "POST",
        // Confirmado contra docs.tavily.com: autenticación por header Authorization
        // Bearer, NO por campo api_key en el body (así lo asumía el diseño original).
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
        throw: false,
      });
    } catch {
      throw new NetworkError("Sin conexión con la API de búsqueda");
    }

    if (resp.status === 401 || resp.status === 403) throw new InvalidKeyError("Clave de búsqueda inválida");
    if (resp.status === 429) throw new RateLimitError("Límite de búsquedas alcanzado");
    if (resp.status >= 400) throw new UpstreamError(`Búsqueda falló (HTTP ${resp.status})`);

    return (resp.json?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, content: r.content }));
  }
}
