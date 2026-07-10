import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import path from "path";
import type { VaultPort } from "./domain/ports/VaultPort";
import type { SecretsPort } from "./domain/ports/SecretsPort";
import type { LLMPort } from "./domain/ports/LLMPort";
import type { SearchPort } from "./domain/ports/SearchPort";
import type { PluginSettings } from "./domain/models/PluginSettings";
import { DEFAULT_SETTINGS } from "./domain/models/PluginSettings";
import { NoteContextService } from "./services/NoteContextService";
import { NvidiaLLMService } from "./services/NvidiaLLMService";
import { TavilySearchService } from "./services/TavilySearchService";
import { ResearchService } from "./services/ResearchService";
import { DotenvSecretsAdapter } from "./secrets/DotenvSecretsAdapter";
import { SettingsSecretsAdapter } from "./secrets/SettingsSecretsAdapter";
import { ResultModal } from "./ui/ResultModal";
import { SettingsTab } from "./ui/SettingsTab";
import { PromptModal } from "./ui/PromptModal";
import {
  InvalidKeyError,
  RateLimitError,
  NetworkError,
  EmptyResponseError,
  EmptySelectionError,
} from "./errors/ApiErrors";

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

    this.addCommand({
      id: "summarize-note",
      name: "Resumir nota activa con IA",
      callback: () =>
        this.runAction(async (vault, llm) => {
          const ctx = await vault.getActiveNoteContext();
          if (!ctx) throw new Error("Abre una nota markdown primero.");
          const body = await vault.readNote(ctx.path);
          const result = await llm.summarize(ctx, body);
          new ResultModal(this.app, `Resumen: ${ctx.title}`, result.text).open();
        }),
    });

    this.addCommand({
      id: "explain-selection",
      name: "Explicar selección con IA",
      editorCallback: (editor) =>
        this.runAction(async (vault, llm) => {
          const selection = editor.getSelection();
          const ctx = await vault.getActiveNoteContext();
          if (!ctx) throw new Error("Abre una nota markdown primero.");
          const result = await llm.explain(selection, ctx); // lanza EmptySelectionError si vacío
          new ResultModal(this.app, "Explicación", result.text).open();
        }),
    });

    this.addCommand({
      id: "research-topic",
      name: "Investigar tema con IA",
      callback: () =>
        this.runAction(async (_vault, llm, search) => {
          const topic = await PromptModal.open(
            this.app,
            "¿Qué quieres investigar?",
            "Ej: arquitectura hexagonal en TypeScript",
          );
          if (!topic) return; // cancelado, no es error

          const result = await new ResearchService(llm, search).research(topic);
          const body = result.citations.length
            ? result.answer
            : result.answer + "\n\n⚠️ Sin fuentes verificadas para este tema.";
          new ResultModal(
            this.app,
            `Investigación: ${topic}`,
            body,
            result.citations.map((c) => ({ title: c.title, url: c.url })),
          ).open();
        }),
    });
  }

  async onunload(): Promise<void> {}

  /** Adapter de secretos vigente según settings.secretSource (DIP: los servicios solo ven SecretsPort). */
  get secrets(): SecretsPort {
    return this.settings.secretSource === "dotenv"
      ? new DotenvSecretsAdapter(this.resolveEnvPath())
      : new SettingsSecretsAdapter(this.app);
  }

  /** Servicio de IA vigente según settings (baseUrl, modelo, esfuerzo de razonamiento). */
  get llm(): LLMPort {
    return new NvidiaLLMService(
      this.secrets,
      this.settings.baseUrl,
      this.settings.textModel,
      this.settings.reasoningEffort,
    );
  }

  /** Servicio de búsqueda vigente (usa TAVILY_API_KEY vía el mismo SecretsPort). */
  get search(): SearchPort {
    return new TavilySearchService(this.secrets);
  }

  /** Centraliza el manejo de errores de las acciones de IA: nunca un crash silencioso. */
  private async runAction(
    fn: (vault: VaultPort, llm: LLMPort, search: SearchPort) => Promise<void>,
  ): Promise<void> {
    try {
      await fn(this.vault, this.llm, this.search);
    } catch (e) {
      if (e instanceof InvalidKeyError) new Notice("🔑 " + e.message);
      else if (e instanceof RateLimitError) new Notice("⏳ " + e.message);
      else if (e instanceof NetworkError) new Notice("📡 " + e.message);
      else if (e instanceof EmptyResponseError) new Notice("🕳️ El modelo no devolvió contenido.");
      else if (e instanceof EmptySelectionError) new Notice("✍️ " + e.message);
      else new Notice("⚠️ " + (e as Error).message);
    }
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
