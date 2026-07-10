# Fase 0 — Setup del proyecto + CI (GitHub Actions)

> **Duración estimada:** 1–2 días. **IA:** ninguna. **Salida:** repo compilable, hot-reload en vault de
> pruebas, y pipeline de CI verde en cada push.

---

## 1. Objetivo
Dejar el esqueleto del plugin **compilando y cargando** en Obsidian, con la infraestructura de calidad
(lint, typecheck, tests, build) automatizada en **GitHub Actions**, y las reglas de seguridad de secretos
activas **desde el primer commit**.

## 2. Definition of Ready
- Node 20+ y npm disponibles (verificado: Node 26.4 / npm 11.18).
- Cuenta de GitHub con acceso (verificado: `DiegoRomanP` vía MCP).
- Un **vault de pruebas dedicado** (NUNCA el vault real). Sugerido: `~/ObsidianVaults/plugin-dev/`.

## 3. Alcance
**In:** estructura de carpetas, `package.json`, `tsconfig`, esbuild, ESLint/Prettier, Vitest, manifest,
`.gitignore`, 4 workflows de CI, `main.ts` mínimo que carga.
**Out:** cualquier lógica de negocio o IA (eso es Fase 1+).

## 4. Diseño técnico

### 4.1 Estructura inicial
```
extension-ia-obsidian/
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  .eslintrc.cjs
  .prettierrc
  vitest.config.ts
  .gitignore
  versions.json
  src/
    main.ts
  tests/
    smoke.test.ts
  .github/
    workflows/
      ci.yml
      codeql.yml
      secret-scan.yml
      release.yml
    dependabot.yml
  docs/plan/            # esta documentación
  plan.md
```

### 4.2 `manifest.json` (contrato con Obsidian)
```json
{
  "id": "context-ia-obsidian",
  "name": "Context IA",
  "version": "0.0.1",
  "minAppVersion": "1.5.0",
  "description": "Lee la nota activa y sus relaciones para resumir, explicar, investigar y generar imágenes con IA.",
  "author": "Diego Roman",
  "isDesktopOnly": true
}
```
> `isDesktopOnly: true` porque usamos `fs` (Node) para leer `.env`. En móvil no hay Node.

### 4.3 `package.json` (scripts y dependencias)
```jsonc
{
  "name": "context-ia-obsidian",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit && node esbuild.config.mjs production",
    "lint": "eslint . --ext .ts",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "obsidian": "latest",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "prettier": "^3.2.0",
    "vitest": "^1.4.0",
    "builtin-modules": "^3.3.0"
  }
}
```

### 4.4 `tsconfig.json` (estricto)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

### 4.5 `esbuild.config.mjs` (SIN inyección de secretos — ver SEGURIDAD.md)
```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  // ❌ NADA de `define` con secretos. Las claves se leen en runtime desde .env.
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```
> **Hot-reload:** instala el plugin de comunidad *Hot-Reload* en el vault de pruebas y crea un symlink de
> la carpeta del repo a `<test-vault>/.obsidian/plugins/context-ia-obsidian/`, o copia `main.js`+`manifest.json`
> con un script. Con `npm run dev` en watch, cada guardado recompila.

### 4.6 `main.ts` mínimo (verifica que carga)
```ts
import { Plugin } from "obsidian";

export default class ContextIaPlugin extends Plugin {
  async onload(): Promise<void> {
    console.info("[Context IA] cargado"); // sin secretos: seguro
  }
  async onunload(): Promise<void> {}
}
```

## 5. Pasos numerados
1. `mkdir -p src tests .github/workflows` y crear los archivos de config de §4.
2. `npm install` (genera `package-lock.json`).
3. Clonar la estructura del `obsidian-sample-plugin` como referencia si hace falta (esbuild, tipos).
4. Crear el **vault de pruebas** dedicado y el symlink/script de despliegue local.
5. `npm run dev` → abrir Obsidian → activar el plugin en el vault de pruebas.
6. Abrir la consola de Obsidian (`Ctrl+Shift+I`) y confirmar `"[Context IA] cargado"` sin errores.
7. Inicializar git y publicar (ver §10).

## 6. Frameworks / librerías (con versión)
Ver tabla en [`README.md §3`](./README.md). Todas devDependencies; el plugin no tiene dependencias de runtime
en esta fase (esbuild las bundlea).

## 7. Seguridad (de esta fase)
- Crear `.gitignore` (ver [`SEGURIDAD.md §4`](./SEGURIDAD.md)) **antes** del primer `git add`.
- Añadir el workflow `secret-scan.yml` (gitleaks) para que cualquier fuga futura se bloquee.
- Confirmar que `main.js` no contiene secretos (no aplican aún, pero el test de bundle queda listo).

## 8. Manejo de errores / edge cases
- Si el plugin no carga: revisar `manifest.json` (`id` único, `minAppVersion`) y la consola.
- Si `fs` falla en runtime: recordar `isDesktopOnly: true`.

## 9. Tests
`tests/smoke.test.ts` — prueba trivial que valida que Vitest corre en CI:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("el entorno de tests funciona", () => {
    expect(1 + 1).toBe(2);
  });
});
```
`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

## 10. CI/CD — GitHub Actions

### `ci.yml` — lint + typecheck + test + build en cada push/PR
```yaml
name: CI
on:
  push: { branches: ["main"] }
  pull_request: { branches: ["main"] }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - name: Verificar que el bundle no contiene secretos
        run: |
          if grep -R "nvapi-" main.js; then echo "❌ Secreto en bundle"; exit 1; fi
```

### `secret-scan.yml` — gitleaks
```yaml
name: Secret Scan
on: [push, pull_request]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
```

### `codeql.yml` — análisis de seguridad
```yaml
name: CodeQL
on:
  push: { branches: ["main"] }
  pull_request: { branches: ["main"] }
  schedule: [{ cron: "0 6 * * 1" }]
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions: { security-events: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: "javascript-typescript" }
      - uses: github/codeql-action/analyze@v3
```

### `release.yml` — build + GitHub Release en tag `v*` (convención Obsidian)
```yaml
name: Release
on:
  push: { tags: ["*"] }
permissions: { contents: write }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run build
      - name: Crear release con los artefactos del plugin
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          gh release create "$GITHUB_REF_NAME" \
            main.js manifest.json styles.css \
            --title "$GITHUB_REF_NAME" --generate-notes
```

### `dependabot.yml`
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "weekly" }
```

### Publicación del repo (con `gh` CLI — ruta principal)
`gh` 2.96.0 está instalado y autenticado (`DiegoRomanP`, keyring, git ops por **SSH**). Flujo recomendado:

```bash
# 0. Desbloquear la SSH key una vez por sesión (la key tiene passphrase)
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519

# 1. Inicializar git y primer commit local
git init && git add -A && git commit -m "chore: scaffold del plugin + CI"

# 2. Crear el repo en GitHub + remoto + push en un solo paso
gh repo create DiegoRomanP/context-ia-obsidian --private --source=. --remote=origin --push
```

> ⚠️ **Gotcha de scope `workflow` (verificado):** el token de `gh` **no tiene** el scope `workflow`
> (scopes: `repo`, `admin:public_key`, `gist`, `read:org`). Como `gh` está configurado para git ops por
> **SSH**, el `git push` sube los `.github/workflows/*` **sin problema** (SSH no valida el scope del token).
> Si en algún momento el push por HTTPS/API los rechaza (`refusing to allow ... workflow`), añade el scope:
> `gh auth refresh -h github.com -s workflow`.

**Release manual opcional** (además del workflow `release.yml`):
```bash
gh release create v0.1.0 main.js manifest.json styles.css --generate-notes
```

**Respaldo:** GitHub MCP (`create_repository` / `push_files`) sigue disponible como alternativa, con la misma
salvedad del scope `workflow` para los archivos de CI.

## 11. Definition of Done
- [ ] `npm run build` compila sin errores ni warnings.
- [ ] El plugin carga en el vault de pruebas y loguea `"[Context IA] cargado"`.
- [ ] `npm run lint`, `typecheck`, `test` pasan localmente.
- [ ] Repo creado; `ci.yml`, `secret-scan.yml`, `codeql.yml` **verdes** en GitHub.
- [ ] `.gitignore` protege `.env`/`data.json`/`main.js`; `git status` no los muestra.

## 12. Validación manual (del `plan.md`)
> "El plugin carga sin errores en consola de Obsidian (`Ctrl+Shift+I`)."

## 13. Commit / PR sugerido
```
chore: scaffold del plugin + CI (esbuild, eslint, vitest, GitHub Actions)

- Estructura ports & adapters, tsconfig estricto, manifest.
- Workflows: ci, secret-scan (gitleaks), codeql, release + dependabot.
- .gitignore protege secretos desde el commit 0.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación / rollback |
|--------|-----------------------|
| Token de `gh` sin scope `workflow` bloquea push de `.github/workflows/*` | `gh` usa **SSH** ⇒ el push pasa sin validar scope; si no, `gh auth refresh -h github.com -s workflow` (documentado en §10). |
| SSH key con passphrase bloquea push no interactivo | `ssh-add ~/.ssh/id_ed25519` al agente una vez por sesión. |
| Node 26 rompe alguna devDependency | CI fija Node 20 LTS; usar 20 localmente si algo falla. |
| Symlink de hot-reload no funciona en el SO | Script `cp main.js manifest.json <vault>/...` como fallback. |
