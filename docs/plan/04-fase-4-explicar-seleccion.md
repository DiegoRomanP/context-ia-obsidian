# Fase 4 — Explicar una parte (selección de texto)

> **IA:** ✅ reutiliza `LLMPort` (Fase 3). Sólo cambia el prompt y el input (texto seleccionado en el editor).
> Fase corta que confirma la **reutilización** del servicio (DRY) y el manejo de selección vacía.

---

## 1. Objetivo
Explicar el fragmento seleccionado por el usuario, usando el contexto de la nota como apoyo, con manejo
correcto de selección vacía (pedir seleccionar, no fallar).

## 2. Definition of Ready
- Fase 3 "Done" (`LLMPort`/`NvidiaLLMService` funcionando).

## 3. Alcance
**In:** método `explain()` en `LLMPort`, comando "Explicar selección", uso de `editor.getSelection()`.
**Out:** nuevos servicios (se reutiliza el existente); investigar/imagen.

## 4. Diseño técnico

### 4.1 Extensión del puerto — `LLMPort`
```ts
export interface LLMPort {
  summarize(context: NoteContext, noteBody: string): Promise<SummaryResult>;
  explain(selection: string, context: NoteContext): Promise<SummaryResult>; // reutiliza SummaryResult (text)
  chat(messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}
```
> Se reutiliza el DTO `SummaryResult` (campo `text`) — no crear un DTO casi idéntico (DRY). Si en el futuro
> difieren, se separa entonces (YAGNI).

### 4.2 Implementación en `NvidiaLLMService`
```ts
async explain(selection: string, context: NoteContext): Promise<SummaryResult> {
  const trimmed = selection.trim();
  if (!trimmed) throw new EmptySelectionError("Selecciona el texto que quieres explicar.");

  const messages: ChatMessage[] = [
    { role: "system", content: "Explicas fragmentos de texto de forma clara y didáctica en español." },
    { role: "user", content:
      `En la nota "${context.title}", explica este fragmento en detalle y con un ejemplo si aplica:\n\n"""${trimmed}"""` },
  ];
  const res = await this.chat(messages, { maxTokens: 1500 });
  if (!res.content.trim()) throw new EmptyResponseError("Respuesta vacía del modelo");
  return { text: res.content, reasoning: res.reasoning, model: this.model };
}
```
Nuevo error tipado en `ApiErrors.ts`:
```ts
export class EmptySelectionError extends Error {}
```

### 4.3 Comando (en `main.ts`) — usa `editorCallback`
```ts
this.addCommand({
  id: "explain-selection",
  name: "Explicar selección con IA",
  editorCallback: (editor) => this.runAction(async (vault, llm) => {
    const selection = editor.getSelection();
    const ctx = await vault.getActiveNoteContext();
    if (!ctx) throw new Error("Abre una nota markdown primero.");
    const result = await llm.explain(selection, ctx); // lanza EmptySelectionError si vacío
    new ResultModal(this.app, "Explicación", result.text).open();
  }),
});
```
Añadir al helper `runAction` (Fase 3) la traducción:
```ts
else if (e instanceof EmptySelectionError) new Notice("✍️ " + e.message);
```

## 5. Pasos numerados
1. Añadir `explain()` al puerto y al servicio; nuevo error `EmptySelectionError`.
2. Registrar el comando con `editorCallback`.
3. Añadir la rama del error en `runAction`.
4. Probar con selección válida y vacía.

## 6. Frameworks / librerías
API de Obsidian (`Editor.getSelection`, `editorCallback`). Sin deps nuevas.

## 7. Seguridad (de esta fase)
- Sólo se envía el fragmento seleccionado + metadatos de la nota (minimización de datos, [`SEGURIDAD.md §6`](./SEGURIDAD.md)).
- Sin cambios en el manejo de la key (heredado de Fase 3).

## 8. Manejo de errores / edge cases
- **Selección vacía** → `EmptySelectionError` → `Notice` "✍️ Selecciona el texto…" (NO crash). Requisito del `plan.md`.
- Selección enorme → considerar truncado defensivo (`maxTokens` acota la salida; el input se puede recortar en Fase 7 si hace falta).
- Sin nota activa → `Notice` pidiendo abrir nota.

## 9. Tests (Vitest)
```ts
it("lanza EmptySelectionError con selección vacía", async () => {
  const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
  await expect(svc.explain("   ", ctxFixture)).rejects.toBeInstanceOf(EmptySelectionError);
});
it("explica una selección válida", async () => {
  (requestUrl as any).mockResolvedValue({ status: 200, json: { choices: [{ message: { content: "explicación" } }] } });
  const svc = new NvidiaLLMService(fakeSecrets("nvapi-x"), URL, MODEL, "high");
  expect((await svc.explain("texto", ctxFixture)).text).toBe("explicación");
});
```

## 10. CI para la fase
Sin cambios de workflow; tests nuevos corren en `ci.yml`.

## 11. Definition of Done
- [ ] "Explicar selección" funciona con texto seleccionado.
- [ ] Con selección vacía muestra `Notice` y **no** falla.
- [ ] Tests de selección vacía y válida verdes.

## 12. Validación manual (del `plan.md`)
> "Que funcione con selecciones vacías (debe pedir seleccionar texto, no fallar)."

## 13. Commit / PR sugerido
```
feat(ai): acción Explicar selección (reutiliza LLMPort)

- explain() en NvidiaLLMService; EmptySelectionError → Notice.
- Comando con editorCallback; tests de selección vacía y válida.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| Selección muy larga excede contexto | Truncado defensivo (Fase 7); `maxTokens` limita salida. |
| Duplicación con `summarize` | Se comparte `chat()` y `SummaryResult` (DRY). |
