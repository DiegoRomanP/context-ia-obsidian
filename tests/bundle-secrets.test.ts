import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Defensa en profundidad adicional al chequeo real de ci.yml (que corre DESPUÉS del build).
// Aquí el test se salta si main.js no existe todavía (p.ej. en un checkout limpio antes de
// `npm run build`), ya que ci.yml ejecuta `test` antes que `build`.
const mainJsPath = join(__dirname, "..", "main.js");

describe.skipIf(!existsSync(mainJsPath))("bundle de producción (defensa en profundidad)", () => {
  it("no contiene patrones de secreto conocidos (nvapi-/tvly-)", () => {
    const content = readFileSync(mainJsPath, "utf8");
    expect(content).not.toMatch(/nvapi-[a-zA-Z0-9]/);
    expect(content).not.toMatch(/tvly-[a-zA-Z0-9]/);
  });
});
