import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // "obsidian" solo existe en runtime dentro de la app real; en tests se mockea aquí.
    alias: { obsidian: `${dirname}/__mocks__/obsidian.ts` },
  },
});
