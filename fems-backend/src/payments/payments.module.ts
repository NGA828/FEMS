import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CampayProvider } from './providers/campay.provider';
import { SimulatorProvider } from './providers/simulator.provider';
import { PermitsModule } from '../permits/permits.module';

@Module({
  imports: [PermitsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, CampayProvider, SimulatorProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
