import { Injectable, Logger } from '@nestjs/common';
import { appConfig } from '../config/configuration';
import { AiNotConfiguredError, AiProviderError, type LlmDescription, type LlmRequest, type LlmResponse } from './llm.types';

/** Kept as aliases so existing imports of the OpenRouter types keep working. */
export type OpenRouterRequest = LlmRequest;
export type OpenRouterResponse = LlmResponse;
export { AiNotConfiguredError, AiProviderError } from './llm.types';

interface OpenRouterPayload {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> };
    finish_reason?: string | null;
  }>;
  model?: string;
  usage?: { total_tokens?: number };
}

/** Server-side OpenRouter client; the provider key never reaches the mobile app. */
@Injectable()
export class OpenRouterClient {
  private readonly logger = new Logger(OpenRouterClient.name);

  get model(): string {
    return appConfig().ai.openRouterModel;
  }

  get isConfigured(): boolean {
    return Boolean(appConfig().ai.openRouterApiKey);
  }

  describe(): LlmDescription {
    const ai = appConfig().ai;
    return {
      provider: (ai.openRouterApiKey ? 'OPENROUTER' : 'LOCAL_RULE_ENGINE') as 'OPENROUTER' | 'LOCAL_RULE_ENGINE',
      missing: ai.openRouterApiKey ? [] : ['OPENROUTER_API_KEY'],
      configured: Boolean(ai.openRouterApiKey),
      model: ai.openRouterApiKey ? ai.openRouterModel : 'deterministic-rule-engine',
      baseUrl: ai.openRouterBaseUrl,
      timeoutMs: ai.requestTimeoutMs,
      maxOutputTokens: ai.maxOutputTokens,
      message: ai.openRouterApiKey
        ? 'OpenRouter is configured; regulatory decisions still remain with FEMS officers.'
        : 'OPENROUTER_API_KEY is empty. OpenRouter answers are disabled and the deterministic rule engine is used instead.',
    };
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const ai = appConfig().ai;
    if (!ai.openRouterApiKey) throw new AiNotConfiguredError('OpenRouter is not configured. Set OPENROUTER_API_KEY to enable it.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ai.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${ai.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ai.openRouterApiKey}`,
          'content-type': 'application/json',
          'HTTP-Referer': 'https://fems.cm',
          'X-Title': 'FEMS Forest Assistant',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
            ...(request.history ?? []).map(({ role, text }) => ({
              role: role === 'model' ? 'assistant' : 'user',
              content: text,
            })),
            { role: 'user', content: request.prompt },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? ai.maxOutputTokens,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const raw = await response.text();
      if (!response.ok) {
        throw new AiProviderError(`OpenRouter rejected the request (HTTP ${response.status}): ${raw.slice(0, 300)}`, response.status);
      }

      let payload: OpenRouterPayload;
      try {
        payload = JSON.parse(raw) as OpenRouterPayload;
      } catch {
        throw new AiProviderError('OpenRouter returned a response that is not valid JSON.');
      }

      const messageContent = payload.choices?.[0]?.message?.content;
      const text = (typeof messageContent === 'string'
        ? messageContent
        : Array.isArray(messageContent)
          ? messageContent.map((part) => part.text ?? '').join('')
          : ''
      ).trim();
      if (!text) throw new AiProviderError('OpenRouter returned an empty answer.', response.status);

      const model = payload.model || this.model;
      const tokensUsed = typeof payload.usage?.total_tokens === 'number' ? payload.usage.total_tokens : null;
      this.logger.log(`OpenRouter ${model} answered in ${latencyMs} ms (${tokensUsed ?? 'n/a'} tokens)`);
      return {
        text,
        model,
        latencyMs,
        tokensUsed,
        finishReason: payload.choices?.[0]?.finish_reason ?? null,
      };
    } catch (error) {
      if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AiProviderError(`The OpenRouter call exceeded ${ai.requestTimeoutMs} ms and was aborted.`);
      }
      throw new AiProviderError(`The OpenRouter call failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
