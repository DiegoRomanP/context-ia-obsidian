import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import path from "path";
import type { VaultPort } from "./domain/ports/VaultPort";
import type { SecretsPort } from "./domain/ports/SecretsPort";
import type { LLMPort } from "./domain/ports/LLMPort";
import type { SearchPort } from "./domain/ports/SearchPort";
import type { ImagePort } from "./domain/ports/ImagePort";
import type { NoteContext } from "./domain/models/NoteContext";
import type { ImageResult } from "./domain/models/ImageResult";
import type { PluginSettings } from "./domain/models/PluginSettings";
import { DEFAULT_SETTINGS } from "./domain/models/PluginSettings";
import { NoteContextService } from "./services/NoteContextService";
import { NvidiaLLMService } from "./services/NvidiaLLMService";
import { TavilySearchService } from "./services/TavilySearchService";
import { ResearchService } from "./services/ResearchService";
import { NvidiaImageService } from "./services/NvidiaImageService";
import { DotenvSecretsAdapter } from "./secrets/DotenvSecretsAdapter";
import { SettingsSecretsAdapter } from "./secrets/SettingsSecretsAdapter";
import { ResultModal } from "./ui/ResultModal";
import { SettingsTab } from "./ui/SettingsTab";
import { PromptModal } from "./ui/PromptModal";
import { sanitizeFileNamePart } from "./utils/sanitize";
import { MIN_ACTION_INTERVAL_MS, DEFAULT_IMAGE_BASE_URL } from "./config/constants";
import {
  InvalidKeyError,
  RateLimitError,
  NetworkError,
  EmptyResponseError,
  EmptySelectionError,
  PayloadTooLargeError,
} from "./errors/ApiErrors";

const TRUNCATED_NOTICE = "\n\n⚠️ El contenido de entrada se truncó (era demasiado largo).";

export default class ContextIaPlugin extends Plugin {
  declare settings: PluginSettings;
  private vault!: VaultPort;
  private readonly inFlightCommands = new Set<string>();
  private readonly lastRunAt = new Map<string, number>();

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
        this.runAction("summarize-note", async (vault, llm) => {
          const ctx = await vault.getActiveNoteContext();
          if (!ctx) throw new Error("Abre una nota markdown primero.");
          const body = await vault.readNote(ctx.path);
          const result = await llm.summarize(ctx, body);
          const text = result.truncated ? result.text + TRUNCATED_NOTICE : result.text;
          new ResultModal(this.app, `Resumen: ${ctx.title}`, text).open();
        }),
    });

    this.addCommand({
      id: "explain-selection",
      name: "Explicar selección con IA",
      editorCallback: (editor) =>
        this.runAction("explain-selection", async (vault, llm) => {
          const selection = editor.getSelection();
          const ctx = await vault.getActiveNoteContext();
          if (!ctx) throw new Error("Abre una nota markdown primero.");
          const result = await llm.explain(selection, ctx); // lanza EmptySelectionError si vacío
          const text = result.truncated ? result.text + TRUNCATED_NOTICE : result.text;
          new ResultModal(this.app, "Explicación", text).open();
        }),
    });

    this.addCommand({
      id: "research-topic",
      name: "Investigar tema con IA",
      callback: () =>
        this.runAction("research-topic", async (_vault, llm, search) => {
          const topic = await PromptModal.open(
            this.app,
            "¿Qué quieres investigar?",
            "Ej: arquitectura hexagonal en TypeScript",
          );
          if (!topic) return; // cancelado, no es error

          const result = await new ResearchService(llm, search).research(topic);
          let body = result.citations.length
            ? result.answer
            : result.answer + "\n\n⚠️ Sin fuentes verificadas para este tema.";
          if (result.truncated) body += TRUNCATED_NOTICE;
          new ResultModal(
            this.app,
            `Investigación: ${topic}`,
            body,
            result.citations.map((c) => ({ title: c.title, url: c.url })),
          ).open();
        }),
    });

    this.addCommand({
      id: "generate-image",
      name: "Generar imagen explicativa con IA",
      callback: () =>
        this.runAction("generate-image", async (vault, _llm, _search, images) => {
          const ctx = await vault.getActiveNoteContext();
          if (!ctx) throw new Error("Abre una nota markdown primero.");
          const prompt = await PromptModal.open(
            this.app,
            "Describe la imagen a generar",
            `Diagrama explicativo de: ${ctx.title}`,
          );
          if (!prompt) return; // cancelado
          const result = await images.generate(prompt, "1024x1024");
          await this.insertImage(result, ctx);
          new Notice("🖼️ Imagen insertada.");
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

  /**
   * Servicio de generación de imágenes vigente. Usa un host DISTINTO al de llm/search:
   * los modelos de imagen de NVIDIA ("Visual GenAI") se sirven en ai.api.nvidia.com,
   * no en el host OpenAI-compatible de chat/completions.
   */
  get images(): ImagePort {
    return new NvidiaImageService(this.secrets, DEFAULT_IMAGE_BASE_URL, this.settings.imageModel);
  }

  /**
   * Centraliza el manejo de errores de las acciones de IA (nunca un crash silencioso) y las
   * endurece contra doble-click: ignora reentradas del mismo comando mientras está en curso, y
   * exige un intervalo mínimo entre ejecuciones consecutivas del mismo comando.
   */
  private async runAction(
    commandId: string,
    fn: (vault: VaultPort, llm: LLMPort, search: SearchPort, images: ImagePort) => Promise<void>,
  ): Promise<void> {
    if (this.inFlightCommands.has(commandId)) return; // ya en curso: ignora el doble-click
    const lastRun = this.lastRunAt.get(commandId) ?? 0;
    if (Date.now() - lastRun < MIN_ACTION_INTERVAL_MS) return; // demasiado pronto: ignora

    this.inFlightCommands.add(commandId);
    const progress = new Notice("⏳ Generando…", 0); // 0 = persistente hasta hide()
    try {
      await fn(this.vault, this.llm, this.search, this.images);
    } catch (e) {
      if (e instanceof InvalidKeyError) new Notice("🔑 " + e.message);
      else if (e instanceof RateLimitError) new Notice("⏳ " + e.message);
      else if (e instanceof NetworkError) new Notice("📡 " + e.message);
      else if (e instanceof EmptyResponseError) new Notice("🕳️ El modelo no devolvió contenido.");
      else if (e instanceof EmptySelectionError) new Notice("✍️ " + e.message);
      else if (e instanceof PayloadTooLargeError) new Notice("📦 " + e.message);
      else new Notice("⚠️ " + (e as Error).message);
    } finally {
      progress.hide();
      this.lastRunAt.set(commandId, Date.now());
      this.inFlightCommands.delete(commandId);
    }
  }

  /** Guarda la imagen como attachment saneado y la ancla en la nota como embed. */
  private async insertImage(result: ImageResult, ctx: NoteContext): Promise<void> {
    const folder = "attachments";
    await this.app.vault.adapter.mkdir(folder).catch(() => {}); // idempotente
    const safeTitle = sanitizeFileNamePart(ctx.title);
    const ext = result.mimeType === "image/png" ? "png" : "jpg";
    const name = `${folder}/ia-${safeTitle}-${Date.now()}.${ext}`;
    // .slice() copia los bytes a un ArrayBuffer propio (offset 0, longitud exacta): evita escribir
    // el pool interno de Node completo si Buffer.from reusó un buffer compartido más grande.
    await this.app.vault.createBinary(name, result.bytes.slice().buffer as ArrayBuffer);
    const editor = this.app.workspace.activeEditor?.editor;
    editor?.replaceSelection(`\n![[${name}]]\n`);
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
