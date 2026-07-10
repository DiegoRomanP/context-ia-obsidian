# Fase 1 — Lectura de archivo y relaciones (sin IA)

> **IA:** ninguna (todo local). **Salida:** un comando que arma el contexto de la nota activa (links,
> backlinks, headings) y lo muestra en un modal como JSON crudo. Es la base sobre la que todas las
> acciones de IA construirán su prompt.

---

## 1. Objetivo
Extraer, de forma determinista y testeable, el **grafo local** de la nota activa: qué enlaza, quién la
enlaza y su estructura de headings. Validar la lógica de grafo **antes** de introducir complejidad de IA.

## 2. Definition of Ready
- Fase 0 "Done" (plugin carga, CI verde).
- Vault de pruebas con **5–6 notas interconectadas** para comparar contra el grafo nativo de Obsidian.

## 3. Alcance
**In:** `VaultPort` + `NoteContextService`, DTO `NoteContext`, comando "Mostrar contexto de la nota", modal JSON.
**Out:** cualquier llamada a IA; formateo bonito del resultado (eso viene con las acciones).

## 4. Diseño técnico

### 4.1 DTOs inmutables — `src/domain/models/NoteContext.ts`
```ts
export interface Relationship {
  readonly path: string;   // ruta de la nota relacionada
  readonly title: string;  // basename sin extensión
}

export interface Heading {
  readonly level: number;  // 1..6
  readonly text: string;
}

export interface NoteContext {
  readonly path: string;
  readonly title: string;
  readonly outgoingLinks: readonly Relationship[]; // links salientes resueltos
  readonly backlinks: readonly Relationship[];     // notas que enlazan a esta
  readonly headings: readonly Heading[];
  readonly wordCount: number;
}
```

### 4.2 Puerto — `src/domain/ports/VaultPort.ts`
```ts
import type { NoteContext } from "../models/NoteContext";

export interface VaultPort {
  /** Contexto de la nota activa, o null si no hay markdown activo. */
  getActiveNoteContext(): Promise<NoteContext | null>;
  /** Contenido de una nota por ruta (para construir prompts en fases IA). */
  readNote(path: string): Promise<string>;
}
```

### 4.3 Adapter — `src/services/NoteContextService.ts`
Encapsula la API de Obsidian (`app.workspace`, `metadataCache`, `resolvedLinks`). **No** filtra tipos de
Obsidian hacia afuera: devuelve el DTO limpio.

```ts
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
```

### 4.4 UI — `src/ui/ResultModal.ts` (reutilizable en todas las fases)
```ts
import { App, Modal } from "obsidian";

export class ResultModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly body: string) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText(this.title);
    const pre = this.contentEl.createEl("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.setText(this.body);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
```

### 4.5 Wiring — en `main.ts`
```ts
const vault: VaultPort = new NoteContextService(this.app);

this.addCommand({
  id: "show-note-context",
  name: "Mostrar contexto de la nota activa",
  callback: async () => {
    const ctx = await vault.getActiveNoteContext();
    if (!ctx) { new Notice("Abre una nota markdown primero."); return; } // early return
    new ResultModal(this.app, `Contexto: ${ctx.title}`, JSON.stringify(ctx, null, 2)).open();
  },
});
```

## 5. Pasos numerados
1. Crear los DTOs (`NoteContext.ts`) y el puerto (`VaultPort.ts`).
2. Implementar `NoteContextService`.
3. Crear `ResultModal`.
4. Registrar el comando en `main.ts` y cablear la instancia.
5. Probar en el vault de pruebas.
6. Escribir tests unitarios (§9).

## 6. Frameworks / librerías
Sólo API de Obsidian (`metadataCache`, `resolvedLinks`, `vault.cachedRead`). Sin dependencias nuevas.

## 7. Seguridad (de esta fase)
Ninguna superficie de red: todo es local (como indica el `plan.md`). Único cuidado: `readNote` valida que
la ruta exista antes de leer.

## 8. Manejo de errores / edge cases
- **Sin nota activa** o nota no-markdown → `Notice` pidiendo abrir una nota (no crash).
- **Nota sin links/backlinks/headings** → arrays vacíos, `wordCount` correcto (incluido 0).
- **Links no resueltos** (a notas inexistentes): `resolvedLinks` sólo incluye resueltos ⇒ coherente con el
  grafo nativo. (Si se quisieran los no resueltos, existe `unresolvedLinks`; fuera de alcance.)

## 9. Tests (Vitest, mockeando Obsidian)
Como `NoteContextService` recibe `App`, se mockea un `app` con `metadataCache.resolvedLinks`,
`workspace.getActiveFile` y `vault.cachedRead`.
```ts
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
});
```
**Casos borde cubiertos:** sin nota activa, nota vacía (0 palabras), nota sin relaciones.

## 10. CI para la fase
Los tests nuevos corren en `ci.yml` (ya existe). Sin cambios de workflow.

## 11. Definition of Done
- [ ] Comando visible en la paleta y funcional.
- [ ] El JSON del modal coincide con el grafo nativo en el vault de pruebas.
- [ ] Tests de `NoteContextService` pasan (incluye casos borde).
- [ ] `lint`/`typecheck`/`build` verdes.

## 12. Validación manual (del `plan.md`)
> "Crea un vault de prueba con 5-6 notas interconectadas y confirma que el conteo de links/backlinks
> coincide con lo que ves en el grafo nativo de Obsidian."

## 13. Commit / PR sugerido
```
feat(context): lectura de nota activa y grafo de relaciones

- VaultPort + NoteContextService (metadataCache/resolvedLinks).
- DTO NoteContext inmutable; comando + ResultModal (JSON crudo).
- Tests unitarios con Obsidian mockeado.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| `resolvedLinks` no poblado al iniciar | Se llena tras el indexado; probar con vault ya abierto. |
| API de `metadataCache` cambia entre versiones | `minAppVersion` fija el mínimo; encapsulado en el adapter (cambio localizado). |
