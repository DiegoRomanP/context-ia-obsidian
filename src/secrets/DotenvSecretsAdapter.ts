import { readFile } from "fs/promises";
import type { SecretKey, SecretsPort } from "../domain/ports/SecretsPort";

export class DotenvSecretsAdapter implements SecretsPort {
  constructor(private readonly envPath: string) {}

  async get(key: SecretKey): Promise<string | null> {
    let raw: string;
    try {
      raw = await readFile(this.envPath, "utf8");
    } catch {
      return null; // .env ausente ⇒ delega en el otro adapter / avisa en UI
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() === key) {
        return stripQuotes(trimmed.slice(eq + 1).trim());
      }
    }
    return null;
  }
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  const isQuoted = (first === '"' && last === '"') || (first === "'" && last === "'");
  return isQuoted ? value.slice(1, -1) : value;
}
