import type { App } from "obsidian";
import type { SecretKey, SecretsPort } from "../domain/ports/SecretsPort";

/**
 * Usa la Secret Storage API nativa de Obsidian (app.secretStorage, desde 1.11.4),
 * que persiste cifrado en el keychain del sistema operativo. Nunca toca data.json.
 */
export class SettingsSecretsAdapter implements SecretsPort {
  constructor(private readonly app: App) {}

  async get(key: SecretKey): Promise<string | null> {
    return this.app.secretStorage.getSecret(toSecretId(key));
  }

  async set(key: SecretKey, value: string): Promise<void> {
    this.app.secretStorage.setSecret(toSecretId(key), value);
  }
}

function toSecretId(key: SecretKey): string {
  // SecretStorage exige IDs alfanuméricos en minúsculas con guiones (sin guion bajo).
  return key.toLowerCase().replace(/_/g, "-");
}
