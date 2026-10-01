/**
 * Provider-neutral contract for the language model behind the AI module.
 *
 * FEMS treats the model as an interchangeable, optional accessory: the
 * deterministic rule engine produces the findings either way, and the model
 * only writes the narrative around them. Keeping the contract here means a
 * provider can be swapped (Groq, OpenRouter, none) without a single change in
 * `AiService`.
 */

export type AiProviderKey = 'groq' | 'openrouter' | 'none';

export interface LlmRequest {
  /** The user turn: the question plus the data the caller is allowed to see. */
  prompt: string;
  /** Recent authorised conversation turns, oldest first. */
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  /** Standing instructions (never contains data — it is a fixed policy text). */
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the model for JSON-object output. */
  json?: boolean;
}

export interface LlmResponse {
  text: string;
  model: string;
  latencyMs: number;
  tokensUsed: number | null;
  finishReason: string | null;
}

export interface LlmDescription {
  /** Mirrors the `AiProvider` enum stored on analyses, alerts and messages. */
  provider: 'GROQ' | 'OPENROUTER' | 'LOCAL_RULE_ENGINE';
  configured: boolean;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  message: string;
  /** Environment variables still required for the selected provider. */
  missing: string[];
}

/** Raised when no API key is configured — the caller must surface this, not hide it. */
export class AiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';

  constructor(message = 'No AI provider is configured. Set GROQ_API_KEY (or OPENROUTER_API_KEY) to enable it.') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}

/** Raised when a configured provider refuses or fails the call. */
export class AiProviderError extends Error {
  readonly code = 'AI_PROVIDER_UNAVAILABLE';
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}
