/** Ошибка конфигурации окружения: точка входа печатает только сообщение (без стека) и выходит с кодом 1. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
