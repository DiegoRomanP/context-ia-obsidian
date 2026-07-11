import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InferenceClientProviderApiError,
  InferenceClientProviderOutputError,
} from "@huggingface/inference";
import { HuggingFaceImageService } from "../src/services/HuggingFaceImageService";
import type { SecretsPort } from "../src/domain/ports/SecretsPort";
import {
  InvalidKeyError,
  RateLimitError,
  EmptyResponseError,
  PayloadTooLargeError,
  NetworkError,
  UpstreamError,
} from "../src/errors/ApiErrors";
import { MAX_IMAGE_BYTES } from "../src/config/constants";

const textToImageMock = vi.fn();

vi.mock("@huggingface/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@huggingface/inference")>();
  return {
    ...actual,
    InferenceClient: vi.fn().mockImplementation(() => ({ textToImage: textToImageMock })),
  };
});

const MODEL = "krea/Krea-2-Turbo";

function fakeSecrets(value: string | null): SecretsPort {
  return { get: async () => value };
}

function blobOf(bytes: Uint8Array, type = "image/jpeg"): Blob {
  return new Blob([bytes as BlobPart], { type });
}

function providerError(status: number): InferenceClientProviderApiError {
  return new InferenceClientProviderApiError(
    "error del proveedor",
    { url: "https://router.huggingface.co/fal-ai/krea-2/turbo", method: "POST" },
    { requestId: "req-1", status, body: {} },
  );
}

beforeEach(() => {
  textToImageMock.mockReset();
});

describe("HuggingFaceImageService.generate", () => {
  it("decodifica la imagen y usa el mimeType real del blob en caso feliz", async () => {
    const bytes = new TextEncoder().encode("contenido de imagen de prueba");
    textToImageMock.mockResolvedValue(blobOf(bytes, "image/jpeg"));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    const result = await svc.generate("gato", "1024x1024");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBe(bytes.byteLength);
    expect(result.model).toBe(MODEL);
  });

  it("rechaza imágenes por encima del límite de tamaño", async () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1024);
    textToImageMock.mockResolvedValue(blobOf(oversized));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("lanza EmptyResponseError si el blob está vacío", async () => {
    textToImageMock.mockResolvedValue(blobOf(new Uint8Array(0)));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("lanza InvalidKeyError sin llamar al SDK si el HF_TOKEN está ausente", async () => {
    const svc = new HuggingFaceImageService(fakeSecrets(null), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(textToImageMock).not.toHaveBeenCalled();
  });

  it("mapea InferenceClientProviderApiError 401 a InvalidKeyError", async () => {
    textToImageMock.mockRejectedValue(providerError(401));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it("mapea InferenceClientProviderApiError 429 a RateLimitError", async () => {
    textToImageMock.mockRejectedValue(providerError(429));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("mapea InferenceClientProviderApiError 5xx a UpstreamError", async () => {
    textToImageMock.mockRejectedValue(providerError(503));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("mapea InferenceClientProviderOutputError a EmptyResponseError", async () => {
    textToImageMock.mockRejectedValue(new InferenceClientProviderOutputError("formato inesperado"));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it("mapea errores no reconocidos (p.ej. de red) a NetworkError", async () => {
    textToImageMock.mockRejectedValue(new TypeError("fetch failed"));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await expect(svc.generate("gato", "1024x1024")).rejects.toBeInstanceOf(NetworkError);
  });

  it("envía el modelo, el prompt y el ancho/alto correctos al SDK", async () => {
    textToImageMock.mockResolvedValue(blobOf(new TextEncoder().encode("x")));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await svc.generate("un gato", "512x768");

    expect(textToImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL,
        provider: "auto",
        inputs: "un gato",
        parameters: { width: 512, height: 768 },
      }),
      expect.objectContaining({ outputType: "blob" }),
    );
  });

  it("usa un tamaño por defecto si el string 'size' no tiene el formato WxH", async () => {
    textToImageMock.mockResolvedValue(blobOf(new TextEncoder().encode("x")));
    const svc = new HuggingFaceImageService(fakeSecrets("hf_x"), MODEL);
    await svc.generate("un gato", "tamaño-invalido");

    expect(textToImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: { width: 1024, height: 1024 } }),
      expect.anything(),
    );
  });
});
