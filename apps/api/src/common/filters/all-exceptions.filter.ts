import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ERROR_MESSAGES, type ApiErrorBody, type ApiFieldError, type ErrorCode } from '@jobpilot/shared';
import { isPrismaKnownError, PrismaErrorCode } from '@jobpilot/database';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app-exception';

interface NormalisedError {
  status: number;
  code: ErrorCode;
  message: string;
  fieldErrors?: ApiFieldError[];
  /** Logged but never sent to the client. */
  internalDetail?: unknown;
}

/**
 * Turns every thrown value into the single `ApiErrorBody` shape.
 *
 * Nothing reaches the client that was not deliberately put there: unexpected
 * errors are logged in full with the request id and replied to with a generic
 * message, so stack traces and database details never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const normalised = this.normalise(exception);
    // pino-http types `id` as ReqId (string | number | object); only a string
    // is useful to a client, so anything else is dropped.
    const rawRequestId: unknown = (request as unknown as { id?: unknown }).id;
    const requestId = typeof rawRequestId === 'string' ? rawRequestId : undefined;

    const body: ApiErrorBody = {
      statusCode: normalised.status,
      code: normalised.code,
      message: normalised.message,
      ...(normalised.fieldErrors ? { fieldErrors: normalised.fieldErrors } : {}),
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    if (normalised.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { requestId, path: request.originalUrl, code: normalised.code, err: exception },
        'Unhandled error',
      );
    } else {
      this.logger.debug(
        { requestId, path: request.originalUrl, code: normalised.code },
        'Request failed',
      );
    }

    response.status(normalised.status).json(body);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: this.messageOf(exception) ?? ERROR_MESSAGES[exception.code],
        ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        message: ERROR_MESSAGES.RATE_LIMITED,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.codeForStatus(status),
        message: this.messageOf(exception) ?? ERROR_MESSAGES[this.codeForStatus(status)],
      };
    }

    if (isPrismaKnownError(exception)) {
      if (exception.code === PrismaErrorCode.UniqueConstraintViolation) {
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: ERROR_MESSAGES.CONFLICT,
          internalDetail: exception.meta,
        };
      }
      if (exception.code === PrismaErrorCode.RecordNotFound) {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: ERROR_MESSAGES.NOT_FOUND,
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES.INTERNAL_ERROR,
      internalDetail: exception,
    };
  }

  /**
   * Nest's own text for an unmatched route: "Cannot GET /api/jobs".
   *
   * It names the HTTP method and the internal path, which tells a user
   * nothing useful and reads like a framework crash rather than a product
   * message. Recognised here so the mapped copy is used instead.
   */
  private static readonly FRAMEWORK_ROUTE_MESSAGE =
    /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /i;

  private messageOf(exception: HttpException): string | undefined {
    const payload = exception.getResponse();

    const raw =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && 'message' in payload
          ? (() => {
              const { message } = payload as { message?: unknown };
              if (typeof message === 'string') return message;
              if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
              return undefined;
            })()
          : undefined;

    if (raw === undefined) return undefined;

    // Fall through to the mapped ERROR_MESSAGES copy for framework text.
    return AllExceptionsFilter.FRAMEWORK_ROUTE_MESSAGE.test(raw) ? undefined : raw;
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_FAILED';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
