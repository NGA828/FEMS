import { Module } from '@nestjs/common';
import { InspectionsController, ObservationsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';
import { ObservationsService } from './observations.service';

@Module({
  controllers: [InspectionsController, ObservationsController],
  providers: [InspectionsService, ObservationsService],
  exports: [InspectionsService, ObservationsService],
})
export class InspectionsModule {}
