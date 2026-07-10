# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [0.1.0] - 2026-07-10

Primera versión funcional del plugin: lee la nota activa y sus relaciones, y ofrece
cuatro acciones de IA (resumir, explicar, investigar con fuentes citadas, generar
imagen) sobre NVIDIA NIM (`deepseek-v4-flash` + `qwen-image`).

### Añadido

- **Contexto de nota**: comando que arma el grafo local (links salientes, backlinks,
  headings) vía `metadataCache`/`resolvedLinks` y lo muestra en un modal JSON.
- **Settings y secretos**: `SecretsPort` con dos adapters — `.env` en runtime
  (`DotenvSecretsAdapter`) o el `SecretStorage` nativo de Obsidian ≥1.11.4, cifrado
  en el keychain del sistema (`SettingsSecretsAdapter`). Pestaña de settings con
  aviso de privacidad y campo de clave oculto (`SecretComponent`).
- **Resumir nota**: `NvidiaLLMService.summarize()` vía `requestUrl` (sin SDK),
  con timeout manual, errores tipados por cada modo de fallo (key inválida,
  rate limit, sin conexión, respuesta vacía, error del servidor).
- **Explicar selección**: reutiliza el mismo servicio y `SummaryResult`.
  Maneja selección vacía sin fallar.
- **Investigar tema**: loop de tool-calling acotado (`ResearchService` +
  `TavilySearchService`) con citas verificables — nunca inserta una fuente
  sin marcar su origen.
- **Generar imagen**: `NvidiaImageService` con `qwen/qwen-image`, decodificación
  base64 y validación de tamaño (15 MB) antes de escribir a disco; se ancla en
  la nota como embed `![[...]]` con nombre de archivo saneado.
- **Hardening**: guard de reentrada por comando (evita doble-click), truncado
  defensivo de inputs largos con aviso al usuario, indicador de progreso
  persistente durante cada llamada a la IA.
- **CI/CD**: lint + typecheck + tests + build en cada push/PR, CodeQL,
  gitleaks (secret scanning), Dependabot, release automatizado por tag.

### Seguridad

- Las claves nunca se registran en logs ni se incluyen en el bundle (verificado
  en CI: `grep` de `nvapi-`/`tvly-` sobre `main.js`, más un test local de
  defensa en profundidad).
- `.env`/`data.json`/`main.js` protegidos por `.gitignore` desde el primer commit.
- `npm audit --omit=dev`: 0 vulnerabilidades en dependencias de producción.

[0.1.0]: https://github.com/DiegoRomanP/context-ia-obsidian/releases/tag/v0.1.0
