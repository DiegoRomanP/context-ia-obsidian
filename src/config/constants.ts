export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_TEXT_MODEL = "deepseek-ai/deepseek-v4-flash";
// Host DISTINTO al de chat/completions: los modelos de imagen "Visual GenAI" de NVIDIA se
// invocan vía ai.api.nvidia.com/v1/genai/{namespace}/{modelo} (formato nativo, no OpenAI-compatible),
// confirmado contra la API real. "qwen/qwen-image" se descartó: no tiene función cloud invocable
// (nvcfFunctionId: "None" en el catálogo, solo disponible para self-host del contenedor NIM).
export const DEFAULT_IMAGE_BASE_URL = "https://ai.api.nvidia.com/v1/genai";
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b";
export const REQUEST_TIMEOUT_MS = 60_000; // requestUrl no soporta timeout nativo; se implementa con Promise.race
export const MAX_TOOL_ITERATIONS = 4; // tope del loop de tool-calling (evita runaway)
export const MAX_SEARCH_RESULTS = 5; // resultados por búsqueda en ResearchService
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB: tope antes de escribir a disco
export const MAX_INPUT_CHARS = 12_000; // truncado defensivo de nota/selección/resultados de búsqueda
export const MIN_ACTION_INTERVAL_MS = 2_000; // evita golpear la API por doble-click en un comando
