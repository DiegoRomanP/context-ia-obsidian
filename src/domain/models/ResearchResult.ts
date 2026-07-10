export interface ResearchCitation {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface ResearchResult {
  readonly answer: string; // síntesis del modelo
  readonly citations: readonly ResearchCitation[]; // fuentes reales usadas
  readonly truncated?: boolean; // true si algún resultado de búsqueda se recortó (Fase 7)
}
