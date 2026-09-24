import { Module } from '@nestjs/common';
import { ForestsService } from './forests.service';
import { ForestsController, ZonesController } from './forests.controller';
import {
  InventoryController,
  ProtectedAreasController,
  TreeSpeciesController,
} from './reference.controller';

@Module({
  controllers: [
    ForestsController,
    ZonesController,
    ProtectedAreasController,
    TreeSpeciesController,
    InventoryController,
  ],
  providers: [ForestsService],
  exports: [ForestsService],
})
export class ForestsModule {}
