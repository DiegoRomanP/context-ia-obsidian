import { DEFAULT_BASE_URL, DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "../../config/constants";

export type SecretSource = "dotenv" | "settings";
export type ReasoningEffort = "low" | "medium" | "high";

export interface PluginSettings {
  readonly secretSource: SecretSource; // de dónde leer las claves
  readonly envPath: string; // ruta del .env si secretSource === "dotenv"
  readonly baseUrl: string; // https://integrate.api.nvidia.com/v1
  readonly textModel: string; // deepseek-ai/deepseek-v4-flash
  readonly imageModel: string; // qwen-image
  readonly reasoningEffort: ReasoningEffort;
  readonly privacyAck: boolean; // el usuario aceptó el aviso de envío de datos
}

export const DEFAULT_SETTINGS: PluginSettings = {
  secretSource: "dotenv",
  envPath: "", // vacío ⇒ carpeta del plugin
  baseUrl: DEFAULT_BASE_URL,
  textModel: DEFAULT_TEXT_MODEL,
  imageModel: DEFAULT_IMAGE_MODEL,
  reasoningEffort: "high",
  privacyAck: false,
};
