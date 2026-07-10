export class InvalidKeyError extends Error {} // 401/403 o key ausente
export class RateLimitError extends Error {} // 429
export class NetworkError extends Error {} // sin conexión / timeout
export class EmptyResponseError extends Error {} // 200 pero sin contenido
export class UpstreamError extends Error {} // 5xx u otros
export class EmptySelectionError extends Error {} // selección de texto vacía
export class PayloadTooLargeError extends Error {} // respuesta binaria excede el tope de tamaño
