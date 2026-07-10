import { App, Modal, Setting } from "obsidian";

export class PromptModal extends Modal {
  private value = "";
  private resolvePromise!: (value: string | null) => void;
  private resolved = false;

  private constructor(
    app: App,
    private readonly title: string,
    private readonly placeholder: string,
  ) {
    super(app);
  }

  /** Pide un texto al usuario; devuelve null si cancela o cierra el modal sin confirmar. */
  static open(app: App, title: string, placeholder = ""): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new PromptModal(app, title, placeholder);
      modal.resolvePromise = resolve;
      modal.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.title);

    new Setting(this.contentEl).addText((t) => {
      t.setPlaceholder(this.placeholder);
      t.inputEl.style.width = "100%";
      t.onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Aceptar").setCta().onClick(() => this.submit()))
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.resolvePromise(null); // cerrado sin confirmar (Esc, click fuera, etc.)
  }

  private submit(): void {
    this.resolved = true;
    this.resolvePromise(this.value.trim() || null);
    this.close();
  }
}
