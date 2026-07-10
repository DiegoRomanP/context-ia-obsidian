import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type ContextIaPlugin from "../main";
import type { ReasoningEffort, SecretSource } from "../domain/models/PluginSettings";
import type { SecretKey } from "../domain/ports/SecretsPort";

export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ContextIaPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Aviso de privacidad (transparencia — ver docs/plan/SEGURIDAD.md §6)
    containerEl.createEl("p", {
      text:
        "Al usar las acciones de IA, el contenido relevante de tu nota se envía a NVIDIA NIM. " +
        "No lo uses con información sensible.",
    });

    new Setting(containerEl)
      .setName("Origen de las claves")
      .setDesc("dotenv (.env, recomendado) o settings (Secret Storage cifrado del sistema).")
      .addDropdown((d) =>
        d
          .addOptions({ dotenv: ".env (archivo local)", settings: "Secret Storage" })
          .setValue(this.plugin.settings.secretSource)
          .onChange(async (v) => {
            await this.plugin.updateSettings({ secretSource: v as SecretSource });
            this.display();
          }),
      );

    if (this.plugin.settings.secretSource === "dotenv") {
      new Setting(containerEl)
        .setName("Ruta del .env")
        .setDesc("Vacío = carpeta del plugin. El archivo NO debe sincronizarse ni commitearse.")
        .addText((t) =>
          t
            .setPlaceholder(".obsidian/plugins/context-ia-obsidian/.env")
            .setValue(this.plugin.settings.envPath)
            .onChange(async (v) => {
              await this.plugin.updateSettings({ envPath: v.trim() });
            }),
        );
    } else {
      this.addSecretField(containerEl, "NVIDIA_API_KEY");
      this.addSecretField(containerEl, "TAVILY_API_KEY");
    }

    new Setting(containerEl)
      .setName("Esfuerzo de razonamiento")
      .setDesc("Controla cuánto \"piensa\" el modelo antes de responder (deepseek-v4-flash).")
      .addDropdown((d) =>
        d
          .addOptions({ none: "none (rápido)", high: "high (por defecto)", max: "max (más profundo)" })
          .setValue(this.plugin.settings.reasoningEffort)
          .onChange(async (v) => {
            await this.plugin.updateSettings({ reasoningEffort: v as ReasoningEffort });
          }),
      );
  }

  private addSecretField(containerEl: HTMLElement, key: SecretKey): void {
    new Setting(containerEl)
      .setName(key)
      .setDesc("Se guarda cifrado en el keychain del sistema operativo (Secret Storage).")
      .addComponent((el) => {
        const component = new SecretComponent(this.app, el);
        component.onChange(async (value) => {
          await this.plugin.secrets.set?.(key, value.trim());
        });
        return component;
      });
  }
}
