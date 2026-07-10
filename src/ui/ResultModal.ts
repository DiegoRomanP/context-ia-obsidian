import { App, Modal } from "obsidian";

export interface ModalCitation {
  readonly title: string;
  readonly url: string;
}

export class ResultModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly body: string,
    private readonly citations: readonly ModalCitation[] = [],
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    const pre = this.contentEl.createEl("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.setText(this.body);

    if (this.citations.length > 0) {
      this.contentEl.createEl("h4", { text: "Fuentes" });
      const list = this.contentEl.createEl("ul");
      for (const c of this.citations) {
        const item = list.createEl("li");
        item.createEl("a", {
          text: c.title,
          href: c.url,
          attr: { target: "_blank", rel: "noopener noreferrer" },
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
