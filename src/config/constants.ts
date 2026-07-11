export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_TEXT_MODEL = "deepseek-ai/deepseek-v4-flash";
// Generación de imagen: NVIDIA NIM se descartó por completo (qwen/qwen-image no tenía función
// cloud invocable; black-forest-labs/flux.2-klein-4b sí, pero resultó inestable/no disponible
// de forma consistente en la capa gratuita). Se reemplaza por Hugging Face Inference Providers
// (HuggingFaceImageService, vía @huggingface/inference — ver comentario en ese archivo sobre por
// qué usa el SDK oficial en vez de requestUrl). krea/Krea-2-Turbo se sirve ahí vía el proveedor fal-ai.
export const DEFAULT_IMAGE_MODEL = "krea/Krea-2-Turbo";
export const REQUEST_TIMEOUT_MS = 60_000; // requestUrl no soporta timeout nativo; se implementa con Promise.race
export const MAX_TOOL_ITERATIONS = 4; // tope del loop de tool-calling (evita runaway)
export const MAX_SEARCH_RESULTS = 5; // resultados por búsqueda en ResearchService
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB: tope antes de escribir a disco
export const MAX_INPUT_CHARS = 12_000; // truncado defensivo de nota/selección/resultados de búsqueda
export const MIN_ACTION_INTERVAL_MS = 2_000; // evita golpear la API por doble-click en un comando
