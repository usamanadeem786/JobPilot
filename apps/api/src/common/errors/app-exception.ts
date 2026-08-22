import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_MESSAGES, type ApiFieldError, type ErrorCode } from '@jobpilot/shared';

/**
 * The only exception type the application throws deliberately.
 *
 * Carrying a machine-readable `code` next to the HTTP status means the client
 * can react to a specific failure ("source not configured" → link to settings)
 * without string-matching on messages.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly fieldErrors?: ApiFieldError[];

  constructor(
    code: ErrorCode,
    status: HttpStatus,
    message?: string,
    fieldErrors?: ApiFieldError[],
  ) {
    super({ code, message: message ?? ERROR_MESSAGES[code] }, status);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  static badRequest(code: ErrorCode, message?: string, fieldErrors?: ApiFieldError[]): AppException {
    return new AppException(code, HttpStatus.BAD_REQUEST, message, fieldErrors);
  }

  static unauthorized(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.UNAUTHORIZED, message);
  }

  static forbidden(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.FORBIDDEN, message);
  }

  static notFound(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.NOT_FOUND, message);
  }

  static conflict(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.CONFLICT, message);
  }

  static unprocessable(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY, message);
  }

  static tooManyRequests(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.TOO_MANY_REQUESTS, message);
  }

  static serviceUnavailable(code: ErrorCode, message?: string): AppException {
    return new AppException(code, HttpStatus.SERVICE_UNAVAILABLE, message);
  }

  static internal(code: ErrorCode = 'INTERNAL_ERROR', message?: string): AppException {
    return new AppException(code, HttpStatus.INTERNAL_SERVER_ERROR, message);
  }
}
