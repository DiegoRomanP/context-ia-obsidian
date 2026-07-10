import { requestUrl } from "obsidian";
import type { ImagePort } from "../domain/ports/ImagePort";
import type { ImageResult } from "../domain/models/ImageResult";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import {
  InvalidKeyError,
  RateLimitError,
  NetworkError,
  EmptyResponseError,
  UpstreamError,
  PayloadTooLargeError,
} from "../errors/ApiErrors";
import { MAX_IMAGE_BYTES } from "../config/constants";
import { base64ToBytes } from "../utils/base64";

export class NvidiaImageService implements ImagePort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate(prompt: string, size: string): Promise<ImageResult> {
    const key = await this.secrets.get("NVIDIA_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu NVIDIA_API_KEY.");

    let resp;
    try {
      resp = await requestUrl({
        url: `${this.baseUrl}/images/generations`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: this.model, prompt, size, n: 1, response_format: "b64_json" }),
        throw: false,
      });
    } catch {
      throw new NetworkError("Sin conexión con NVIDIA NIM");
    }

    if (resp.status === 401 || resp.status === 403) throw new InvalidKeyError("API key inválida");
    if (resp.status === 429) throw new RateLimitError("Límite alcanzado");
    if (resp.status >= 500) throw new UpstreamError("Error del servidor de NIM");
    if (resp.status >= 400) throw new UpstreamError(`HTTP ${resp.status}`);

    const b64 = resp.json?.data?.[0]?.b64_json;
    if (!b64) throw new EmptyResponseError("La API no devolvió imagen");

    const bytes = base64ToBytes(b64);
    if (bytes.byteLength === 0) throw new EmptyResponseError("La imagen decodificada está vacía o corrupta");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      // SEGURIDAD: tope antes de escribir a disco (una respuesta corrupta no debe llenar el vault).
      throw new PayloadTooLargeError("La imagen excede el tamaño máximo permitido");
    }
    return { bytes, mimeType: "image/png", model: this.model };
  }
}
