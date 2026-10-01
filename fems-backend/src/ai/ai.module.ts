import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OpenRouterClient } from './openrouter.client';

@Module({
  controllers: [AiController],
  providers: [AiService, OpenRouterClient],
  exports: [AiService, OpenRouterClient],
})
export class AiModule {}
