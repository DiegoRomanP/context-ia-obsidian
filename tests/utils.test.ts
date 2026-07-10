import { describe, expect, it } from "vitest";
import { sanitizeFileNamePart } from "../src/utils/sanitize";
import { base64ToBytes } from "../src/utils/base64";

describe("sanitizeFileNamePart", () => {
  it("reemplaza separadores de ruta y caracteres peligrosos", () => {
    expect(sanitizeFileNamePart("nota/con:caracteres*raros?")).toBe("nota_con_caracteres_raros_");
  });

  it("neutraliza intentos de path traversal", () => {
    expect(sanitizeFileNamePart("../../etc/passwd")).not.toContain("..");
  });

  it("devuelve un fallback si el resultado queda vacío", () => {
    expect(sanitizeFileNamePart("   ")).toBe("nota");
  });

  it("deja intacto un título normal", () => {
    expect(sanitizeFileNamePart("Arquitectura hexagonal")).toBe("Arquitectura hexagonal");
  });
});

describe("base64ToBytes", () => {
  it("decodifica correctamente una cadena base64 válida", () => {
    const original = "hola mundo";
    const b64 = Buffer.from(original).toString("base64");
    expect(Buffer.from(base64ToBytes(b64)).toString()).toBe(original);
  });

  it("devuelve un array vacío para una cadena vacía", () => {
    expect(base64ToBytes("").byteLength).toBe(0);
  });
});
