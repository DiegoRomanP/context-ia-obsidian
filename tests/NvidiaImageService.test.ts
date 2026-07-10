import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { NvidiaImageService } from "../src/services/NvidiaImageService";
import type { SecretsPort } from "../src/domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, EmptyResponseError, PayloadTooLargeError } from "../src/errors/ApiErrors";
import { MAX_IMAGE_BYTES } from "../src/config/constants";

const BASE_URL = "https://ai.api.nvidia.com/v1/genai";
const MODEL = "black-forest-labs/flux.2-klein-4b";

function fakeSecrets(value: string | null): SecretsPort {
  return { get: async () => value };
}

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
  mockRequestUrl.mockReset();
});

describe("NvidiaImageService.generate", () => {
  it("decodifica y valida el tamaño de la imagen en caso feliz", async () => {
    const tinyImage = Buffer.from("contenido de imagen de prueba").toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{ base64: tinyImage }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    const result = await svc.generate("gato", "1024x1024");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBe(Buffer.byteLength("contenido de imagen de prueba"));
  });

  it("rechaza imágenes por encima del límite de tamaño", async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1024).toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{ base64: oversized }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("mapea 401 a InvalidKeyError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 401, json: {} } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("mapea 429 a RateLimitError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 429, json: {} } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("lanza EmptyResponseError si la respuesta no trae artifacts[].base64", async () => {
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{}] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("lanza EmptyResponseError si el base64 decodifica a vacío", async () => {
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{ base64: "" }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("lanza InvalidKeyError sin llamar a la red si la key está ausente", async () => {
    const svc = new NvidiaImageService(fakeSecrets(null), BASE_URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it("construye la URL con el namespace/modelo y envía el formato nativo (prompt/width/height)", async () => {
    const tinyImage = Buffer.from("x").toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{ base64: tinyImage }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await svc.generate("un gato", "1024x1024");

    const call = mockRequestUrl.mock.calls[0][0] as { url: string; body: string };
    expect(call.url).toBe(`${BASE_URL}/${MODEL}`);
    const sentBody = JSON.parse(call.body);
    expect(sentBody.prompt).toBe("un gato");
    expect(sentBody.width).toBe(1024);
    expect(sentBody.height).toBe(1024);
    expect(typeof sentBody.seed).toBe("number");
    expect(typeof sentBody.steps).toBe("number");
    // Campos del formato OpenAI que NO deben enviarse (no es lo que espera esta API):
    expect(sentBody.model).toBeUndefined();
    expect(sentBody.response_format).toBeUndefined();
    expect(sentBody.size).toBeUndefined();
    expect(sentBody.n).toBeUndefined();
  });

  it("usa un tamaño por defecto si el string 'size' no tiene el formato WxH", async () => {
    const tinyImage = Buffer.from("x").toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { artifacts: [{ base64: tinyImage }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), BASE_URL, MODEL);
    await svc.generate("un gato", "tamaño-invalido");

    const call = mockRequestUrl.mock.calls[0][0] as { body: string };
    const sentBody = JSON.parse(call.body);
    expect(sentBody.width).toBe(1024);
    expect(sentBody.height).toBe(1024);
  });
});
