import { describe, expect, it } from "vitest";
import { truncateText } from "../src/utils/truncate";

describe("truncateText", () => {
  it("no trunca si el texto ya cabe en el límite", () => {
    const result = truncateText("hola", 10);
    expect(result).toEqual({ text: "hola", truncated: false });
  });

  it("trunca y marca truncated=true si el texto excede el límite", () => {
    const result = truncateText("0123456789ABCDEF", 10);
    expect(result.text).toBe("0123456789");
    expect(result.truncated).toBe(true);
  });

  it("un texto exactamente del tamaño límite no se marca como truncado", () => {
    const result = truncateText("0123456789", 10);
    expect(result).toEqual({ text: "0123456789", truncated: false });
  });
});
