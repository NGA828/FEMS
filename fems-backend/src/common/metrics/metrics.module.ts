import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Global so any service — including the scheduled jobs scattered across the
 * feature modules — can report into it without an import graph change.
 */
@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
