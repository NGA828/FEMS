import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiClient } from './gemini.client';
import { GroqClient } from './groq.client';
import { LlmClient } from './llm.client';

@Module({
  controllers: [AiController],
  providers: [AiService, GeminiClient, GroqClient, LlmClient],
  exports: [AiService, LlmClient],
})
export class AiModule {}
