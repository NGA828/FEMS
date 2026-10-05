import { Injectable } from '@nestjs/common';
import { appConfig } from '../config/configuration';
import { GroqClient } from './groq.client';
import { AiNotConfiguredError, type AiProviderKey, type LlmDescription, type LlmRequest, type LlmResponse } from './llm.types';

/**
 * The language model FEMS actually talks to.
 *
 * Groq is the only external provider. If the key is missing or AI_PROVIDER=none,
 * callers use the deterministic rule engine and never silently switch providers.
 */
@Injectable()
export class LlmClient {
  constructor(private readonly groq: GroqClient) {}

  /** The provider in force; no key means the local rule engine. */
  get provider(): AiProviderKey {
    const ai = appConfig().ai;
    return ai.provider === 'groq' && ai.groqApiKey ? 'groq' : 'none';
  }

  get isConfigured(): boolean {
    return this.provider === 'groq';
  }

  get model(): string {
    return this.describe().model;
  }

  describe(): LlmDescription {
    const ai = appConfig().ai;
    if (this.provider === 'groq') return this.groq.describe();

    return {
      provider: 'LOCAL_RULE_ENGINE',
      configured: false,
      model: 'deterministic-rule-engine',
      baseUrl: ai.groqBaseUrl,
      timeoutMs: ai.requestTimeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
      missing: ai.provider === 'none' ? [] : ['GROQ_API_KEY'],
      message:
        ai.provider === 'none'
          ? 'AI_PROVIDER=none. FEMS runs its deterministic rule engine only — real findings computed from the register, never invented text.'
          : 'GROQ_API_KEY is empty. FEMS runs its deterministic rule engine instead; set GROQ_API_KEY in fems-backend/.env to enable Groq model-written answers.',
    };
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    if (this.provider !== 'groq') throw new AiNotConfiguredError();
    return this.groq.generate(request);
  }
}
