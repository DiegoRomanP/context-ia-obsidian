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

const DEFAULT_STEPS = 4; // flux.2-klein-4b es un modelo "turbo": pocos steps por diseño
const DEFAULT_SIZE = 1024;

export class NvidiaImageService implements ImagePort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly baseUrl: string, // host "genai" (ai.api.nvidia.com/v1/genai), NO el de chat/completions
    private readonly model: string, // incluye el namespace, p.ej. "black-forest-labs/flux.2-klein-4b"
  ) {}

  async generate(prompt: string, size: string): Promise<ImageResult> {
    const key = await this.secrets.get("NVIDIA_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu NVIDIA_API_KEY.");

    const { width, height } = parseSize(size);

    let resp;
    try {
      resp = await requestUrl({
        // Formato NATIVO de NVIDIA Visual GenAI (confirmado contra la API real): NO es
        // OpenAI-compatible. El path incluye el namespace/modelo; el body usa
        // prompt/width/height/seed/steps, no size/n/response_format.
        url: `${this.baseUrl}/${this.model}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          prompt,
          width,
          height,
          seed: Math.floor(Math.random() * 2 ** 31),
          steps: DEFAULT_STEPS,
        }),
        throw: false,
      });
    } catch {
      throw new NetworkError("Sin conexión con NVIDIA NIM");
    }

    if (resp.status === 401 || resp.status === 403) throw new InvalidKeyError("API key inválida");
    if (resp.status === 429) throw new RateLimitError("Límite alcanzado");
    if (resp.status >= 500) throw new UpstreamError("Error del servidor de NIM");
    if (resp.status >= 400) throw new UpstreamError(`HTTP ${resp.status}`);

    const b64 = resp.json?.artifacts?.[0]?.base64;
    if (!b64) throw new EmptyResponseError("La API no devolvió imagen");

    const bytes = base64ToBytes(b64);
    if (bytes.byteLength === 0) throw new EmptyResponseError("La imagen decodificada está vacía o corrupta");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      // SEGURIDAD: tope antes de escribir a disco (una respuesta corrupta no debe llenar el vault).
      throw new PayloadTooLargeError("La imagen excede el tamaño máximo permitido");
    }
    // La API devuelve JPEG (confirmado por la firma real del base64), no PNG.
    return { bytes, mimeType: "image/jpeg", model: this.model };
  }
}

function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
  return { width: Number(m[1]), height: Number(m[2]) };
}
