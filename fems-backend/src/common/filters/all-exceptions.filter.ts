import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Centralised error handling.
 *
 * Converts every failure — HTTP exceptions, Prisma errors, unexpected runtime
 * errors — into one consistent JSON envelope, and never leaks stack traces or
 * database internals to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { user?: { id: string } }>();

    const { status, body, logLevel } = this.normalize(exception);

    const payload = {
      success: false,
      statusCode: status,
      error: body,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    const message = `${request.method} ${request.url} -> ${status} ${body.code}: ${body.message}`;
    if (logLevel === 'error') {
      this.logger.error(message, exception instanceof Error ? exception.stack : undefined);
    } else if (logLevel === 'warn') {
      this.logger.warn(message);
    }

    response.status(status).json(payload);
  }

  private normalize(exception: unknown): {
    status: number;
    body: ErrorBody;
    logLevel: 'error' | 'warn' | 'silent';
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        return {
          status,
          body: { code: this.codeFromStatus(status), message: raw },
          logLevel: status >= 500 ? 'error' : 'warn',
        };
      }
      const rawObject = raw as Record<string, unknown>;
      const message = Array.isArray(rawObject.message)
        ? (rawObject.message as string[]).join('; ')
        : String(rawObject.message ?? exception.message);
      return {
        status,
        body: {
          code: String(rawObject.code ?? this.codeFromStatus(status)),
          message,
          details: rawObject.details ?? (Array.isArray(rawObject.message) ? rawObject.message : undefined),
        },
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return { status: this.statusFromPrisma(exception), body: this.bodyFromPrisma(exception), logLevel: 'warn' };
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: 'DATABASE_VALIDATION_ERROR',
          message: 'The request could not be processed because of invalid data.',
        },
        logLevel: 'warn',
      };
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is currently unavailable. Please try again shortly.',
        },
        logLevel: 'error',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. If it persists, contact the FEMS administrator.',
      },
      logLevel: 'error',
    };
  }

  private statusFromPrisma(exception: Prisma.PrismaClientKnownRequestError): number {
    switch (exception.code) {
      case 'P2002':
      case 'P2003':
        return HttpStatus.CONFLICT;
      case 'P2025':
        return HttpStatus.NOT_FOUND;
      case 'P2000':
        return HttpStatus.BAD_REQUEST;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private bodyFromPrisma(exception: Prisma.PrismaClientKnownRequestError): ErrorBody {
    const target = (exception.meta?.target as string[] | string | undefined) ?? undefined;
    const field = Array.isArray(target) ? target.join(', ') : target;
    switch (exception.code) {
      case 'P2002':
        return {
          code: 'DUPLICATE_RECORD',
          message: field
            ? `A record with this ${field} already exists.`
            : 'A record with these values already exists.',
          details: { fields: target },
        };
      case 'P2003':
        return {
          code: 'RELATED_RECORD_CONSTRAINT',
          message: 'This operation references a record that does not exist or is still in use.',
        };
      case 'P2025':
        return {
          code: 'RECORD_NOT_FOUND',
          message: 'The requested record does not exist or has been removed.',
        };
      default:
        return {
          code: `DATABASE_${exception.code}`,
          message: 'The database rejected this operation.',
        };
    }
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? `HTTP_${status}`;
  }
}
