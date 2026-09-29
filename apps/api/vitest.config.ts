import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Тесты идут по исходникам движка — не зависят от `pnpm build` (как и typecheck, см. tsconfig.json).
    alias: { "@pundoku/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
