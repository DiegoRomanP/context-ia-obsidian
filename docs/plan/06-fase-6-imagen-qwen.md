# Fase 6 — Imagen explicativa (Qwen-Image) — la más compleja

> **IA:** ✅ `qwen-image` vía el endpoint OpenAI-compatible de imágenes de NVIDIA NIM. Novedad respecto a las
> fases de texto: **respuesta binaria** (base64), **validación de tamaño** antes de escribir a disco, y
> guardado como attachment + embed en la nota.

---

## 1. Objetivo
Generar una imagen explicativa a partir de un prompt (derivado de la nota o escrito por el usuario),
guardarla en el vault de forma segura y anclarla en la nota como embed `![[imagen.png]]`.

## 2. Definition of Ready
- Fase 3 "Done" (patrón `requestUrl` + errores tipados + `SecretsPort`).
- `NVIDIA_API_KEY` válida (el mismo host sirve imágenes).

## 3. Alcance
**In:** `ImagePort` + `NvidiaImageService`, DTO `ImageResult`, decode base64, validación de tamaño,
`vault.createBinary()`, inserción del embed, comando "Generar imagen".
**Out:** edición de imágenes (`qwen-image-edit`), variaciones múltiples.

## 4. Diseño técnico

### 4.1 DTO — `src/domain/models/ImageResult.ts`
```ts
export interface ImageResult {
  readonly bytes: Uint8Array;   // PNG decodificado
  readonly mimeType: string;    // "image/png"
  readonly model: string;
}
```

### 4.2 Puerto — `src/domain/ports/ImagePort.ts`
```ts
import type { ImageResult } from "../models/ImageResult";
export interface ImagePort {
  generate(prompt: string, size: string): Promise<ImageResult>;
}
```

### 4.3 Adapter — `src/services/NvidiaImageService.ts`
```ts
import { requestUrl } from "obsidian";
import type { ImagePort } from "../domain/ports/ImagePort";
import type { ImageResult } from "../domain/models/ImageResult";
import type { SecretsPort } from "../domain/ports/SecretsPort";
import { InvalidKeyError, RateLimitError, NetworkError, EmptyResponseError, UpstreamError, PayloadTooLargeError } from "../errors/ApiErrors";
import { MAX_IMAGE_BYTES } from "../config/constants";

export class NvidiaImageService implements ImagePort {
  constructor(private readonly secrets: SecretsPort, private readonly baseUrl: string, private readonly model: string) {}

  async generate(prompt: string, size: string): Promise<ImageResult> {
    const key = await this.secrets.get("NVIDIA_API_KEY");
    if (!key) throw new InvalidKeyError("Configura tu NVIDIA_API_KEY.");

    let resp;
    try {
      resp = await requestUrl({
        url: `${this.baseUrl}/images/generations`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: this.model, prompt, size, n: 1, response_format: "b64_json" }),
        throw: false,
      });
    } catch { throw new NetworkError("Sin conexión con NVIDIA NIM"); }

    if (resp.status === 401 || resp.status === 403) throw new InvalidKeyError("API key inválida");
    if (resp.status === 429) throw new RateLimitError("Límite alcanzado");
    if (resp.status >= 500) throw new UpstreamError("Error del servidor de NIM");
    if (resp.status >= 400) throw new UpstreamError(`HTTP ${resp.status}`);

    const b64 = resp.json?.data?.[0]?.b64_json;
    if (!b64) throw new EmptyResponseError("La API no devolvió imagen");

    const bytes = base64ToBytes(b64);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {          // ⬅️ SEGURIDAD: tope antes de escribir a disco
      throw new PayloadTooLargeError("La imagen excede el tamaño máximo permitido");
    }
    return { bytes, mimeType: "image/png", model: this.model };
  }
}
```
Utilidad `base64ToBytes` en `src/utils/base64.ts` (usar `atob` del renderer o `Buffer`).
Nuevo error en `ApiErrors.ts`:
```ts
export class PayloadTooLargeError extends Error {}
```
> ⚠️ **Verificar al construir:** (a) el **ID exacto** del modelo (`qwen-image` vs `qwen-image-2512`), (b) que el
> endpoint OpenAI-compatible `/images/generations` acepte `response_format: "b64_json"` para qwen-image (si sólo
> devuelve `url`, descargar el binario con un segundo `requestUrl`), (c) tamaños (`size`) soportados. Todo
> encapsulado en este adapter.

### 4.4 Guardado + embed — en `main.ts` (o un `ImageInsertService`)
```ts
private async insertImage(result: ImageResult, ctx: NoteContext): Promise<void> {
  const folder = "attachments";
  await this.app.vault.adapter.mkdir(folder).catch(() => {}); // idempotente
  const name = `${folder}/ia-${ctx.title}-${Date.now()}.png`;
  await this.app.vault.createBinary(name, result.bytes.buffer as ArrayBuffer); // escribe el attachment
  const editor = this.app.workspace.activeEditor?.editor;
  editor?.replaceSelection(`\n![[${name}]]\n`); // embed en la nota
}
```

### 4.5 Comando
```ts
this.addCommand({
  id: "generate-image",
  name: "Generar imagen explicativa con IA",
  callback: () => this.runAction(async (vault) => {
    const ctx = await vault.getActiveNoteContext();
    if (!ctx) throw new Error("Abre una nota markdown primero.");
    const prompt = await promptForText(this.app, "Describe la imagen a generar", `Diagrama explicativo de: ${ctx.title}`);
    if (!prompt) return; // cancelado
    const result = await this.images.generate(prompt, "1024x1024");
    await this.insertImage(result, ctx);
    new Notice("🖼️ Imagen insertada.");
  }),
});
```

## 5. Pasos numerados
1. `ImageResult`, `ImagePort`, `PayloadTooLargeError`, `MAX_IMAGE_BYTES` en constants.
2. `base64ToBytes` (utils).
3. `NvidiaImageService` con validación de tamaño.
4. `insertImage` (createBinary + embed) y comando.
5. Probar generación e inserción varias veces.

## 6. Frameworks / librerías
API de Obsidian (`requestUrl`, `vault.createBinary`, `vault.adapter.mkdir`). Sin deps nuevas.

## 7. Seguridad (de esta fase) — la "seguridad extra" del `plan.md`
- **Validar tamaño** (`MAX_IMAGE_BYTES`, p. ej. 15 MB) **antes** de escribir a disco ⇒ una respuesta corrupta
  no llena el vault (requisito explícito del `plan.md`).
- Nombre de archivo saneado (sin `../`, sin caracteres peligrosos) para evitar path traversal.
- La key va sólo en el header; nunca en el nombre del archivo ni en logs.

## 8. Manejo de errores / edge cases
- Sin `b64_json` (o `url` en su lugar) → `EmptyResponseError` o rama de descarga por URL.
- Base64 inválido → capturar en `base64ToBytes` y lanzar `EmptyResponseError`.
- Carpeta `attachments` inexistente → `mkdir` idempotente.
- Colisión de nombre → `Date.now()` en el nombre lo evita.
- Prompt vacío/cancelado → `return` sin efectos.

## 9. Tests (Vitest)
```ts
it("decodifica y valida el tamaño de la imagen", async () => {
  const tinyPng = "iVBORw0KGgo="; // base64 mínimo
  (requestUrl as any).mockResolvedValue({ status: 200, json: { data: [{ b64_json: tinyPng }] } });
  const svc = new NvidiaImageService(fakeSecrets("nvapi-x"), URL, "qwen-image");
  expect((await svc.generate("gato", "1024x1024")).mimeType).toBe("image/png");
});
it("rechaza imágenes por encima del límite", async () => { /* mock con b64 grande ⇒ PayloadTooLargeError */ });
it("mapea 401 a InvalidKeyError", async () => { /* ... */ });
```
**Casos borde:** sin `b64_json`, base64 corrupto, tamaño excedido, 401/429.

## 10. CI para la fase
Tests en `ci.yml`. El paso anti-secreto del bundle sigue vigente.

## 11. Definition of Done
- [ ] Generar 5-10 imágenes de prueba; todas se guardan e insertan como `![[...]]` correctamente.
- [ ] Una respuesta simulada gigante se **rechaza** (test `PayloadTooLargeError`).
- [ ] Nombres de archivo saneados; sin colisiones.
- [ ] Tests verdes.

## 12. Validación manual (del `plan.md`)
> "Generar 5-10 imágenes de prueba, confirmar que se insertan correctamente como embed (`![[imagen.png]]`) en la nota."

## 13. Commit / PR sugerido
```
feat(ai): acción Generar imagen con Qwen-Image (NVIDIA NIM)

- ImagePort + NvidiaImageService; decode base64 + validación de tamaño.
- createBinary en attachments + embed ![[...]]; nombres saneados.
- Tests: decode, límite de tamaño, mapeo de status.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| Respuesta por `url` en vez de `b64_json` | Rama de descarga con segundo `requestUrl` (⚠️ §4.3). |
| ID de modelo distinto | `imageModel` en settings/constants: cambio en un punto. |
| Tamaños (`size`) no soportados | Validar contra doc; exponer un dropdown de tamaños válidos. |
| Vault se llena | `MAX_IMAGE_BYTES` + carpeta `attachments` dedicada + aviso. |
