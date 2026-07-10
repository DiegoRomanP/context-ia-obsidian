import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { NvidiaImageService } from "../src/services/NvidiaImageService";
import type { SecretsPort } from "../src/domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, EmptyResponseError, PayloadTooLargeError } from "../src/errors/ApiErrors";
import { MAX_IMAGE_BYTES } from "../src/config/constants";

const URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "qwen/qwen-image";

function fakeSecrets(value: string | null): SecretsPort {
  return { get: async () => value };
}

const mockRequestUrl = vi.mocked(requestUrl);

beforeEach(() => {
  mockRequestUrl.mockReset();
});

describe("NvidiaImageService.generate", () => {
  it("decodifica y valida el tamaño de la imagen en caso feliz", async () => {
    const tinyPng = Buffer.from("contenido de imagen de prueba").toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ b64_json: tinyPng }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    const result = await svc.generate("gato", "1024x1024");
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes.byteLength).toBe(Buffer.byteLength("contenido de imagen de prueba"));
  });

  it("rechaza imágenes por encima del límite de tamaño", async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1024).toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ b64_json: oversized }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("mapea 401 a InvalidKeyError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 401, json: {} } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("mapea 429 a RateLimitError", async () => {
    mockRequestUrl.mockResolvedValue({ status: 429, json: {} } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("lanza EmptyResponseError si la respuesta no trae b64_json", async () => {
    mockRequestUrl.mockResolvedValue({ status: 200, json: { data: [{}] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("lanza EmptyResponseError si el base64 decodifica a vacío", async () => {
    mockRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ b64_json: "" }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("lanza InvalidKeyError sin llamar a la red si la key está ausente", async () => {
    const svc = new NvidiaImageService(fakeSecrets(null), URL, MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(mockRequestUrl).not.toHaveBeenCalled();
  });

  it("pide response_format b64_json y el modelo configurado en el body", async () => {
    const tinyPng = Buffer.from("x").toString("base64");
    mockRequestUrl.mockResolvedValue({ status: 200, json: { data: [{ b64_json: tinyPng }] } } as any);
    const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, MODEL);
    await svc.generate("un gato", "1024x1024");

    const call = mockRequestUrl.mock.calls[0][0] as { body: string };
    const sentBody = JSON.parse(call.body);
    expect(sentBody.model).toBe(MODEL);
    expect(sentBody.response_format).toBe("b64_json");
    expect(sentBody.size).toBe("1024x1024");
  });
});
