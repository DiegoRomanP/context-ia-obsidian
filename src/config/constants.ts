export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_TEXT_MODEL = "deepseek-ai/deepseek-v4-flash";
export const DEFAULT_IMAGE_MODEL = "qwen-image";
export const REQUEST_TIMEOUT_MS = 60_000; // requestUrl no soporta timeout nativo; se implementa con Promise.race
