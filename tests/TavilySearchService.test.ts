import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { TavilySearchService } from "../src/services/TavilySearchService";
import type { SecretsPort } from "../src/domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, UpstreamError } from "../src/errors/ApiErrors";

function fakeSecrets(value: string | null): SecretsPort {
  return { get: async () => value };
}

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
  mockRequestUrl.mockReset();
});

describe("TavilySearchService", () => {
  it("lanza InvalidKeyError sin llamar a la red si la key está ausente", async () => {
    const svc = new TavilySearchService(fakeSecrets(null));
    await expect(svc.search("tema", 5)).rejects.toBeInstanceOf(InvalidKeyError);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it("mapea 401 a InvalidKeyError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 401, json: {} } as any);
    const svc = new TavilySearchService(fakeSecrets("tvly-x"));
    await expect(svc.search("tema", 5)).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("mapea 429 a RateLimitError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 429, json: {} } as any);
    const svc = new TavilySearchService(fakeSecrets("tvly-x"));
    await expect(svc.search("tema", 5)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("mapea 500 a UpstreamError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 500, json: {} } as any);
    const svc = new TavilySearchService(fakeSecrets("tvly-x"));
    await expect(svc.search("tema", 5)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("devuelve los resultados parseados en caso feliz", async () => {
    mockRequestUrl.mockResolvedValue({
      status: 200,
      json: { results: [{ title: "T", url: "http://a", content: "c" }] },
    } as any);
    const svc = new TavilySearchService(fakeSecrets("tvly-x"));
    const hits = await svc.search("tema", 5);
    expect(hits).toEqual([{ title: "T", url: "http://a", content: "c" }]);
  });

  it("envía la clave por header Authorization Bearer, no en el body", async () => {
    mockRequestUrl.mockResolvedValue({ status: 200, json: { results: [] } } as any);
    const svc = new TavilySearchService(fakeSecrets("tvly-secreta"));
    await svc.search("tema", 5);

    const call = mockRequestUrl.mock.calls[0][0] as { headers: Record<string, string>; body: string };
    expect(call.headers.Authorization).toBe("Bearer tvly-secreta");
    const sentBody = JSON.parse(call.body);
    expect(sentBody.api_key).toBeUndefined();
    expect(sentBody.query).toBe("tema");
  });
});
