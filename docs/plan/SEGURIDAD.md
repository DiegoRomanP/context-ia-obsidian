# SEGURIDAD — Manejo de secretos y modelo de amenazas

> Documento transversal referenciado por todas las fases. Reúne las decisiones de seguridad para no
> repetirlas (DRY). El requisito del usuario es claro: **las claves viven en `.env` para que no se filtren**.
> Aquí se traduce ese requisito en controles concretos.

---

## 1. Activos a proteger

| Activo | Dónde vive | Impacto si se filtra |
|--------|------------|----------------------|
| `NVIDIA_API_KEY` (`nvapi-...`) | `.env` (dev) / Secret Storage (distribución) | Uso no autorizado de la cuota / cuenta NVIDIA. |
| `TAVILY_API_KEY` (u otra búsqueda) | igual | Uso no autorizado de la cuota de búsqueda. |
| Contenido de las notas del usuario | Vault local | Privacidad: se **envían** fragmentos a la API de IA al usar acciones. |

---

## 2. Modelo de amenazas (STRIDE resumido)

| Amenaza | Escenario | Mitigación |
|---------|-----------|------------|
| **Fuga de secreto por VCS** | Commit accidental de `.env`/`data.json` | `.gitignore` desde el commit 0 + **gitleaks** en CI que bloquea el push/PR. |
| **Fuga de secreto por bundle** | esbuild hornea la key en `main.js` publicado | **Prohibido** `define`/inline de secretos: se leen en **runtime**. Test que grepea el bundle. |
| **Fuga por logs** | `console.log(settings)` imprime la key | Nunca loguear objetos de settings/secretos. Redacción (`nvapi-***`). Regla ESLint/revisión. |
| **Exfiltración por endpoint atacante** | El usuario pega una Base URL maliciosa | Validar que la URL sea `https` y (por defecto) del host esperado; advertir si se cambia. |
| **DoS local (llenar el vault)** | Respuesta binaria enorme/corrupta se escribe a disco | Límite de tamaño **antes** de `vault.createBinary()` (Fase 6). |
| **Privacidad de notas** | El usuario no sabe que su nota se envía a un tercero | Aviso claro en Settings + primer uso; enviar sólo el contexto necesario. |
| **Man-in-the-middle** | Interceptar la request | Sólo `https`; `requestUrl` valida TLS del sistema. |

---

## 3. Estrategia de secretos (arquitectura)

Puerto único `SecretsPort` con **dos adapters** intercambiables:

```ts
// src/domain/ports/SecretsPort.ts
export interface SecretsPort {
  /** Devuelve la clave o null si no está configurada. Nunca lanza por "no encontrada". */
  get(key: SecretKey): Promise<string | null>;
}

export type SecretKey = "NVIDIA_API_KEY" | "TAVILY_API_KEY";
```

### 3.1 `DotenvSecretsAdapter` (dev / uso personal — requisito del usuario)
- Lee un archivo `.env` **en runtime** con el módulo `fs` de Node (los plugins de Obsidian corren en el
  renderer de Electron con integración de Node ⇒ `fs` disponible).
- Ubicación del `.env`: configurable en Settings; por defecto la **carpeta del plugin**
  (`<vault>/.obsidian/plugins/<id>/.env`) o una ruta absoluta indicada por el usuario.
- Parseo mínimo propio (no hace falta la dependencia `dotenv`): `KEY=VALUE`, ignora comentarios `#` y líneas vacías.
- **Nunca** se cachea el valor en un log; se mantiene en memoria sólo durante la llamada.

```ts
// src/secrets/DotenvSecretsAdapter.ts (skeleton)
import { readFile } from "fs/promises";

export class DotenvSecretsAdapter implements SecretsPort {
  constructor(private readonly envPath: string) {}

  async get(key: SecretKey): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.envPath, "utf8");
    } catch {
      return null; // .env ausente ⇒ delega en el otro adapter / avisa en UI
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() === key) {
        return stripQuotes(trimmed.slice(eq + 1).trim());
      }
    }
    return null;
  }
}
```

### 3.2 `SettingsSecretsAdapter` (recomendado para distribución)
- Usa la **Secret Storage API** de Obsidian (v1.11+), que guarda cifrado en el keychain del SO.
- Fallback a `data.json` **sólo** si Secret Storage no está disponible, **advirtiendo** al usuario de no
  sincronizar/commitear ese archivo.

### 3.3 Composición
`main.ts` decide el orden (p. ej. intentar `.env`, luego Secret Storage) y cablea el adapter. Los servicios
sólo reciben `SecretsPort` — no saben de dónde viene la clave (DIP).

---

## 4. Reglas anti-fuga (checklist para cada PR)

- [ ] `.env`, `data.json`, `main.js`, `node_modules/`, y el vault de pruebas están en `.gitignore`.
- [ ] No hay `console.log`/`console.debug` que imprima settings o secretos.
- [ ] esbuild **no** usa `define`/`--define` para inyectar claves (test que grepea `nvapi-` en `main.js`).
- [ ] Los mensajes de error al usuario (`Notice`) **no** incluyen la clave ni la URL con token.
- [ ] `gitleaks` pasa en CI.
- [ ] `npm audit --omit=dev` sin vulnerabilidades **high/critical** (o justificadas).

### `.gitignore` mínimo
```gitignore
node_modules/
main.js
*.js.map
.env
.env.*
data.json
/test-vault/
.DS_Store
```

---

## 5. Controles en CI (detalle en Fase 0 y Fase 7)

| Workflow | Herramienta | Qué previene |
|----------|-------------|--------------|
| `secret-scan.yml` | **gitleaks** | Bloquea PRs con secretos en el diff. |
| `codeql.yml` | **CodeQL** (JS/TS) | Vulnerabilidades de código (inyección, etc.). |
| `ci.yml` (paso audit) | `npm audit` + `dependabot` | Dependencias vulnerables. |

---

## 6. Privacidad del usuario (transparencia)

- En Settings, un texto fijo: *"Al usar las acciones de IA, el contenido relevante de tu nota se envía a
  NVIDIA NIM (y, para Investigar, a la API de búsqueda). No lo uses con información sensible."*
- Enviar **sólo** el contexto necesario (nota activa + relaciones, no todo el vault).
- Sin telemetría propia. Sin llamadas de red fuera de las acciones explícitas del usuario.
