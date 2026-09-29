import { ConfigError } from "./config/errors.js";

// Тонкая точка входа: неверная конфигурация окружения — не баг, а ошибка оператора, поэтому вместо
// стека с внутренностями модулей печатается одно понятное сообщение. Остальные ошибки летят как есть.
try {
  await import("./main.js");
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[pundoku-api] Ошибка конфигурации: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
