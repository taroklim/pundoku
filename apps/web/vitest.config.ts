import { defineConfig } from "vitest/config";

// Юнит-тесты: логика (node) и компоненты (jsdom, через docblock в файле); отдельный конфиг без плагинов Vite (PWA/React).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
