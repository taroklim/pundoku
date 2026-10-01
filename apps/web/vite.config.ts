import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import { includeAssets, manifestIcons } from "./pwa.config.ts";

// Версия приложения для Settings → About (PD-102): одна правда — package.json этого пакета.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // Автообновление: новый SW активируется сам, без промпта (workbox skipWaiting + clientsClaim).
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets,
      manifest: {
        name: "Pundoku",
        short_name: "Pundoku",
        description: "Sudoku as a daily ritual.",
        lang: "en",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#F2F2F7",
        background_color: "#F2F2F7",
        icons: manifestIcons,
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        // API — не страница: навигация на /api/* не должна отдавать index.html из SW.
        navigateFallbackDenylist: [/^\/api\//],
        // Иконки подключены как `icons/x.png?v=<ICON_VERSION>` (pwa.config.ts): без этого офлайн-запрос мимо precache.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
      },
      devOptions: {
        // SW в dev выключен — iOS-проверки офлайна делаются на `vite preview` реальной сборки.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // Доступ с iPhone в одной сети: `pnpm dev:web -- --host`.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
