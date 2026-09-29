import { defineConfig } from "vitest/config";

// Юнит-тесты — только чистая логика (без DOM), поэтому отдельный конфиг без плагинов Vite (PWA/React).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
