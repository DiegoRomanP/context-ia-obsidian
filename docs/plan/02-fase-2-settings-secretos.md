# Fase 2 — Settings y manejo seguro de API keys

> **IA:** ninguna todavía. **Regla del `plan.md`:** *"Antes de escribir una sola llamada a IA, resuelve el
> guardado."* Esta fase implementa `SecretsPort` (`.env` + Secret Storage) y la pestaña de settings.
> Ver también [`SEGURIDAD.md`](./SEGURIDAD.md).

---

## 1. Objetivo
Que el plugin pueda obtener las claves (`NVIDIA_API_KEY`, `TAVILY_API_KEY`) de forma **segura** y que el
usuario configure preferencias, **sin** que la clave se filtre por logs, bundle o VCS.

## 2. Definition of Ready
- Fase 1 "Done".
- Decisión de secretos leída en [`SEGURIDAD.md §3`](./SEGURIDAD.md): `.env` (runtime) como opción principal
  del usuario + Secret Storage recomendado.

## 3. Alcance
**In:** `SecretsPort` + `DotenvSecretsAdapter` + `SettingsSecretsAdapter`, `PluginSettings` (DTO), `SettingsTab`
(campo password para ruta de `.env` / claves), persistencia, aviso de privacidad.
**Out:** cualquier request a la API de IA (Fase 3).

## 4. Diseño técnico

### 4.1 DTO de settings — `src/domain/models/PluginSettings.ts`
```ts
export type SecretSource = "dotenv" | "settings";

export interface PluginSettings {
  readonly secretSource: SecretSource;   // de dónde leer las claves
  readonly envPath: string;              // ruta del .env si secretSource === "dotenv"
  readonly baseUrl: string;              // https://integrate.api.nvidia.com/v1
  readonly textModel: string;            // deepseek-ai/deepseek-v4-flash
  readonly imageModel: string;           // qwen-image
  readonly reasoningEffort: "low" | "medium" | "high";
  readonly privacyAck: boolean;          // el usuario aceptó el aviso de envío de datos
}

export const DEFAULT_SETTINGS: PluginSettings = {
  secretSource: "dotenv",
  envPath: "",                           // vacío ⇒ carpeta del plugin
  baseUrl: "https://integrate.api.nvidia.com/v1",
  textModel: "deepseek-ai/deepseek-v4-flash",
  imageModel: "qwen-image",
  reasoningEffort: "high",
  privacyAck: false,
};
```
> `baseUrl`, `textModel`, `imageModel` viven en `config/constants.ts` como **defaults** (sin magic numbers) y
> se pueden sobreescribir en settings.

### 4.2 `SecretsPort` y adapters
Ver skeletons completos en [`SEGURIDAD.md §3`](./SEGURIDAD.md). Resumen:
- `DotenvSecretsAdapter(envPath)` — `fs.readFile` en runtime, parseo `KEY=VALUE`.
- `SettingsSecretsAdapter(app, plugin)` — Secret Storage API (v1.11+) o `data.json`.
- Un `CompositeSecretsAdapter` opcional que prueba `.env` y cae a settings.

### 4.3 Persistencia de settings
`data.json` guarda **sólo** settings NO sensibles (rutas, modelo, preferencias). Las **claves** nunca se
guardan en `data.json` cuando `secretSource === "dotenv"`. Métodos estándar de Obsidian:
```ts
async loadSettings() { this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) }; }
async saveSettings() { await this.saveData(this.settings); }
```

### 4.4 `SettingsTab` — `src/ui/SettingsTab.ts`
```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import type ContextIaPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ContextIaPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Aviso de privacidad (transparencia — ver SEGURIDAD.md §6)
    containerEl.createEl("p", {
      text: "Al usar las acciones de IA, el contenido relevante de tu nota se envía a NVIDIA NIM. " +
            "No lo uses con información sensible.",
    });

    new Setting(containerEl)
      .setName("Origen de las claves")
      .setDesc("dotenv (.env, recomendado) o settings (Secret Storage).")
      .addDropdown((d) => d
        .addOptions({ dotenv: ".env (archivo local)", settings: "Secret Storage" })
        .setValue(this.plugin.settings.secretSource)
        .onChange(async (v) => { this.plugin.settings = { ...this.plugin.settings, secretSource: v as any }; await this.plugin.saveSettings(); this.display(); }));

    if (this.plugin.settings.secretSource === "dotenv") {
      new Setting(containerEl)
        .setName("Ruta del .env")
        .setDesc("Vacío = carpeta del plugin. El archivo NO debe sincronizarse ni commitearse.")
        .addText((t) => t
          .setPlaceholder(".obsidian/plugins/context-ia-obsidian/.env")
          .setValue(this.plugin.settings.envPath)
          .onChange(async (v) => { this.plugin.settings = { ...this.plugin.settings, envPath: v.trim() }; await this.plugin.saveSettings(); }));
    } else {
      this.addSecretField(containerEl, "NVIDIA_API_KEY");
      this.addSecretField(containerEl, "TAVILY_API_KEY");
    }

    new Setting(containerEl)
      .setName("Esfuerzo de razonamiento")
      .addDropdown((d) => d.addOptions({ low: "low", medium: "medium", high: "high" })
        .setValue(this.plugin.settings.reasoningEffort)
        .onChange(async (v) => { this.plugin.settings = { ...this.plugin.settings, reasoningEffort: v as any }; await this.plugin.saveSettings(); }));
  }

  private addSecretField(el: HTMLElement, key: string): void {
    new Setting(el).setName(key).addText((t) => {
      t.inputEl.type = "password"; // ⬅️ oculto en UI
      t.setPlaceholder("nvapi-...").onChange(async (v) => {
        await this.plugin.secrets.set?.(key, v.trim()); // sólo en modo settings
      });
    });
  }
}
```
> Campo `type = "password"` (requisito del `plan.md`). Cuando `secretSource === "dotenv"` **no** se muestran
> campos de clave: viven en el `.env`.

## 5. Pasos numerados
1. `PluginSettings` + `DEFAULT_SETTINGS` + constantes en `config/constants.ts`.
2. `SecretsPort` y ambos adapters (código en SEGURIDAD.md).
3. `loadSettings`/`saveSettings` en `main.ts`; instanciar el adapter según `secretSource`.
4. `SettingsTab` y `addSettingTab`.
5. Crear un `.env` de prueba con una clave dummy y verificar que se lee.

## 6. Frameworks / librerías
API de Obsidian (`PluginSettingTab`, `Setting`, Secret Storage) + `fs/promises` (Node). Sin deps nuevas.

## 7. Seguridad (de esta fase) — núcleo del `plan.md`
- Campo de clave **password** (nunca texto plano visible).
- `.env` **fuera** de git (ya en `.gitignore` desde Fase 0). Aviso en UI de no sincronizarlo.
- La clave **nunca** se escribe en `data.json` en modo `.env`.
- **Nunca** `console.log(settings)`; si hay que loguear, redactar (`nvapi-***`).
- Aviso de privacidad visible (envío de datos a terceros).

## 8. Manejo de errores / edge cases
- `.env` inexistente / clave ausente → `secrets.get()` devuelve `null` → la Fase 3 mostrará "configura tu API key".
- Ruta de `.env` inválida → capturar y avisar, no crashear.
- Cambio de `secretSource` en caliente → `display()` refresca la UI.

## 9. Tests (Vitest)
- `DotenvSecretsAdapter`: dado un `.env` temporal con `NVIDIA_API_KEY=nvapi-abc`, `get` lo devuelve; con
  archivo ausente devuelve `null`; ignora comentarios y espacios.
- Test de **no-fuga**: `JSON.stringify(settings)` no contiene la clave cuando `secretSource === "dotenv"`.
```ts
it("lee la clave del .env y devuelve null si falta", async () => {
  const p = writeTmpEnv("NVIDIA_API_KEY=nvapi-abc\n# comentario\nX=1");
  const a = new DotenvSecretsAdapter(p);
  expect(await a.get("NVIDIA_API_KEY")).toBe("nvapi-abc");
  expect(await a.get("TAVILY_API_KEY")).toBeNull();
});
```

## 10. CI para la fase
`ci.yml` corre los tests nuevos. El paso `grep "nvapi-" main.js` de Fase 0 sigue garantizando que ninguna
clave entre al bundle.

## 11. Definition of Done
- [ ] La clave persiste tras reiniciar Obsidian (modo settings) / se lee del `.env` (modo dotenv).
- [ ] La clave **no** aparece en `console.log` ni en `data.json` (modo dotenv).
- [ ] Campo de clave oculto (password).
- [ ] Tests de secretos y de no-fuga verdes.

## 12. Validación manual (del `plan.md`)
> "La key nunca aparece en `console.log`; probar que el campo persiste tras reiniciar Obsidian."

## 13. Commit / PR sugerido
```
feat(settings): SecretsPort (.env + Secret Storage) y pestaña de settings

- PluginSettings inmutable; campo de clave password; aviso de privacidad.
- .env leído en runtime; nunca en data.json ni en el bundle.
- Tests de adapters y de no-fuga de secretos.
```

## 14. Riesgos y rollback
| Riesgo | Mitigación |
|--------|------------|
| Secret Storage no disponible (<1.11) | Fallback a data.json con advertencia; o forzar modo `.env`. |
| Usuario commitea `.env` igualmente | gitleaks en CI lo bloquea; aviso en UI. |
| Ruta de `.env` con permisos | `fs` lanza; se captura y se avisa sin exponer la ruta completa en logs públicos. |
