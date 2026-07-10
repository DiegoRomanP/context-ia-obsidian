export interface TruncateResult {
  readonly text: string;
  readonly truncated: boolean;
}

/** Recorta el texto a maxChars como protección defensiva de contexto/coste. */
export function truncateText(text: string, maxChars: number): TruncateResult {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
