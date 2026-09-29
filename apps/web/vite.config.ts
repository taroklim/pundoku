import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Автообновление: новый SW активируется сам, без промпта (workbox skipWaiting + clientsClaim).
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon-180.png"],
      manifest: {
        name: "Pundoku",
        short_name: "Pundoku",
        description: "Sudoku as a daily ritual.",
        lang: "en",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#FFFFFF",
        background_color: "#FFFFFF",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
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
