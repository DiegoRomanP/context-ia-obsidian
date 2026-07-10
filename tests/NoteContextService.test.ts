import { describe, it, expect } from "vitest";
import { NoteContextService } from "../src/services/NoteContextService";

function makeApp(overrides: Partial<any> = {}) {
  return {
    workspace: { getActiveFile: () => ({ path: "A.md", basename: "A", extension: "md" }) },
    metadataCache: {
      resolvedLinks: { "A.md": { "B.md": 1 }, "C.md": { "A.md": 1 } },
      getFileCache: () => ({ headings: [{ level: 1, heading: "Título" }] }),
    },
    vault: { cachedRead: async () => "hola mundo", getAbstractFileByPath: () => null },
    ...overrides,
  } as any;
}

describe("NoteContextService", () => {
  it("resuelve links salientes y backlinks", async () => {
    const ctx = await new NoteContextService(makeApp()).getActiveNoteContext();
    expect(ctx?.outgoingLinks.map((r) => r.path)).toEqual(["B.md"]);
    expect(ctx?.backlinks.map((r) => r.path)).toEqual(["C.md"]);
    expect(ctx?.wordCount).toBe(2);
  });

  it("devuelve null si no hay nota markdown activa", async () => {
    const app = makeApp({ workspace: { getActiveFile: () => null } });
    expect(await new NoteContextService(app).getActiveNoteContext()).toBeNull();
  });

  it("devuelve arrays vacíos y wordCount 0 en una nota sin relaciones ni contenido", async () => {
    const app = makeApp({
      metadataCache: {
        resolvedLinks: {},
        getFileCache: () => ({ headings: [] }),
      },
      vault: { cachedRead: async () => "", getAbstractFileByPath: () => null },
    });
    const ctx = await new NoteContextService(app).getActiveNoteContext();
    expect(ctx?.outgoingLinks).toEqual([]);
    expect(ctx?.backlinks).toEqual([]);
    expect(ctx?.headings).toEqual([]);
    expect(ctx?.wordCount).toBe(0);
  });

  it("lanza si la nota a leer no existe", async () => {
    const service = new NoteContextService(makeApp());
    await expect(service.readNote("no-existe.md")).rejects.toThrow("Nota no encontrada");
  });
});
