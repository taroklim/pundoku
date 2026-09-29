/**
 * Ошибка с HTTP-статусом и машинным кодом. Обработчик ошибок (middleware/error-handler.ts)
 * превращает её в JSON `{ error: { code, message } }` плюс необязательные доп. поля.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (code: string, message: string): HttpError => new HttpError(400, code, message);
export const unauthorized = (message = "Требуется токен устройства: Authorization: Bearer <deviceToken>"): HttpError =>
  new HttpError(401, "unauthorized", message);
export const notFound = (code: string, message: string): HttpError => new HttpError(404, code, message);
