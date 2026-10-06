export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details, code = "VALIDATION_ERROR") => new AppError(400, code, message, details);
export const unauthenticated = (message = "Sign in required") => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message, code = "CONFLICT") => new AppError(409, code, message);

export class IntegrationError extends Error {
  constructor(message, { integration, status, retryable = true, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = "IntegrationError";
    this.integration = integration;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermanentError";
    this.retryable = false;
  }
}

export function isRetryable(error) {
  if (error instanceof PermanentError) return false;
  return error?.retryable !== false;
}

export function integrationErrorFromStatus(integration, status, message, retryAfterMs) {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new IntegrationError(`${integration}: ${message}`, { integration, status, retryable, retryAfterMs });
}

export function isDuplicateKeyError(error) {
  return error?.code === 11000 || error?.writeErrors?.every?.((writeError) => writeError.code === 11000);
}
