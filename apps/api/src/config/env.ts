import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана (см. .env.example в корне репо)`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  /** Читается лениво — /health и dev-запуск не должны падать без базы. */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  sudokuComBaseUrl: process.env.SUDOKU_COM_BASE_URL ?? "https://sudoku.com/api/v2",
} as const;
