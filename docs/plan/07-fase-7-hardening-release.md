# Fase 7 — Hardening y release

> **IA:** ninguna nueva. Se endurecen las 4 acciones, se hace QA integral, y se prepara la publicación
> (SemVer, `CHANGELOG.md`, release automatizado, opcionalmente community plugins).

---

## 1. Objetivo
Llevar el plugin de "funciona en mi vault" a "publicable": robustez frente a uso real (doble-click,
inputs largos), calidad verificada, y proceso de release reproducible.

## 2. Definition of Ready
- Fases 0–6 "Done". Las 4 acciones funcionan y sus tests pasan.

## 3. Alcance
**In:** debounce/rate-limit de comandos, truncado defensivo de inputs, indicador de "generando…",
checklist de QA manual, `CHANGELOG.md`, SemVer, `versions.json`, workflow de release, guía de community plugins.
**Out:** features nuevas.

## 4. Diseño técnico

### 4.1 Rate limiting / debounce
Evitar golpear la API por doble-click. Un `debounce` o un flag "in-flight" por comando.
```ts
// src/utils/debounce.ts
export function once<T>(fn: () => Promise<T>): () => Promise<T | undefined> {
  let running = false;
  return async () => {
    if (running) return undefined; // ignora reentradas
    running = true;
    try { return await fn(); } finally { running = false; }
  };
}
```
Aplicar en `runAction` un guard por `commandId` (mapa `Set<string>` de comandos en vuelo) + un mínimo
intervalo entre llamadas (`MIN_ACTION_INTERVAL_MS` en constants).

### 4.2 Truncado defensivo de inputs
`buildSummaryPrompt`/`explain`/`research` recortan el contenido a `MAX_INPUT_CHARS` (constants) para no
exceder contexto ni disparar coste. Añadir aviso si se truncó.

### 4.3 Indicador de progreso
`Notice` persistente "⏳ Generando…" que se limpia al terminar (o un spinner en el modal). Mejora UX en
llamadas lentas.

### 4.4 Feedback de errores homogéneo
Revisar que **todos** los errores tipados tengan su rama en `runAction` y un icono/mensaje claro.

## 5. Pasos numerados
1. `once`/guard de reentrada + `MIN_ACTION_INTERVAL_MS`.
2. Truncado defensivo + aviso.
3. Indicador de progreso.
4. Pasar el **checklist de QA** (§8) en un vault limpio.
5. `CHANGELOG.md`, bump de versión, `versions.json`, tag `v0.1.0`.
6. Verificar el `release.yml` genera el GitHub Release con `main.js`/`manifest.json`/`styles.css`.
7. (Opcional) Preparar PR a `obsidianmd/obsidian-releases` para community plugins.

## 6. Frameworks / librerías
Sin deps nuevas. Se apoya en la infra de Fase 0 (`release.yml`, dependabot, CodeQL, gitleaks).

## 7. Seguridad (de esta fase)
- Repasar todo el [`SEGURIDAD.md`](./SEGURIDAD.md) como checklist final (secretos, bundle, logs, gitleaks).
- `npm audit --omit=dev` sin high/critical antes del tag.
- Confirmar que `main.js` publicado en el Release no contiene `nvapi-`/`tvly-` (paso de CI).
- Revisar que `.env`/`data.json` no estén en el árbol del repo ni en el Release.

## 8. QA manual (checklist sobre un vault limpio)
- [ ] **Resumir**: nota corta, nota larga (trunca con aviso), nota sin links.
- [ ] **Explicar**: selección válida, selección vacía (pide seleccionar), selección enorme.
- [ ] **Investigar**: tema con fuentes, tema oscuro sin fuentes (lo declara), sin `TAVILY_API_KEY`.
- [ ] **Imagen**: genera+inserta, doble-click (no duplica), respuesta grande (rechaza).
- [ ] **Settings**: cambia de `.env` a Secret Storage; key oculta; persiste tras reinicio.
- [ ] **Errores**: key inválida, wifi apagado, rate limit → cada uno su `Notice`.
- [ ] **Seguridad**: `console` sin secretos; `git status` sin `.env`/`data.json`.

## 9. Tests
- Añadir tests del guard de reentrada (`once` ignora la 2ª llamada concurrente) y del truncado.
- Asegurar cobertura de las ramas de error de `runAction`.
- (Opcional) Un test que carga el `main.js` compilado y hace `grep` de patrones de secreto (defensa en profundidad).

## 10. CI/CD
- `release.yml` (Fase 0) se dispara con el tag `v*` y publica los artefactos.
- Verificar que `ci.yml`, `codeql.yml`, `secret-scan.yml` están verdes antes del tag.
- `versions.json` mapea `pluginVersion → minAppVersion` (requisito de community plugins).

### Proceso de release
```bash
# 1. Actualizar version en manifest.json + package.json + versions.json (o script npm version)
# 2. Actualizar CHANGELOG.md
git commit -am "chore(release): v0.1.0"
git tag v0.1.0
git push origin main --tags   # dispara release.yml
```

## 11. Definition of Done
- [ ] Doble-click no dispara dos llamadas.
- [ ] Inputs largos se truncan con aviso.
- [ ] Checklist de QA (§8) completo en vault limpio.
- [ ] `CHANGELOG.md` y SemVer al día; `versions.json` correcto.
- [ ] Tag `v0.1.0` genera un GitHub Release con los 3 artefactos.
- [ ] `npm audit` y todos los workflows verdes.

## 12. Validación manual (del `plan.md`)
> "Checklist de QA manual sobre las 4 acciones + settings, en un vault limpio. Versionado semántico,
> `CHANGELOG.md`, submit a community plugins si quieres publicarlo."

## 13. Commit / PR sugerido
```
chore(release): hardening + v0.1.0

- Debounce/guard de reentrada; truncado defensivo; indicador de progreso.
- CHANGELOG, SemVer, versions.json; release automatizado por tag.
- QA integral y auditoría de seguridad final.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| Release sube artefacto con secreto | Paso de CI que grepea el bundle antes de publicar; revisión previa al tag. |
| Rechazo en community plugins | Seguir la guía oficial (manifest, `fundingUrl` opcional, sin telemetría); no bloquea el uso personal. |
| Regresión al endurecer | Suite de tests + QA manual antes del tag; rollback = borrar tag y Release. |

---

## Cierre del proyecto
Con la Fase 7 el plugin cumple la visión del `plan.md`: lee una nota y sus relaciones, y ofrece resumir,
explicar, investigar (con fuentes) y generar imágenes — todo con manejo de errores explícito, secretos
protegidos, arquitectura ports & adapters testeable, y entregas incrementales validadas (un commit/PR por fase).
