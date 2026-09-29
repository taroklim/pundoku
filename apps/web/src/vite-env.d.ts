/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL API (`apps/api`), без завершающего слэша. Пусто — тот же origin (dev-прокси Vite `/api`). */
  readonly VITE_API_BASE_URL?: string;
}
