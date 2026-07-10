# Plan de implementación — Plugin de contexto + IA para Obsidian

> Documentación de planificación **por fases**, escrita a nivel de senior software engineer.
> Objetivo: que al construir cada fase **no haya sorpresas** (arquitectura, contratos de datos,
> seguridad, frameworks y CI ya están decididos aquí).

Este directorio expande el `plan.md` de la raíz en documentos ejecutables. Cada fase es un
**commit/PR atómico** y validable de forma independiente.

---

## 1. Visión del producto

Una extensión de Obsidian que:

1. Lee el archivo (nota) activo y **entiende sus relaciones** con otras notas del vault
   (links salientes, backlinks, headings).
2. Sobre ese contexto ofrece **4 acciones de IA**:
   - **Resumir** la nota.
   - **Explicar** una parte seleccionada.
   - **Investigar** un tema (con búsqueda web real y **fuentes citadas**).
   - **Generar una imagen** explicativa y anclarla en la nota.

La IA se sirve mediante **NVIDIA NIM** (endpoints gratuitos, compatibles con OpenAI). Las claves
del usuario viven en un archivo **`.env`** (nunca en el bundle ni en el repo).

---

## 2. Índice de fases

| Fase | Documento | Entregable | IA |
|------|-----------|------------|----|
| 0 | [`00-fase-0-setup-ci.md`](./00-fase-0-setup-ci.md) | Repo, esbuild, hot-reload, GitHub Actions | — |
| 1 | [`01-fase-1-lectura-relaciones.md`](./01-fase-1-lectura-relaciones.md) | Lectura de nota + grafo de relaciones (modal JSON) | — |
| 2 | [`02-fase-2-settings-secretos.md`](./02-fase-2-settings-secretos.md) | Settings + manejo seguro de API keys | — |
| 3 | [`03-fase-3-resumen.md`](./03-fase-3-resumen.md) | Acción **Resumir** (pipeline IA completo) | ✅ |
| 4 | [`04-fase-4-explicar-seleccion.md`](./04-fase-4-explicar-seleccion.md) | Acción **Explicar selección** | ✅ |
| 5 | [`05-fase-5-investigar.md`](./05-fase-5-investigar.md) | Acción **Investigar** (tool-calling + búsqueda) | ✅ |
| 6 | [`06-fase-6-imagen-qwen.md`](./06-fase-6-imagen-qwen.md) | Acción **Imagen** (Qwen-Image) | ✅ |
| 7 | [`07-fase-7-hardening-release.md`](./07-fase-7-hardening-release.md) | Hardening, QA, release, community plugins | — |

Documentos transversales:
- [`SEGURIDAD.md`](./SEGURIDAD.md) — modelo de amenazas y manejo de secretos (referenciado por todas las fases).

> **Nota sobre la Fase 0:** el `plan.md` original numera "desde Fase 1", pero la Fase 0 (setup + CI)
> se incluye porque es donde viven las **GitHub Actions** —requisito explícito del proyecto— y es
> prerequisito duro del resto.

---

## 3. Stack técnico (fijado)

| Área | Elección | Versión objetivo | Motivo |
|------|----------|------------------|--------|
| Lenguaje | TypeScript | 5.4+ | Estándar del ecosistema de plugins de Obsidian. `strict: true`. |
| Bundler | esbuild | 0.20+ | Base del `obsidian-sample-plugin`; build < 1 s. |
| Runtime dev | Node.js | 20 LTS+ (disponible: 26.4) | — |
| Gestor de paquetes | **npm** | 10+ (disponible: 11.18) | No hay pnpm/yarn en el entorno. |
| Lint | ESLint + `typescript-eslint` | 8.x / 7.x | Calidad y reglas de tipos. |
| Formato | Prettier | 3.x | Estilo consistente. |
| Tests | **Vitest** | 1.x | TS-native, mocking sencillo, rápido. |
| HTTP | `requestUrl` (API de Obsidian) | — | Evita CORS; recomendado por el equipo de Obsidian para llamadas externas. |
| Proveedor IA | NVIDIA NIM (OpenAI-compatible) | — | Gratuito; texto + imagen bajo el mismo host y auth. |

> **Regla dura:** NO usar `fetch` ni el SDK de OpenAI para llamar a la API. Todas las llamadas
> externas pasan por `requestUrl`. NVIDIA NIM es OpenAI-compatible, así que se habla su REST directamente.

---

## 4. Arquitectura — Ports & Adapters (hexagonal)

Separación en capas desde el día 1. El **dominio y los servicios no importan `obsidian`**: eso los
hace testeables de forma aislada (mockeando puertos) y cumple la separación
Controllers/Services/Repositories/DTOs/Config/Utils exigida por las reglas del proyecto.

```
src/
  main.ts                       # CORE / Controller: ciclo de vida, comandos, wiring (DI por constructor)
  domain/
    models/                     # DTOs inmutables (readonly): NoteContext, Relationship,
                                #   SummaryResult, ResearchResult, ResearchCitation, ImageResult
    ports/                      # Interfaces (contratos):
                                #   LLMPort, ImagePort, SearchPort, SecretsPort, VaultPort
  services/                     # Adapters de salida (implementan puertos):
    NvidiaLLMService.ts         #   LLMPort  → requestUrl → POST /v1/chat/completions (deepseek-v4-flash)
    NvidiaImageService.ts       #   ImagePort→ requestUrl → POST /v1/images/generations (qwen-image)
    ResearchService.ts          #   orquesta LLMPort + SearchPort (loop de tool-calling)
    TavilySearchService.ts      #   SearchPort → requestUrl → API de búsqueda
    NoteContextService.ts       #   VaultPort → metadataCache + resolvedLinks
  secrets/                      # Adapters de secretos:
    DotenvSecretsAdapter.ts     #   lee .env en runtime (dev/personal)
    SettingsSecretsAdapter.ts   #   Obsidian Secret Storage (v1.11+) / data.json fallback
  ui/                           # Adapters de entrada/salida al usuario:
    SettingsTab.ts, ResultModal.ts, notices.ts
  config/
    constants.ts                # endpoints, model IDs, límites (sin magic numbers)
  errors/
    ApiErrors.ts                # errores tipados de dominio
tests/                          # espejo de src/, con __mocks__ de la API de Obsidian
```

**Reglas de dependencia (flecha = "puede importar a"):**

```
main.ts ──► ui/ ──► services/ ──► ports/ ◄── domain/models/
   │                    │
   └───────► secrets/ ──┘         (services y secrets sólo conocen los puertos, no a main)
```

- `domain/ports` y `domain/models` **no importan nada de infraestructura**.
- `services/*` implementan puertos y **encapsulan** la API de Obsidian / HTTP; no exponen tipos crudos de Obsidian.
- `main.ts` es el **único** que conoce todas las piezas y las **cablea** (inyección por constructor).

### Principios de código (de las reglas globales del proyecto)
SOLID · DRY · KISS · DI por constructor · DTOs inmutables (`readonly`) · early returns · funciones
pequeñas · nombres significativos · sin variables globales · sin magic numbers · sin `console.log` de
secretos · sin exponer entidades crudas · sin TODOs sin resolver · sin warnings del compilador.

---

## 5. Proveedores y endpoints (NVIDIA NIM · OpenAI-compatible)

**Base URL:** `https://integrate.api.nvidia.com/v1` · **Auth:** `Authorization: Bearer nvapi-...`

| Función | Método + ruta | Modelo | Respuesta relevante |
|---------|---------------|--------|---------------------|
| Resumir / Explicar | `POST /chat/completions` | `deepseek-ai/deepseek-v4-flash` | `choices[0].message.content` (+ `reasoning_content`) |
| Investigar | `POST /chat/completions` con `tools` (tool-calling) | `deepseek-ai/deepseek-v4-flash` | `choices[0].message.tool_calls` → loop → `content` con citas |
| Imagen | `POST /images/generations` | `qwen-image` | `data[0].b64_json` (PNG base64) |
| Búsqueda web (soporte de "Investigar") | `POST` a API de búsqueda (`SearchPort`) | Tavily (u alternativa) | resultados con `title`, `url`, `content` |

**Parámetros de razonamiento de DeepSeek-V4** (van en el body como `chat_template_kwargs`):
`{"thinking": true, "reasoning_effort": "high" | "medium" | "low"}`.

> ⚠️ **Verificar contra la doc viva de NVIDIA al construir:** el ID exacto de imagen (`qwen-image`
> vs `qwen-image-2512`) y el campo de respuesta de la imagen (`b64_json`). Documentado en la Fase 6.

---

## 6. Decisiones de arquitectura (ADRs breves)

- **ADR-1 — NVIDIA NIM como proveedor.** Gratuito, OpenAI-compatible, cubre texto (deepseek-v4-flash) e
  imagen (qwen-image) bajo el mismo host/credencial ⇒ un solo `SecretsPort`, menos superficie. *Trade-off:*
  dependemos de la disponibilidad del free tier; mitigado por la abstracción `LLMPort`/`ImagePort` (swap fácil).
- **ADR-2 — Ports & Adapters.** Aísla la lógica de IA de la API de Obsidian ⇒ tests unitarios sin Obsidian y
  portabilidad. *Trade-off:* algo más de boilerplate (interfaces), aceptable para un portafolio backend.
- **ADR-3 — `requestUrl` en vez de `fetch`.** Evita CORS con endpoints externos; recomendado por Obsidian.
- **ADR-4 — Secretos en `.env` (runtime) + Secret Storage.** Requisito del usuario (`.env`). Se lee en
  **runtime** vía `fs`, **nunca** se inyecta en build (evita hornear la key en `main.js`). Para distribución se
  recomienda el **Secret Storage API** de Obsidian (v1.11+, keychain del SO). Ver [`SEGURIDAD.md`](./SEGURIDAD.md).
- **ADR-5 — Vitest.** TS-native y rápido; mocking de la API de Obsidian trivial vía `vi.mock`.
- **ADR-6 — Investigar = tool-calling.** DeepSeek-V4 soporta function/tool calling ⇒ loop acotado donde el
  modelo pide `web_search`; el `SearchPort` devuelve fuentes reales ⇒ **citas verificables**, no alucinadas.

---

## 7. Estado de acceso a GitHub / GitHub Actions (verificado)

| Ítem | Estado | Detalle / acción para la Fase 0 |
|------|--------|---------------------------------|
| `gh` CLI | ✅ **Ruta principal** | `gh` 2.96.0; login `DiegoRomanP` (keyring); git ops por **SSH**. Se usa para `gh repo create` y `gh release create`. |
| Token de `gh` (scopes) | ⚠️ **Sin `workflow`** | Scopes: `repo`, `admin:public_key`, `gist`, `read:org`. Pushear `.github/workflows/*` por API/HTTPS se rechaza ⇒ push por **git+SSH** (no valida scope) o `gh auth refresh -h github.com -s workflow`. |
| git local | ✅ | git 2.55; `user.name=Diego Roman`. El proyecto **aún no es** repo git. |
| SSH → GitHub | ✅ vía `gh` | `gh` usa SSH; `id_ed25519` con **passphrase** ⇒ `ssh-add` una vez por sesión para push no interactivo. |
| GitHub MCP | ✅ (secundario) | Respaldo; para workflows toparía con la misma falta de scope `workflow`. |
| Node / npm | ✅ | 26.4.0 / 11.18.0. |

La Fase 0 detalla las dos rutas de publicación y cómo desbloquear la SSH key.

---

## 8. Cómo usar estos documentos

1. Ejecuta las fases **en orden**; cada una asume que la anterior está "Done".
2. Cada documento tiene una **Definition of Done** (checklist) y una **Validación manual**: no pases de
   fase sin cumplirlas.
3. Cada fase = **1 commit/PR atómico** con el mensaje sugerido al final del documento.
4. Los puntos marcados con ⚠️ requieren **verificación contra la documentación oficial** en el momento de
   construir (por si la API de NVIDIA cambió respecto a julio 2026).
