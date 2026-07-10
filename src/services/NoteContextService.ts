import { App, TFile } from "obsidian";
import type { VaultPort } from "../domain/ports/VaultPort";
import type { NoteContext, Relationship, Heading } from "../domain/models/NoteContext";

export class NoteContextService implements VaultPort {
  constructor(private readonly app: App) {}

  async getActiveNoteContext(): Promise<NoteContext | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return null; // early return

    const cache = this.app.metadataCache.getFileCache(file);
    const content = await this.app.vault.cachedRead(file);

    return {
      path: file.path,
      title: file.basename,
      outgoingLinks: this.resolveOutgoing(file),
      backlinks: this.resolveBacklinks(file),
      headings: this.extractHeadings(cache),
      wordCount: this.countWords(content),
    };
  }

  async readNote(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`Nota no encontrada: ${path}`);
    return this.app.vault.cachedRead(f);
  }

  private resolveOutgoing(file: TFile): Relationship[] {
    const resolved = this.app.metadataCache.resolvedLinks[file.path] ?? {};
    return Object.keys(resolved).map((path) => this.toRelationship(path));
  }

  private resolveBacklinks(file: TFile): Relationship[] {
    const all = this.app.metadataCache.resolvedLinks;
    return Object.entries(all)
      .filter(([, targets]) => file.path in targets)
      .map(([src]) => this.toRelationship(src));
  }

  private extractHeadings(cache: ReturnType<App["metadataCache"]["getFileCache"]>): Heading[] {
    return (cache?.headings ?? []).map((h) => ({ level: h.level, text: h.heading }));
  }

  private toRelationship(path: string): Relationship {
    const base = path.split("/").pop() ?? path;
    return { path, title: base.replace(/\.md$/, "") };
  }

  private countWords(text: string): number {
    const t = text.trim();
    return t ? t.split(/\s+/).length : 0;
  }
}
