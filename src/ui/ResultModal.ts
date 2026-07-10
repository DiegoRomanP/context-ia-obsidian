import { App, Modal } from "obsidian";

export class ResultModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly body: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    const pre = this.contentEl.createEl("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.setText(this.body);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
