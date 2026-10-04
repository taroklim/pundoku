import type { ManifestOptions } from "vite-plugin-pwa";

/**
 * Иконки и манифест PWA — отдельным модулем, чтобы их читали и vite.config.ts, и тест
 * (scripts/icons.test.mjs проверяет ссылки, размеры PNG и охват maskable).
 *
 * ICON_VERSION — «версия кэша» иконок (PD-102 D5 -> PD-155 P4 «Девять клеток»): iOS и Cloudflare держат иконки по URL, а имена файлов
 * без хеша. Меняется вручную при смене иконки; тот же суффикс стоит в index.html (тест сверяет).
 * SW срезает параметр `v` при сопоставлении с precache (ignoreURLParametersMatching ниже), поэтому
 * иконки с `?v=` доступны офлайн так же, как без него.
 */
export const ICON_VERSION = "p4";

export const includeAssets = ["icons/icon.svg", "icons/favicon-16.png", "icons/favicon-32.png", "icons/apple-touch-icon-180.png"];

export const manifestIcons: NonNullable<ManifestOptions["icons"]> = [
  { src: `icons/icon-192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png" },
  { src: `icons/icon-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png" },
  // maskable = тот же icon-512: знак P4 целиком внутри круга 80 % (радиус 409.6 из 1024; замер ≈391.3, запас 18.3 — тест проверяет по пикселям).
  { src: `icons/icon-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/**
 * Манифест PWA (PD-132: `orientation: "portrait"` — решение владельца, ландшафт запрещён). Android/Chrome-PWA этому следуют;
 * iOS Safari/Home Screen — по MDN/BCD не поддерживает `orientation` и `screen.orientation.lock()` (см. README «Ориентация»),
 * поэтому на iPhone соблюдение манифеста проверяет владелец (research/usability-2026-10/ios-owner-steps.md, п. 21).
 */
export const webManifest: Partial<ManifestOptions> = {
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
};
