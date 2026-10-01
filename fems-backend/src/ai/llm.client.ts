import { Injectable } from '@nestjs/common';
import { appConfig } from '../config/configuration';
import { GeminiClient } from './gemini.client';
import { GroqClient } from './groq.client';
import { AiNotConfiguredError, type AiProviderKey, type LlmDescription, type LlmRequest, type LlmResponse } from './llm.types';

/**
 * The language model FEMS actually talks to.
 *
 * `AI_PROVIDER` selects it (`groq`, `gemini` or `none`); when it is left empty
 * the provider is inferred from whichever key is present, preferring Groq
 * because its free tier is what this deployment is set up for. No key at all is
 * a supported state, not a failure: the AI module falls back to its
 * deterministic rule engine and says so.
 */
@Injectable()
export class LlmClient {
  constructor(
    private readonly groq: GroqClient,
    private readonly gemini: GeminiClient,
  ) {}

  /** The provider in force right now, after the explicit/inferred resolution. */
  get provider(): AiProviderKey {
    const ai = appConfig().ai;
    if (ai.provider === 'groq') return ai.groqApiKey ? 'groq' : 'none';
    if (ai.provider === 'gemini') return ai.geminiApiKey ? 'gemini' : 'none';
    return 'none';
  }

  get isConfigured(): boolean {
    return this.provider !== 'none';
  }

  get model(): string {
    return this.describe().model;
  }

  describe(): LlmDescription {
    const ai = appConfig().ai;
    switch (this.provider) {
      case 'groq':
        return this.groq.describe();
      case 'gemini':
        return this.gemini.describe();
      default:
        return {
          provider: 'LOCAL_RULE_ENGINE',
          configured: false,
          model: 'deterministic-rule-engine',
          baseUrl: ai.provider === 'gemini' ? ai.geminiBaseUrl : ai.groqBaseUrl,
          timeoutMs: ai.requestTimeoutMs,
          maxOutputTokens: ai.maxOutputTokens,
          missing: ai.provider === 'gemini' ? ['GEMINI_API_KEY'] : ai.provider === 'groq' ? ['GROQ_API_KEY'] : [],
          message:
            ai.provider === 'none'
              ? 'AI_PROVIDER=none. FEMS runs its deterministic rule engine only — real findings computed from the register, never invented text.'
              : `No API key for the selected provider (${ai.provider}). FEMS runs its deterministic rule engine instead; set ${ai.provider === 'gemini' ? 'GEMINI_API_KEY' : 'GROQ_API_KEY'} in fems-backend/.env to enable model-written answers.`,
        };
    }
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    switch (this.provider) {
      case 'groq':
        return this.groq.generate(request);
      case 'gemini':
        return this.gemini.generate(request);
      default:
        throw new AiNotConfiguredError();
    }
  }
}
