import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { NvidiaLLMService } from "../src/services/NvidiaLLMService";
import type { SecretsPort } from "../src/domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, UpstreamError, EmptyResponseError } from "../src/errors/ApiErrors";

const URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "deepseek-ai/deepseek-v4-flash";

function fakeSecrets(value: string | null): SecretsPort {
  return { get: async () => value };
}

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
  mockRequestUrl.mockReset();
});

describe("NvidiaLLMService.chat", () => {
  it("mapea 401 a InvalidKeyError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 401, json: {} } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
    await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("mapea 429 a RateLimitError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 429, json: {} } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
    await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(RateLimitError);
  });

  it("mapea 500 a UpstreamError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 500, json: {} } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
    await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(UpstreamError);
  });

  it("devuelve el contenido en caso feliz", async () => {
    mockRequestUrl.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "resumen" } }] },
    } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
    expect((await svc.chat([{ role: "user", content: "x" }])).content).toBe("resumen");
  });

  it("lanza InvalidKeyError sin llamar a la red si la key está ausente", async () => {
    const svc = new NvidiaLLMService(fakeSecrets(null), URL, MODEL, "high");
    await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(InvalidKeyError);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it("envía reasoning_effort en el nivel raíz del body, sin chat_template_kwargs", async () => {
    mockRequestUrl.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "ok" } }] },
    } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "max");
    await svc.chat([{ role: "user", content: "x" }]);

    const call = mockRequestUrl.mock.calls[0][0] as { body: string };
    const sentBody = JSON.parse(call.body);
    expect(sentBody.reasoning_effort).toBe("max");
    expect(sentBody.chat_template_kwargs).toBeUndefined();
    expect(sentBody.thinking).toBeUndefined();
  });

  it("nunca incluye la API key en el mensaje de error de red", async () => {
    mockRequestUrl.mockRejectedValue(new Error("network down"));
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-secreta-123"), URL, MODEL, "high");
    await expect(svc.chat([{ role: "user", content: "x" }])).rejects.toThrow(
      expect.not.stringContaining("nvapi-secreta-123"),
    );
  });
});

describe("NvidiaLLMService.summarize", () => {
  it("lanza EmptyResponseError si el modelo no devuelve contenido", async () => {
    mockRequestUrl.mockResolvedValue({
      status: 200,
      json: { choices: [{ message: { content: "" } }] },
    } as any);
    const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
    const ctx = {
      path: "A.md",
      title: "A",
      outgoingLinks: [],
      backlinks: [],
      headings: [],
      wordCount: 0,
    };
    await expect(svc.summarize(ctx, "")).rejects.toBeInstanceOf(EmptyResponseError);
  });
});
