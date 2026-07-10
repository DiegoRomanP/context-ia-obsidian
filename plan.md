# Plan de implementación — Plugin de contexto + IA para Obsidian

## Objetivo

Contruir una extensión que lea el archivo que le das y entienda las relaciones con los otros archivos
Luego le puedes pedir: crear un resumen o crear una imagen explicativa( para esta opción debes poner una api key o la extension de la suscripción que pagas) o  investigar temas o explicar una parte

## Arquitectura general (antes de programar)

Separa en 3 capas desde el día uno — patrón *ports & adapters*, útil para tu portafolio backend:

- **Core** (`main.ts`): ciclo de vida del plugin, comandos, eventos de Obsidian.
- **Servicios** (`/services`): clientes de API (LLM, imagen, búsqueda) — independientes de Obsidian, testeables aparte.
- **UI** (`/ui`): modals, settings tab, renderizado de resultados.

Stack: TypeScript + esbuild (estándar del ecosistema), ESLint, y como base el `obsidian-sample-plugin` oficial. Usa **`requestUrl`** de la API de Obsidian en vez de `fetch` — evita problemas de CORS y es la práctica recomendada por el equipo de Obsidian para llamadas externas.

---

## Fase 0 — Setup (1-2 días)

- Clonar `obsidian-sample-plugin`, configurar esbuild + hot-reload en un vault de pruebas dedicado (nunca tu vault real).
- CI básico en GitHub Actions: lint + build en cada push.
- **Validar:** el plugin carga sin errores en consola de Obsidian (`Ctrl+Shift+I`).

## Fase 1 — Lectura de archivo y relaciones (sin IA todavía)

- Comando que toma el archivo activo, usa `metadataCache.getFileCache()` + `resolvedLinks` para armar un objeto: `{ archivo, links_salientes, backlinks, headings }`.
- Mostrar ese objeto en un modal simple (JSON crudo) — así validas la lógica de grafo antes de meter complejidad de IA.
- **Seguridad:** ninguna aún, es todo local.
- **Validar:** crea un vault de prueba con 5-6 notas interconectadas y confirma que el conteo de links/backlinks coincide con lo que ves en el grafo nativo de Obsidian.

## Fase 2 — Settings y manejo seguro de API keys

- `PluginSettingTab` con campo para API key, tipo password (oculto en UI).
- **Antes de escribir una sola llamada a IA**, resuelve el guardado: por defecto en `data.json` (advertir al usuario que no sincronice ese archivo si usa control de versiones), con opción de leer desde variable de entorno del sistema como alternativa más segura.
- **Validar:** la key nunca aparece en `console.log`; probar que el campo persiste tras reiniciar Obsidian.

## Fase 3 — Primera integración de IA: Resumen

La más simple de las 4 acciones — te sirve para validar el pipeline completo antes de replicarlo.

- Servicio `LLMService` con un método `summarize(context)`, llamada vía `requestUrl`.
- Manejo de errores explícito: key inválida, sin conexión, rate limit, respuesta vacía — cada uno con mensaje distinto al usuario (`Notice`), nunca un crash silencioso.
- **Validar:** probar los 4 casos de error de forma manual (key mal puesta, wifi apagado, etc.) antes de dar por cerrada la fase.

## Fase 4 — Explicar una parte (selección de texto)

- Reutiliza `LLMService`, agrega contexto de selección (`editor.getSelection()`).
- **Validar:** que funcione con selecciones vacías (debe pedir seleccionar texto, no fallar).

## Fase 5 — Investigar temas

- Requiere una API con búsqueda real, no solo el LLM (para evitar alucinar fuentes).
- Mostrar resultados con fuente citada, nunca como texto insertado sin marcar origen.
- **Validar:** verificar manualmente que 3-4 respuestas de prueba realmente citan fuentes verificables.

## Fase 6 — Imagen explicativa (la más compleja)

- Nuevo servicio `ImageService`, manejo de respuesta binaria, `vault.createBinary()` para guardar el attachment.
- **Seguridad extra:** validar tamaño de respuesta antes de escribir a disco (evitar que una respuesta corrupta llene el vault).
- **Validar:** generar 5-10 imágenes de prueba, confirmar que se insertan correctamente como embed (`![[imagen.png]]`) en la nota.

## Fase 7 — Hardening y release

- Rate limiting básico (debounce en comandos, para no golpear la API por doble-click).
- Checklist de QA manual sobre las 4 acciones + settings, en un vault limpio.
- Versionado semántico, `CHANGELOG.md`, submit a community plugins si quieres publicarlo.

---

Cada fase es un commit/PR independiente — así construyes el hábito de entregas incrementales validadas, que es exactamente lo que se espera en un rol de software/backend.
