import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import path from "path";
import type { VaultPort } from "./domain/ports/VaultPort";
import type { SecretsPort } from "./domain/ports/SecretsPort";
import type { PluginSettings } from "./domain/models/PluginSettings";
import { DEFAULT_SETTINGS } from "./domain/models/PluginSettings";
import { NoteContextService } from "./services/NoteContextService";
import { DotenvSecretsAdapter } from "./secrets/DotenvSecretsAdapter";
import { SettingsSecretsAdapter } from "./secrets/SettingsSecretsAdapter";
import { ResultModal } from "./ui/ResultModal";
import { SettingsTab } from "./ui/SettingsTab";

export default class ContextIaPlugin extends Plugin {
  declare settings: PluginSettings;
  private vault!: VaultPort;

  async onload(): Promise<void> {
    console.info("[Context IA] cargado"); // sin secretos: seguro

    await this.loadSettings();
    this.vault = new NoteContextService(this.app);
    this.addSettingTab(new SettingsTab(this.app, this));

    this.addCommand({
      id: "show-note-context",
      name: "Mostrar contexto de la nota activa",
      callback: async () => {
        const ctx = await this.vault.getActiveNoteContext();
        if (!ctx) {
          new Notice("Abre una nota markdown primero.");
          return; // early return
        }
        new ResultModal(this.app, `Contexto: ${ctx.title}`, JSON.stringify(ctx, null, 2)).open();
      },
    });
  }

  async onunload(): Promise<void> {}

  /** Adapter de secretos vigente según settings.secretSource (DIP: los servicios solo ven SecretsPort). */
  get secrets(): SecretsPort {
    return this.settings.secretSource === "dotenv"
      ? new DotenvSecretsAdapter(this.resolveEnvPath())
      : new SettingsSecretsAdapter(this.app);
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<PluginSettings>) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateSettings(partial: Partial<PluginSettings>): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.saveSettings();
  }

  private resolveEnvPath(): string {
    const configured = this.settings.envPath.trim();
    if (configured) return configured;

    const adapter = this.app.vault.adapter;
    const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    return path.join(basePath, this.manifest.dir ?? "", ".env");
  }
}
