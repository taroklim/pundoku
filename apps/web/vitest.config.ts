import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Юнит-тесты: логика (node) и компоненты (jsdom, через docblock в файле); отдельный конфиг без плагинов Vite (PWA/React).
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    passWithNoTests: true,
  },
});
