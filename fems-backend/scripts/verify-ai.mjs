#!/usr/bin/env node
/**
 * FEMS — Groq provider check.
 *
 * Reads fems-backend/.env, reports missing configuration, checks that the key
 * can list its active Groq models, then sends one short chat-completion request.
 * OpenRouter variables are intentionally ignored; FEMS only calls Groq.
 *
 *   node scripts/verify-ai.mjs                 # config + models + one call
 *   node scripts/verify-ai.mjs --list          # config + models, no generation
 *
 * Exit code 0 = the selected provider (Groq or explicit `none`) is healthy.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const listOnly = process.argv.includes('--list');
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const RETIRED_MODELS = new Map([
  ['llama-3.3-70b-versatile', DEFAULT_MODEL],
  ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
  ['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b'],
]);

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    console.log(`  note  no .env found at ${envPath} — reading the process environment only.`);
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const mask = (value) => (value ? `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)` : '(empty)');
const model = () => {
  const requested = (process.env.GROQ_MODEL ?? '').trim();
  return (RETIRED_MODELS.get(requested) ?? requested) || DEFAULT_MODEL;
};
const baseUrl = () => (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

async function responseText(response) {
  const raw = await response.text();
  if (!response.ok) {
    let detail = raw.slice(0, 300);
    try {
      detail = JSON.parse(raw).error?.message ?? detail;
    } catch {
      /* Keep the raw response when the provider did not return JSON. */
    }
    const hint =
      response.status === 401
        ? 'The key was refused — check GROQ_API_KEY at https://console.groq.com/keys.'
        : response.status === 404
          ? 'The model is not active for this account — set GROQ_MODEL to an active ID shown by this script.'
          : response.status === 429
            ? 'Groq quota/rate limit reached. Check your current quota in the Groq console.'
            : '';
    throw new Error(`HTTP ${response.status}: ${detail}${hint ? `\n        ${hint}` : ''}`);
  }
  return raw;
}

async function listGroqModels(key) {
  const response = await fetch(`${baseUrl()}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = JSON.parse(await responseText(response));
  return (payload.data ?? []).map((entry) => entry.id).filter((id) => typeof id === 'string').sort();
}

async function callGroq(key, selectedModel) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: selectedModel,
      messages: [
        { role: 'system', content: 'You are a terse assistant for a forest administration system.' },
        { role: 'user', content: 'Reply with exactly: FEMS AI provider OK' },
      ],
      max_completion_tokens: 32,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = JSON.parse(await responseText(response));
  return {
    text: payload.choices?.[0]?.message?.content?.trim() ?? '',
    tokens: payload.usage?.total_tokens ?? null,
    model: payload.model ?? selectedModel,
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  loadEnv();
  const requestedProvider = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  const disabled = requestedProvider === 'none';

  console.log('FEMS — Groq AI provider check');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  AI_PROVIDER            ${disabled ? 'none (model calls disabled)' : 'groq'}`);
  if (requestedProvider && requestedProvider !== 'groq' && !disabled) {
    console.log(`  note  AI_PROVIDER=${requestedProvider} is not supported here; this build uses Groq only.`);
  }
  if (disabled) {
    console.log('\n  AI_PROVIDER=none — FEMS answers with its deterministic rule engine only.');
    console.log('  That is a supported configuration; no external provider request was sent.');
    return;
  }

  const key = process.env.GROQ_API_KEY ?? '';
  const selectedModel = model();
  console.log(`  GROQ_API_KEY           ${mask(key)}`);
  console.log(`  GROQ_MODEL             ${selectedModel}`);
  console.log(`  GROQ_BASE_URL          ${baseUrl()}`);
  console.log('');

  if (!key) {
    console.error('  ✗  GROQ_API_KEY is empty. Create a key at https://console.groq.com/keys and add it to fems-backend/.env.');
    console.log('     Until then FEMS continues to answer from its deterministic rule engine.');
    process.exitCode = 1;
    return;
  }

  try {
    const models = await listGroqModels(key);
    console.log(`  ✓  The key is valid — ${models.length} model(s) available to this account:`);
    for (const id of models) console.log(`       ${id === selectedModel ? '→' : ' '} ${id}`);
    if (!models.includes(selectedModel)) {
      throw new Error(`GROQ_MODEL="${selectedModel}" is not in the active-model list. Pick an ID listed above.`);
    }
    console.log('');

    if (listOnly) {
      console.log('  --list given: no generation request was sent.');
      return;
    }

    const result = await callGroq(key, selectedModel);
    if (!result.text) throw new Error('Groq returned an empty completion.');
    console.log(`  ✓  Groq answered in ${result.latencyMs} ms using ${result.model}`);
    console.log(`     tokens: ${result.tokens ?? 'n/a'}`);
    console.log(`     reply : ${result.text}`);
    console.log('\n  Groq is configured. Restart the API so it picks up the .env change.');
  } catch (error) {
    console.error(`  ✗  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  FEMS keeps answering with the deterministic rule engine until this is fixed.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`verify-ai failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
