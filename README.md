# Context IA — Plugin de contexto + IA para Obsidian

[![CI](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/ci.yml)
[![CodeQL](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/codeql.yml/badge.svg)](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/codeql.yml)
[![Secret Scan](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/DiegoRomanP/context-ia-obsidian/actions/workflows/secret-scan.yml)
[![Release](https://img.shields.io/github/v/release/DiegoRomanP/context-ia-obsidian)](https://github.com/DiegoRomanP/context-ia-obsidian/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Plugin para [Obsidian](https://obsidian.md) que lee la nota activa y sus relaciones
(links salientes, backlinks, headings) y ofrece cuatro acciones de IA sobre ese
contexto: **resumir**, **explicar una selección**, **investigar un tema con fuentes
citadas** y **generar una imagen explicativa**.

Construido con TypeScript + esbuild siguiendo una arquitectura hexagonal
(*ports & adapters*), pensado para ser fácil de entender, extender y auditar en
seguridad.

---

## Índice

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación-para-desarrollo)
- [Configuración](#configuración)
- [Uso](#uso)
- [Seguridad](#seguridad)
- [Desarrollo](#desarrollo)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Estado del proyecto](#estado-del-proyecto)
- [Licencia](#licencia)

---

## Características

| Comando | Qué hace |
|---|---|
| **Mostrar contexto de la nota activa** | Extrae el grafo local de la nota (links salientes, backlinks, headings) y lo muestra como JSON. Sin IA, todo local. |
| **Resumir nota activa con IA** | Genera un resumen conciso (5-8 viñetas) del contenido de la nota. |
| **Explicar selección con IA** | Explica en detalle el fragmento de texto seleccionado en el editor. |
| **Investigar tema con IA** | Responde una pregunta de investigación usando *tool-calling* real: el modelo busca en la web y **cita sus fuentes** — nunca inserta una afirmación sin URL verificable. |
| **Generar imagen explicativa con IA** | Genera una imagen a partir de un prompt y la ancla en la nota como embed (`![[...]]`). |

Todas las acciones tienen manejo de errores explícito (key inválida, sin
conexión, rate limit, respuesta vacía) mostrado al usuario con `Notice` —
nunca un fallo silencioso — y protección contra doble-click / reentradas.

## Arquitectura

Separación estricta en capas (ports & adapters), donde el dominio y los
servicios **no dependen de la API de Obsidian**, lo que los hace testeables de
forma aislada:

```
src/
  main.ts              # Ciclo de vida del plugin, comandos, wiring (DI por constructor)
  domain/
    models/             # DTOs inmutables (NoteContext, SummaryResult, ResearchResult, ImageResult...)
    ports/               # Interfaces: VaultPort, SecretsPort, LLMPort, SearchPort, ImagePort
  services/              # Adapters que implementan los puertos (NvidiaLLMService, TavilySearchService...)
  secrets/               # Adapters de secretos (.env / Secret Storage nativo de Obsidian)
  ui/                    # Modals y pestaña de settings
  config/                # Constantes y definiciones de tools (sin magic numbers)
  errors/                # Errores tipados (InvalidKeyError, RateLimitError, NetworkError...)
  utils/                 # Utilidades puras (truncado, base64, saneo de nombres, debounce)
tests/                   # Espejo de src/, con la API de Obsidian mockeada
docs/plan/               # Documentación de diseño y planificación por fase
```

### Proveedor de IA

Todas las llamadas usan [NVIDIA NIM](https://build.nvidia.com) (API compatible
con OpenAI) vía `requestUrl` de Obsidian — nunca `fetch` ni un SDK propietario,
para evitar problemas de CORS:

| Función | Modelo |
|---|---|
| Resumir / Explicar / Investigar | `deepseek-ai/deepseek-v4-flash` |
| Generar imagen | `qwen/qwen-image` |
| Búsqueda web (soporte de Investigar) | [Tavily](https://tavily.com) |

## Requisitos

- [Obsidian](https://obsidian.md) **≥ 1.11.4** (requerido por la Secret Storage API nativa)
- Node.js **20+** para desarrollo
- Una clave de API de NVIDIA NIM (gratuita) y, opcionalmente, de Tavily (para Investigar)

## Instalación (para desarrollo)

Este repositorio está pensado para clonarse **directamente dentro de un vault
de pruebas** (nunca el vault real):

```bash
cd <tu-vault>/.obsidian/plugins/
git clone https://github.com/DiegoRomanP/context-ia-obsidian.git
cd context-ia-obsidian
npm install
npm run dev
```

Luego, en Obsidian: **Settings → Community plugins** → activa "Context IA".

## Configuración

Al abrir la pestaña de settings del plugin verás un aviso de privacidad: el
contenido relevante de tu nota se envía a NVIDIA NIM al usar las acciones de
IA — no lo uses con información sensible.

### Claves de API

Dos formas de configurarlas, elegibles desde settings:

1. **`.env` (recomendado para uso personal)** — crea un archivo `.env` en la
   carpeta del plugin (hay una plantilla en [`.env.example`](./.env.example)):

   ```env
   NVIDIA_API_KEY=nvapi-tu-clave-aqui
   TAVILY_API_KEY=tvly-tu-clave-aqui
   ```

   El archivo **nunca** se sube al repositorio (protegido por `.gitignore` y
   verificado en cada push por *secret scanning*).

2. **Secret Storage** — usa el almacén de secretos nativo de Obsidian
   (cifrado en el keychain de tu sistema operativo). Las claves se ingresan
   directamente en la UI de settings, en un campo oculto.

Ver el detalle completo del modelo de amenazas en
[`docs/plan/SEGURIDAD.md`](./docs/plan/SEGURIDAD.md).

## Uso

Todos los comandos están disponibles desde la paleta de comandos
(`Ctrl/Cmd + P`):

- `Context IA: Mostrar contexto de la nota activa`
- `Context IA: Resumir nota activa con IA`
- `Context IA: Explicar selección con IA` (selecciona texto primero)
- `Context IA: Investigar tema con IA` (pide el tema en un modal)
- `Context IA: Generar imagen explicativa con IA` (pide una descripción)

## Seguridad

- Las claves **nunca** se registran en logs ni se incluyen en el bundle
  compilado — verificado automáticamente en CI (gitleaks + `grep` sobre
  `main.js`) y en un test local de defensa en profundidad.
- `.env` / `data.json` / `main.js` están excluidos del control de versiones
  desde el primer commit.
- Loop de *tool-calling* (Investigar) acotado a un número máximo de
  iteraciones — sin ejecución de código devuelto por el modelo.
- Validación de tamaño de las imágenes generadas **antes** de escribir a
  disco (protección contra respuestas corruptas).
- Nombres de archivo saneados al guardar attachments (sin path traversal).
- `npm audit --omit=dev`: 0 vulnerabilidades en dependencias de producción.

## Desarrollo

```bash
npm run dev        # watch + rebuild en cada cambio
npm run build      # typecheck + build de producción
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (suite completa)
npm run test:watch  # Vitest en modo watch
```

La API de Obsidian se mockea en `__mocks__/obsidian.ts` (aliasado en
`vitest.config.ts`), por lo que los tests corren sin necesitar la aplicación
real instalada.

## Estructura del proyecto

Cada fase de construcción del plugin está documentada en detalle —
diseño técnico, decisiones de arquitectura, seguridad y criterios de
validación — en [`docs/plan/`](./docs/plan/), empezando por el
[índice](./docs/plan/README.md).

## Estado del proyecto

**v0.1.0** — primera versión funcional. Las 8 fases planeadas (0 a 7) están
completas: lectura de contexto, settings y secretos, las cuatro acciones de
IA, y hardening (debounce, truncado defensivo, indicador de progreso).

Ver [`CHANGELOG.md`](./CHANGELOG.md) para el historial de versiones y
[Releases](https://github.com/DiegoRomanP/context-ia-obsidian/releases) para
descargar una versión concreta.

## Licencia

[MIT](./LICENSE) © 2026 Diego Roman
