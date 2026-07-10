import { Notice, Plugin } from "obsidian";
import type { VaultPort } from "./domain/ports/VaultPort";
import { NoteContextService } from "./services/NoteContextService";
import { ResultModal } from "./ui/ResultModal";

export default class ContextIaPlugin extends Plugin {
  private vault!: VaultPort;

  async onload(): Promise<void> {
    console.info("[Context IA] cargado"); // sin secretos: seguro

    this.vault = new NoteContextService(this.app);

    this.addCommand({
      id: "show-note-context",
      name: "Mostrar contexto de la nota activa",
      callback: async () => {
        const ctx = await this.vault.getActiveNoteContext();
        if (!ctx) {
          new Notice("Abre una nota markdown primero.");
          return; // early return
        }
        new ResultModal(this.app, `Contexto: ${ctx.title}`, JSON.stringify(ctx, null, 2)).open();
      },
    });
  }

  async onunload(): Promise<void> {}
}
