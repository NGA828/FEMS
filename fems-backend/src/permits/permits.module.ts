import { Module } from '@nestjs/common';
import { PermitsService } from './permits.service';
import { PermitsController } from './permits.controller';

@Module({
  controllers: [PermitsController],
  providers: [PermitsService],
  exports: [PermitsService],
})
export class PermitsModule {}
