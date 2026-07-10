export interface Relationship {
  readonly path: string; // ruta de la nota relacionada
  readonly title: string; // basename sin extensión
}

export interface Heading {
  readonly level: number; // 1..6
  readonly text: string;
}

export interface NoteContext {
  readonly path: string;
  readonly title: string;
  readonly outgoingLinks: readonly Relationship[]; // links salientes resueltos
  readonly backlinks: readonly Relationship[]; // notas que enlazan a esta
  readonly headings: readonly Heading[];
  readonly wordCount: number;
}
