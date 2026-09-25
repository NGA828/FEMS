import { Global, Module } from '@nestjs/common';
import { GisService } from './gis.service';
import { GisController } from './gis.controller';

@Global()
@Module({
  controllers: [GisController],
  providers: [GisService],
  exports: [GisService],
})
export class GisModule {}
