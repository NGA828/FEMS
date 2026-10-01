#!/usr/bin/env node
/**
 * FEMS — AI provider check (Groq by default).
 *
 * Reads fems-backend/.env (never a hardcoded credential), says exactly what is
 * missing, lists the models the key can actually use, and sends one real
 * generation request so a wrong key, a wrong model name or an exhausted free
 * quota is reported in plain words. The API does not have to be running.
 *
 *   node scripts/verify-ai.mjs                 # configuration + models + one call
 *   node scripts/verify-ai.mjs --list          # configuration + models only
 *   npm run ai:verify
 *
 * Exit code 0 = the provider answered.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const listOnly = process.argv.includes('--list');

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

function resolveProvider() {
  const explicit = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (['groq', 'gemini', 'none'].includes(explicit)) return explicit;
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'groq';
}

async function listGroqModels(baseUrl, key) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${key}` },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 200)}`);
  const payload = JSON.parse(raw);
  return (payload.data ?? []).map((entry) => entry.id).sort();
}

async function callGroq(baseUrl, key, model) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a terse assistant for a forest administration system.' },
        { role: 'user', content: 'Reply with exactly: FEMS AI provider OK' },
      ],
      max_completion_tokens: 32,
      temperature: 0,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let detail = raw.slice(0, 300);
    try {
      detail = JSON.parse(raw).error?.message ?? detail;
    } catch {
      /* keep the raw body */
    }
    const hint =
      response.status === 401
        ? 'The key was refused — check GROQ_API_KEY at https://console.groq.com/keys'
        : response.status === 404
          ? 'That model is not served to this account — set GROQ_MODEL to one of the models listed above.'
          : response.status === 429
            ? 'Free-tier quota reached (30 req/min, daily token budget). Wait, or switch GROQ_MODEL.'
            : '';
    throw new Error(`HTTP ${response.status}: ${detail}${hint ? `\n        ${hint}` : ''}`);
  }
  const payload = JSON.parse(raw);
  return {
    text: payload.choices?.[0]?.message?.content?.trim() ?? '',
    tokens: payload.usage?.total_tokens ?? null,
    model: payload.model ?? model,
    latencyMs: Date.now() - startedAt,
  };
}

async function callGemini(baseUrl, key, model) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: FEMS AI provider OK' }] }] }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300)}`);
  const payload = JSON.parse(raw);
  return {
    text: (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim(),
    tokens: payload.usageMetadata?.totalTokenCount ?? null,
    model,
    latencyMs: Date.now() - startedAt,
  };
}

async function main() {
  loadEnv();
  const provider = resolveProvider();

  console.log('FEMS — AI provider check');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  AI_PROVIDER            ${process.env.AI_PROVIDER || `(empty → inferred: ${provider})`}`);

  if (provider === 'none') {
    console.log('\n  AI_PROVIDER=none — FEMS answers with its deterministic rule engine only.');
    console.log('  That is a supported configuration; nothing to verify.');
    process.exit(0);
  }

  const isGroq = provider === 'groq';
  const key = isGroq ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
  const model = isGroq ? process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' : process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const baseUrl = isGroq
    ? process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
    : process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

  console.log(`  ${isGroq ? 'GROQ_API_KEY         ' : 'GEMINI_API_KEY       '}  ${mask(key)}`);
  console.log(`  ${isGroq ? 'GROQ_MODEL           ' : 'GEMINI_MODEL         '}  ${model}`);
  console.log(`  ${isGroq ? 'GROQ_BASE_URL        ' : 'GEMINI_BASE_URL      '}  ${baseUrl}`);
  console.log('');

  if (!key) {
    console.log(`  ✗  ${isGroq ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} is empty.`);
    if (isGroq) {
      console.log('     Create a free key (no credit card) at https://console.groq.com/keys,');
      console.log('     then put it in fems-backend/.env as GROQ_API_KEY=gsk_… and restart the API.');
    }
    console.log('     Until then FEMS uses its deterministic rule engine — which is a valid state,');
    console.log('     just without model-written narratives.');
    process.exit(1);
  }

  if (isGroq) {
    try {
      const models = await listGroqModels(baseUrl, key);
      console.log(`  ✓  The key is valid — ${models.length} model(s) available to this account:`);
      for (const id of models) console.log(`       ${id === model ? '→' : ' '} ${id}`);
      if (!models.includes(model)) {
        console.log(`\n  ✗  GROQ_MODEL="${model}" is not in that list. Pick one of the ids above.`);
        process.exit(1);
      }
      console.log('');
    } catch (error) {
      console.log(`  ✗  Could not list the models: ${error.message}`);
      process.exit(1);
    }
  }

  if (listOnly) {
    console.log('  --list given: no generation request was sent.');
    process.exit(0);
  }

  try {
    const result = isGroq ? await callGroq(baseUrl, key, model) : await callGemini(baseUrl, key, model);
    console.log(`  ✓  ${provider} answered in ${result.latencyMs} ms using ${result.model}`);
    console.log(`     tokens: ${result.tokens ?? 'n/a'}`);
    console.log(`     reply : ${result.text}`);
    console.log('\n  AI is configured. Restart the API so it picks up the .env change.');
    process.exit(0);
  } catch (error) {
    console.log(`  ✗  The generation request failed:\n        ${error.message}`);
    console.log('\n  FEMS will keep answering with the deterministic rule engine until this is fixed.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`verify-ai failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
