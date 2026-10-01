/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL API (`apps/api`), без завершающего слэша. Пусто — тот же origin (dev-прокси Vite `/api`). */
  readonly VITE_API_BASE_URL?: string;
}

/** Версия приложения из apps/web/package.json (vite.config.ts `define`, vitest.config.ts). */
declare const __APP_VERSION__: string;
