import { describe, expect, it, vi } from "vitest";
import { once } from "../src/utils/debounce";

describe("once", () => {
  it("ignora una reentrada mientras la llamada anterior sigue en curso", async () => {
    let resolveFirst!: () => void;
    const inner = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = () => resolve("ok");
        }),
    );
    const guarded = once(inner);

    const firstCall = guarded(); // arranca y queda pendiente
    const secondCall = guarded(); // reentrada mientras la primera sigue en curso

    expect(await secondCall).toBeUndefined(); // ignorada de inmediato
    resolveFirst();
    expect(await firstCall).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(1); // la reentrada nunca llamó a la función real
  });

  it("permite una nueva llamada una vez que la anterior terminó", async () => {
    const inner = vi.fn(async () => "ok");
    const guarded = once(inner);

    expect(await guarded()).toBe("ok");
    expect(await guarded()).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(2);
  });
});
