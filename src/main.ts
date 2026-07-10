import { Plugin } from "obsidian";

export default class ContextIaPlugin extends Plugin {
  async onload(): Promise<void> {
    console.info("[Context IA] cargado"); // sin secretos: seguro
  }

  async onunload(): Promise<void> {}
}
