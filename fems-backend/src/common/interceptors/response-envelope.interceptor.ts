import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginatedPayload<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: PaginatedPayload<unknown>['meta'];
  timestamp: string;
}

function isPaginated(value: unknown): value is PaginatedPayload<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PaginatedPayload<unknown>).items) &&
    typeof (value as PaginatedPayload<unknown>).meta?.total === 'number'
  );
}

/**
 * Wraps every successful response in a consistent envelope:
 *   { success: true, data, meta?, timestamp }
 *
 * Buffers and streamed files are passed through untouched.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    return next.handle().pipe(
      map((payload) => {
        if (
          payload &&
          typeof payload === 'object' &&
          ('pipe' in (payload as object) || 'write' in (payload as object))
        ) {
          return payload;
        }
        if (isPaginated(payload)) {
          return {
            success: true as const,
            data: payload.items as T,
            meta: payload.meta,
            timestamp: new Date().toISOString(),
          };
        }
        return {
          success: true as const,
          data: payload,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
