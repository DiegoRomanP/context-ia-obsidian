import type { NoteContext } from "../models/NoteContext";

export interface VaultPort {
  /** Contexto de la nota activa, o null si no hay markdown activo. */
  getActiveNoteContext(): Promise<NoteContext | null>;
  /** Contenido de una nota por ruta (para construir prompts en fases IA). */
  readNote(path: string): Promise<string>;
}
