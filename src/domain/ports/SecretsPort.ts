export type SecretKey = "NVIDIA_API_KEY" | "TAVILY_API_KEY";

export interface SecretsPort {
  /** Devuelve la clave o null si no está configurada. Nunca lanza por "no encontrada". */
  get(key: SecretKey): Promise<string | null>;
  /** Solo lo implementan los adapters que permiten escribir la clave desde la UI (modo settings). */
  set?(key: SecretKey, value: string): Promise<void>;
}
