import type { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

describe('ResponseEnvelopeInterceptor', () => {
  it('preserves additional metadata on paginated endpoint responses', async () => {
    const payload = {
      items: [{ id: 'alert-1' }],
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      reviewSlaHours: 72,
    };
    const result = await firstValueFrom(
      new ResponseEnvelopeInterceptor().intercept({} as ExecutionContext, { handle: () => of(payload) }),
    );

    expect(result).toMatchObject({
      success: true,
      data: payload.items,
      meta: payload.meta,
      reviewSlaHours: 72,
    });
  });
});
