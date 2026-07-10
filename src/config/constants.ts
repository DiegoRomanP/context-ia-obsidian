export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_TEXT_MODEL = "deepseek-ai/deepseek-v4-flash";
// Namespace real del catálogo alojado de NVIDIA (confirmado: build.nvidia.com/qwen/qwen-image),
// igual patrón que deepseek-ai/deepseek-v4-flash. "qwen-image" a secas (sin namespace) no es el ID real.
export const DEFAULT_IMAGE_MODEL = "qwen/qwen-image";
export const REQUEST_TIMEOUT_MS = 60_000; // requestUrl no soporta timeout nativo; se implementa con Promise.race
export const MAX_TOOL_ITERATIONS = 4; // tope del loop de tool-calling (evita runaway)
export const MAX_SEARCH_RESULTS = 5; // resultados por búsqueda en ResearchService
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB: tope antes de escribir a disco
export const MAX_INPUT_CHARS = 12_000; // truncado defensivo de nota/selección/resultados de búsqueda
export const MIN_ACTION_INTERVAL_MS = 2_000; // evita golpear la API por doble-click en un comando
