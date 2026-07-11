import {
  InferenceClient,
  InferenceClientHubApiError,
  InferenceClientProviderApiError,
  InferenceClientProviderOutputError,
} from "@huggingface/inference";
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

const DEFAULT_SIZE = 1024;

// Los modelos de imagen del Hub no tienen un contrato HTTP crudo estable entre proveedores
// (confirmado en la doc oficial: "the exact HTTP request may vary between providers... When
// using our official client libraries, these provider-specific differences are handled
// automatically"). Por eso este adapter usa el SDK oficial en vez de requestUrl — única
// excepción a la regla del proyecto de no usar SDKs/fetch. El riesgo de CORS que esa regla
// evita no aplica aquí: el propio playground web de Hugging Face llama a este mismo endpoint
// vía fetch desde el navegador, evidencia de que responde con headers CORS permisivos.
export class HuggingFaceImageService implements ImagePort {
  constructor(
    private readonly secrets: SecretsPort,
    private readonly model: string, // p.ej. "krea/Krea-2-Turbo"
  ) {}

  async generate(prompt: string, size: string): Promise<ImageResult> {
    const token = await this.secrets.get("HF_TOKEN");
    if (!token) throw new InvalidKeyError("Configura tu HF_TOKEN en Settings/.env");

    const { width, height } = parseSize(size);
    const client = new InferenceClient(token);

    let blob: Blob;
    try {
      blob = await client.textToImage(
        {
          model: this.model,
          provider: "auto",
          inputs: prompt,
          parameters: { width, height },
        },
        // Sin esto, la resolución de overloads de textToImage() elige la primera firma
        // declarada (outputType "url" → string) en vez de la de Blob, aunque el default
        // real del SDK sea "blob" — hay que fijarla explícitamente.
        { outputType: "blob" },
      );
    } catch (e) {
      throw mapError(e);
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0) throw new EmptyResponseError("La API no devolvió imagen");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      // SEGURIDAD: tope antes de escribir a disco (una respuesta corrupta no debe llenar el vault).
      throw new PayloadTooLargeError("La imagen excede el tamaño máximo permitido");
    }
    return { bytes, mimeType: blob.type || "image/jpeg", model: this.model };
  }
}

function mapError(e: unknown): Error {
  if (e instanceof InferenceClientProviderApiError || e instanceof InferenceClientHubApiError) {
    const status = e.httpResponse?.status;
    if (status === 401 || status === 403) return new InvalidKeyError("API key inválida o sin permisos");
    if (status === 429) return new RateLimitError("Límite alcanzado");
    if (status !== undefined && status >= 500) return new UpstreamError("Error del proveedor de inferencia");
    if (status !== undefined && status >= 400) return new UpstreamError(`HTTP ${status}`);
    return new UpstreamError(e.message);
  }
  if (e instanceof InferenceClientProviderOutputError) {
    return new EmptyResponseError("El proveedor devolvió una respuesta con formato inesperado");
  }
  return new NetworkError("Sin conexión con Hugging Face Inference Providers");
}

function parseSize(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size.trim());
  if (!m) return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
  return { width: Number(m[1]), height: Number(m[2]) };
}
