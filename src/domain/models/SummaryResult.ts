export interface SummaryResult {
  readonly text: string; // resumen final
  readonly reasoning?: string; // reasoning_content (opcional, para depurar)
  readonly model: string;
  readonly truncated?: boolean; // true si el input se recortó (Fase 7: truncado defensivo)
}
