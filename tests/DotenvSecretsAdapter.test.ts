import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DotenvSecretsAdapter } from "../src/secrets/DotenvSecretsAdapter";
import { DEFAULT_SETTINGS } from "../src/domain/models/PluginSettings";

let tmpDir: string | undefined;

function writeTmpEnv(content: string): string {
  tmpDir = mkdtempSync(join(tmpdir(), "context-ia-test-"));
  const envPath = join(tmpDir, ".env");
  writeFileSync(envPath, content, "utf8");
  return envPath;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("DotenvSecretsAdapter", () => {
  it("lee la clave del .env y devuelve null si falta", async () => {
    const p = writeTmpEnv("NVIDIA_API_KEY=nvapi-abc\n# comentario\nX=1");
    const a = new DotenvSecretsAdapter(p);
    expect(await a.get("NVIDIA_API_KEY")).toBe("nvapi-abc");
    expect(await a.get("TAVILY_API_KEY")).toBeNull();
  });

  it("devuelve null si el archivo .env no existe", async () => {
    const a = new DotenvSecretsAdapter(join(tmpdir(), "no-existe-context-ia", ".env"));
    expect(await a.get("NVIDIA_API_KEY")).toBeNull();
  });

  it("ignora comentarios y líneas vacías, recorta espacios y quita comillas", async () => {
    const p = writeTmpEnv(
      ["# archivo de prueba", "", '  NVIDIA_API_KEY = "nvapi-con-espacios"  ', "TAVILY_API_KEY='tvly-comillas'"].join(
        "\n",
      ),
    );
    const a = new DotenvSecretsAdapter(p);
    expect(await a.get("NVIDIA_API_KEY")).toBe("nvapi-con-espacios");
    expect(await a.get("TAVILY_API_KEY")).toBe("tvly-comillas");
  });
});

describe("no-fuga de secretos", () => {
  it("JSON.stringify(settings) no contiene la clave cuando secretSource === 'dotenv'", () => {
    const settings = { ...DEFAULT_SETTINGS, secretSource: "dotenv" as const };
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain("nvapi-");
    expect(serialized).not.toContain("tvly-");
  });
});
