#!/usr/bin/env node
/**
 * FEMS E2E smoke — Forest Intelligence and the Forest Assistant.
 *
 * Checks the two guarantees that matter most for the AI module:
 *   1. the deterministic rule engine really runs over the live database and
 *      raises alerts with status NEW, whatever the provider configuration is;
 *   2. nothing the assistant answers escapes the caller's authorisation, and
 *      the app never pretends a provider answered when none is configured.
 *
 * It also walks the whole alert review lifecycle (acknowledge → confirm →
 * resolve → reopen) including every rejection path.
 *
 * Usage: node scripts/smoke-ai.mjs
 *        FEMS_API_URL=... FEMS_ADMIN_PASSWORD=... node scripts/smoke-ai.mjs
 *
 * Exit code 0 = every assertion passed.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.FEMS_API_URL ?? 'http://127.0.0.1:3000/api/v1';
const ADMIN_EMAIL = process.env.FEMS_ADMIN_EMAIL ?? 'admin@fems.cm';
const COMPANY_USER_EMAIL = process.env.FEMS_SMOKE_COMPANY_EMAIL ?? 'env-smoke-company@fems.cm';
const COMPANY_USER_PASSWORD = 'FemsSmoke-Env9';
const COMPANY = process.env.FEMS_SMOKE_COMPANY ?? '83a65695-931b-4714-8d62-50b4692cd8f5';

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

/** The API rate-limits logins (120 requests/minute), so retry politely. */
async function loginWithRetry(email, password, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await call('POST', '/auth/login', { body: { email, password } });
    if (response.status !== 429) return response;
    const waitMs = 20_000 * (attempt + 1);
    console.log(`  … ${label} login rate-limited, waiting ${waitMs / 1000}s`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return call('POST', '/auth/login', { body: { email, password } });
}

function adminPassword() {
  if (process.env.FEMS_ADMIN_PASSWORD) return process.env.FEMS_ADMIN_PASSWORD;
  try {
    return readFileSync('/tmp/admin.pw', 'utf8').trim();
  } catch {
    console.error('Set FEMS_ADMIN_PASSWORD (or create /tmp/admin.pw) before running this smoke test.');
    process.exit(2);
  }
}

console.log('— authentication —');
const login = await loginWithRetry(ADMIN_EMAIL, adminPassword(), 'admin');
check('admin login', [200, 201].includes(login.status), `HTTP ${login.status}`);
const token = login.body?.data?.accessToken ?? login.body?.data?.tokens?.accessToken;
if (!token) {
  console.error('No admin access token — aborting.', JSON.stringify(login.body).slice(0, 300));
  process.exit(1);
}

let companyToken = null;
const companyLogin = await loginWithRetry(COMPANY_USER_EMAIL, COMPANY_USER_PASSWORD, 'company');
companyToken = companyLogin.body?.data?.accessToken ?? companyLogin.body?.data?.tokens?.accessToken;
if (!companyToken) {
  // The account may live in another environment with a rotated password: reset it once.
  const found = await call('GET', `/users?search=${encodeURIComponent(COMPANY_USER_EMAIL)}&limit=1`, { token });
  const existing = Array.isArray(found.body?.data) ? found.body.data[0] : null;
  if (existing?.id) {
    const reset = await call('POST', `/users/${existing.id}/reset-password`, { token, body: {} });
    const temporary = reset.body?.data?.temporaryPassword ?? '';
    if (temporary) {
      const retry = await loginWithRetry(COMPANY_USER_EMAIL, temporary, 'company (rotated password)');
      companyToken = retry.body?.data?.accessToken ?? retry.body?.data?.tokens?.accessToken;
    }
  }
}
check('company representative login', Boolean(companyToken), companyToken ? 'token issued' : `HTTP ${companyLogin.status} ${companyLogin.body?.error?.code}`);

console.log('\n— module status —');
const status = await call('GET', '/ai/status', { token });
check('GET /ai/status', status.status === 200, `HTTP ${status.status}`);
check(
  'the module reports the provider configuration honestly',
  typeof status.body?.data?.geminiConfigured === 'boolean' &&
    (status.body.data.geminiConfigured
      ? status.body.data.provider === 'GEMINI'
      : status.body.data.provider === 'LOCAL_RULE_ENGINE' && status.body.data.message.includes('GEMINI_API_KEY')),
  `provider=${status.body?.data?.provider} configured=${status.body?.data?.geminiConfigured}`,
);
check(
  'the deterministic engine publishes the rules that actually run',
  (status.body?.data?.deterministicEngine?.rules ?? []).length >= 10,
  `${(status.body?.data?.deterministicEngine?.rules ?? []).length} rule(s)`,
);
check(
  'guardrails state that a human decides',
  JSON.stringify(status.body?.data?.guardrails ?? []).includes('only an officer can confirm'),
  JSON.stringify(status.body?.data?.guardrails?.[0] ?? '').slice(0, 90),
);

const catalogue = await call('GET', '/ai/catalogue', { token });
check('GET /ai/catalogue', catalogue.status === 200, `HTTP ${catalogue.status}`);
check(
  'every review action is documented with its permission and reason duty',
  (catalogue.body?.data?.alertActions ?? []).length === 5 &&
    catalogue.body.data.alertActions
      .filter((entry) => ['CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'].includes(entry.action))
      .every((entry) => entry.reasonRequired === true && entry.permissions.includes('ai:alerts_review')),
  (catalogue.body?.data?.alertActions ?? []).map((entry) => entry.action).join(', '),
);
check(
  'the assistant documents the data sections it may use',
  (catalogue.body?.data?.assistantSections ?? []).length === 8,
  (catalogue.body?.data?.assistantSections ?? []).map((section) => section.key).join(', '),
);

console.log('\n— running the deterministic engine (no provider configured) —');
const analysis = await call('POST', '/ai/analyses', {
  token,
  body: { type: 'RISK_ASSESSMENT', periodDays: 365 },
});
const run = analysis.body?.data;
check('POST /ai/analyses', analysis.status === 201, `HTTP ${analysis.status} ${analysis.body?.error?.code ?? ''}`);
check('the analysis completed', run?.status === 'COMPLETED', `status=${run?.status} ${run?.errorMessage ?? ''}`);
check(
  'the findings come from the rule engine, not from a model',
  run?.provider === 'LOCAL_RULE_ENGINE' && run?.result?.detectorVersion === 'fems-rules/1.0',
  `provider=${run?.provider} detector=${run?.result?.detectorVersion}`,
);
check(
  'the run evaluated every catalogued rule',
  Number(run?.result?.rulesEvaluated) >= 10,
  `${run?.result?.rulesEvaluated} rule(s), ${run?.result?.findings?.length ?? 0} finding(s)`,
);
check(
  'every finding carries a risk level, a confidence and the arithmetic behind it',
  (run?.result?.findings ?? []).every(
    (finding) =>
      ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(finding.riskLevel) &&
      typeof finding.confidence === 'number' &&
      typeof finding.reasoning === 'string' &&
      finding.reasoning.length > 10,
  ),
  `${run?.result?.findings?.length ?? 0} finding(s)`,
);
check(
  'the engine found real signals in the seeded database',
  (run?.alerts ?? 0) > 0,
  `${run?.alerts} new alert(s)`,
);
check(
  'the empty-provider situation is stated instead of faked',
  JSON.stringify(run?.notes ?? []).includes('GEMINI_API_KEY is empty'),
  JSON.stringify(run?.notes ?? []).slice(0, 120),
);
check(
  'each raised alert is reported back to the caller',
  Array.isArray(run?.result?.alertsRaised) && run.result.alertsRaised.length === run.alerts,
  `${run?.result?.alertsRaised?.length ?? 0} alert(s)`,
);
const firstAlertId = run?.result?.alertsRaised?.[0]?.id ?? null;

console.log('\n— repeating the run does not flood the console —');
const repeat = await call('POST', '/ai/analyses', { token, body: { type: 'RISK_ASSESSMENT', periodDays: 365 } });
check(
  'a second run raises no duplicate alert for an open signal',
  repeat.status === 201 && (repeat.body?.data?.alerts ?? 1) === 0 && Number(repeat.body?.data?.duplicatesSkipped) > 0,
  `alerts=${repeat.body?.data?.alerts} duplicatesSkipped=${repeat.body?.data?.duplicatesSkipped}`,
);
check(
  'the rule engine can also be run explicitly without the provider',
  (await call('POST', '/ai/analyses', { token, body: { type: 'ANOMALY_DETECTION', periodDays: 180, useProvider: false } })).status === 201,
  'useProvider=false accepted',
);

console.log('\n— company accounts cannot run regulatory analysis —');
const companyAnalysis = await call('POST', '/ai/analyses', { token: companyToken, body: { type: 'RISK_ASSESSMENT' } });
check(
  'a company account is refused (403)',
  companyAnalysis.status === 403,
  `HTTP ${companyAnalysis.status} ${companyAnalysis.body?.error?.code}`,
);

console.log('\n— alert console —');
const alertList = await call('GET', '/ai/alerts?limit=10', { token });
const alerts = Array.isArray(alertList.body?.data) ? alertList.body.data : [];
check('GET /ai/alerts', alertList.status === 200 && alerts.length > 0, `HTTP ${alertList.status} items=${alerts.length}`);
check(
  'every row carries its review position and the actions available',
  alerts.every((alert) => alert.review && typeof alert.review.requiresHumanDecision === 'boolean' && Array.isArray(alert.actions)),
  `reviewSlaHours=${alertList.body?.reviewSlaHours}`,
);
check(
  'new signals are sorted by risk first',
  alerts.every((alert, index) => index === 0 || ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].indexOf(alerts[index - 1].riskLevel) <= ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].indexOf(alert.riskLevel)),
  alerts.map((alert) => alert.riskLevel).slice(0, 6).join(' > '),
);
check(
  'the alert carries the reasoning and the detector that produced it',
  alerts.every((alert) => alert.detector === 'LOCAL_RULE_ENGINE' && alert.reasoning.length > 10),
  `detector=${alerts[0]?.detector}`,
);

const awaiting = await call('GET', '/ai/alerts?awaitingReview=true&limit=50', { token });
check(
  'awaitingReview returns only untouched signals',
  Array.isArray(awaiting.body?.data) && awaiting.body.data.every((alert) => alert.status === 'NEW'),
  `${(awaiting.body?.data ?? []).length} awaiting review`,
);

const target = alerts.find((alert) => alert.status === 'NEW') ?? alerts[0];
const detail = await call('GET', `/ai/alerts/${target.id}`, { token });
check('GET /ai/alerts/:id', detail.status === 200, `HTTP ${detail.status}`);
check(
  'the detail states that the signal is not a finding of guilt',
  JSON.stringify(detail.body?.data?.guardrails ?? []).includes('not a finding of guilt'),
  JSON.stringify(detail.body?.data?.guardrails?.[0] ?? '').slice(0, 80),
);
check(
  'the detail lists the authorised actions',
  Array.isArray(detail.body?.data?.actions) && detail.body.data.actions.length > 0,
  (detail.body?.data?.actions ?? []).join(', '),
);

const statistics = await call('GET', '/ai/alerts/statistics', { token });
check('GET /ai/alerts/statistics', statistics.status === 200 && Number(statistics.body?.data?.total) > 0, `total=${statistics.body?.data?.total}`);
check(
  'the console separates what the engine raised from what officers decided',
  statistics.body?.data?.humanReview && typeof statistics.body.data.humanReview.awaitingFirstReview === 'number',
  `awaiting=${statistics.body?.data?.humanReview?.awaitingFirstReview} reviewed=${statistics.body?.data?.humanReview?.reviewed}`,
);
check(
  'the statistics refuse to present the numbers as a verdict',
  String(statistics.body?.data?.note ?? '').includes('not a statement about any organisation'),
  'note present',
);

console.log('\n— review lifecycle —');
const acknowledge = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: { action: 'ACKNOWLEDGE', reason: 'Smoke test: taking the signal for review.' },
});
check('ACKNOWLEDGE moves NEW → REVIEWING', acknowledge.status === 201 && acknowledge.body?.data?.status === 'REVIEWING', `HTTP ${acknowledge.status} status=${acknowledge.body?.data?.status}`);
check(
  'the decision records who made it and when',
  Boolean(acknowledge.body?.data?.reviewedById) && Boolean(acknowledge.body?.data?.reviewedAt),
  `reviewedBy=${acknowledge.body?.data?.reviewedBy?.email ?? 'set'}`,
);

const badTransition = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: { action: 'ACKNOWLEDGE', reason: 'Smoke test: acknowledging twice should fail.' },
});
check(
  'an invalid transition is rejected with a clear code',
  badTransition.status === 400 && badTransition.body?.error?.code === 'ALERT_INVALID_TRANSITION',
  `HTTP ${badTransition.status} ${badTransition.body?.error?.code}`,
);

const noEvidence = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: { action: 'CONFIRM', reason: 'Smoke test: confirming without evidence.' },
});
check(
  'confirming without documented evidence is refused',
  noEvidence.status === 400 && noEvidence.body?.error?.code === 'AI_ALERT_REVIEW_INVALID' &&
    JSON.stringify(noEvidence.body?.error?.details ?? []).includes('ALERT_EVIDENCE_REQUIRED'),
  `HTTP ${noEvidence.status} ${JSON.stringify(noEvidence.body?.error?.details ?? []).slice(0, 80)}`,
);

const confirm = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: {
    action: 'CONFIRM',
    reason: 'Smoke test: an officer verified the figures against the field records.',
    evidenceNote: 'Activity register and harvest sheet agree with the recorded volume.',
    requestInspection: true,
  },
});
check('CONFIRM moves REVIEWING → CONFIRMED', confirm.status === 201 && confirm.body?.data?.status === 'CONFIRMED', `HTTP ${confirm.status} status=${confirm.body?.data?.status}`);
check(
  'confirming records the evidence and asks for field verification',
  String(confirm.body?.data?.reviewNotes ?? '').includes('Evidence:') && confirm.body?.data?.inspectionRequested === true,
  `${String(confirm.body?.data?.reviewNotes ?? '').slice(0, 60)}…`,
);

const resolveWithoutAction = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: { action: 'RESOLVE', reason: 'Smoke test: resolving without saying what was done.' },
});
check(
  'resolving without a resolution action is refused',
  resolveWithoutAction.status === 400 &&
    JSON.stringify(resolveWithoutAction.body?.error?.details ?? []).includes('ALERT_RESOLUTION_REQUIRED'),
  `HTTP ${resolveWithoutAction.status} ${resolveWithoutAction.body?.error?.code}`,
);

const resolve = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: {
    action: 'RESOLVE',
    reason: 'Smoke test: the field verification closed the question.',
    resolutionAction: 'Field inspection confirmed the harvested volume matches the authorisation.',
  },
});
check('RESOLVE moves CONFIRMED → RESOLVED', resolve.status === 201 && resolve.body?.data?.status === 'RESOLVED', `HTTP ${resolve.status} status=${resolve.body?.data?.status}`);

const reopenWithoutReason = await call('POST', `/ai/alerts/${target.id}/review`, { token, body: { action: 'REOPEN' } });
check(
  'reopening without a reason is refused',
  reopenWithoutReason.status === 400 && reopenWithoutReason.body?.error?.code === 'AI_ALERT_REVIEW_INVALID',
  `HTTP ${reopenWithoutReason.status} ${reopenWithoutReason.body?.error?.code}`,
);

const reopen = await call('POST', `/ai/alerts/${target.id}/review`, {
  token,
  body: { action: 'REOPEN', reason: 'Smoke test: new evidence arrived and the signal must be examined again.' },
});
check('REOPEN moves RESOLVED → REVIEWING', reopen.status === 201 && reopen.body?.data?.status === 'REVIEWING', `HTTP ${reopen.status} status=${reopen.body?.data?.status}`);

const dismissCandidate = (await call('GET', '/ai/alerts?status=NEW&limit=1', { token })).body?.data?.[0] ?? null;
if (dismissCandidate) {
  const dismiss = await call('POST', `/ai/alerts/${dismissCandidate.id}/review`, {
    token,
    body: { action: 'DISMISS', reason: 'Smoke test: the signal does not correspond to any recorded breach.' },
  });
  check('DISMISS moves NEW → DISMISSED', dismiss.status === 201 && dismiss.body?.data?.status === 'DISMISSED', `HTTP ${dismiss.status}`);
  const afterDismiss = await call('POST', `/ai/alerts/${dismissCandidate.id}/review`, {
    token,
    body: {
      action: 'CONFIRM',
      reason: 'Smoke test: a dismissed signal cannot be confirmed directly.',
      evidenceNote: 'This confirmation must be refused by the state machine.',
    },
  });
  check(
    'a dismissed signal cannot be confirmed without being reopened',
    afterDismiss.status === 400 && afterDismiss.body?.error?.code === 'ALERT_INVALID_TRANSITION',
    `HTTP ${afterDismiss.status} ${afterDismiss.body?.error?.code}`,
  );
} else {
  check('a NEW signal is available to test dismissal', false, 'no NEW alert left after the lifecycle run');
}

const companyReview = await call('POST', `/ai/alerts/${target.id}/review`, {
  token: companyToken,
  body: { action: 'CONFIRM', reason: 'Smoke test: a company must not be able to decide on a signal.', evidenceNote: 'forbidden' },
});
check(
  'a company account can never decide an alert (refused before the state machine is even consulted)',
  companyReview.status === 403 && ['AI_ALERT_ACTION_FORBIDDEN', 'PERMISSION_FORBIDDEN'].includes(companyReview.body?.error?.code),
  `HTTP ${companyReview.status} ${companyReview.body?.error?.code}`,
);

const companyAlertList = await call('GET', '/ai/alerts', { token: companyToken });
check(
  'a company account cannot browse the alert console',
  companyAlertList.status === 403,
  `HTTP ${companyAlertList.status} ${companyAlertList.body?.error?.code}`,
);

console.log('\n— analyses archive —');
const analyses = await call('GET', '/ai/analyses?limit=5', { token });
check('GET /ai/analyses', analyses.status === 200 && (analyses.body?.data ?? []).length > 0, `total=${analyses.body?.meta?.total}`);
const oneAnalysis = await call('GET', `/ai/analyses/${run.id}`, { token });
check(
  'an analysis keeps its findings and the alerts it raised',
  oneAnalysis.status === 200 && Array.isArray(oneAnalysis.body?.data?.alerts) && oneAnalysis.body?.data?.result?.detectorVersion === 'fems-rules/1.0',
  `alerts linked=${oneAnalysis.body?.data?.alerts?.length}`,
);

console.log('\n— forest assistant —');
const ask = await call('POST', '/ai/assistant/ask', { token, body: { question: 'Quels permis sont actifs ?' } });
check('POST /ai/assistant/ask', ask.status === 201, `HTTP ${ask.status} ${ask.body?.error?.code ?? ''}`);
check(
  'the answer states that no provider is configured instead of pretending',
  ask.body?.data?.geminiConfigured === false && ask.body?.data?.provider === 'LOCAL_RULE_ENGINE' &&
    String(ask.body?.data?.answer ?? '').includes('GEMINI_API_KEY is not configured'),
  `provider=${ask.body?.data?.provider}`,
);
check(
  'the answer is computed from real records, with references',
  (ask.body?.data?.dataRefs ?? []).length > 0 && ask.body?.data?.context?.totalRecords > 0,
  `${(ask.body?.data?.dataRefs ?? []).length} record(s) cited`,
);
check(
  'the caller is told which sections were used and which were withheld',
  Array.isArray(ask.body?.data?.context?.sections) && Array.isArray(ask.body?.data?.context?.withheld),
  `sections=${(ask.body?.data?.context?.sections ?? []).map((section) => section.key).join(',')} withheld=${(ask.body?.data?.context?.withheld ?? []).length}`,
);
check(
  'every answer carries the advisory disclaimer',
  String(ask.body?.data?.disclaimer ?? '').includes('advisory only'),
  String(ask.body?.data?.disclaimer ?? '').slice(0, 60),
);

const conversationId = ask.body?.data?.conversationId;
const followUp = await call('POST', '/ai/assistant/ask', {
  token,
  body: { conversationId, question: 'Et quelles alertes attendent une revue ?' },
});
check(
  'a follow-up joins the same conversation and is answered from the alert records',
  followUp.status === 201 && followUp.body?.data?.conversationId === conversationId && followUp.body?.data?.intent === 'ALERTS',
  `HTTP ${followUp.status} intent=${followUp.body?.data?.intent}`,
);
check(
  'the assistant describes signals as awaiting review, never as guilt',
  /awaiting a first review|signal/i.test(String(followUp.body?.data?.answer ?? '')) &&
    !/is guilty|illegal company|a commis/i.test(String(followUp.body?.data?.answer ?? '')),
  String(followUp.body?.data?.answer ?? '').slice(0, 100),
);

const conversation = await call('GET', `/ai/assistant/conversations/${conversationId}`, { token });
check(
  'the conversation stores both turns with their roles',
  conversation.status === 200 &&
    Array.isArray(conversation.body?.data?.messages) &&
    conversation.body.data.messages.length >= 4 &&
    conversation.body.data.messages.some((message) => message.role === 'USER') &&
    conversation.body.data.messages.some((message) => message.role === 'ASSISTANT'),
  `${conversation.body?.data?.messages?.length ?? 0} message(s)`,
);
check(
  'the stored context explains what the assistant was allowed to see',
  JSON.stringify(conversation.body?.data?.context ?? {}).includes('withheld'),
  'context recorded',
);

const conversations = await call('GET', '/ai/assistant/conversations?limit=10', { token });
check('GET /ai/assistant/conversations', conversations.status === 200 && (conversations.body?.data ?? []).length > 0, `total=${conversations.body?.meta?.total}`);

const foreignConversation = await call('GET', `/ai/assistant/conversations/${conversationId}`, { token: companyToken });
check(
  'another account cannot read someone else’s conversation',
  foreignConversation.status === 403 && foreignConversation.body?.error?.code === 'AI_CONVERSATION_FORBIDDEN',
  `HTTP ${foreignConversation.status} ${foreignConversation.body?.error?.code}`,
);

const invalidQuestion = await call('POST', '/ai/assistant/ask', { token, body: { question: 'ab' } });
check(
  'a question that is too short is refused',
  invalidQuestion.status === 400,
  `HTTP ${invalidQuestion.status} ${invalidQuestion.body?.error?.code}`,
);

console.log('\n— assistant authorisation for a company account —');
const companyAsk = await call('POST', '/ai/assistant/ask', {
  token: companyToken,
  body: { question: 'Quels paiements avons-nous payés ?' },
});
check('a company account may use the assistant', companyAsk.status === 201, `HTTP ${companyAsk.status} ${companyAsk.body?.error?.code ?? ''}`);
const companySections = (companyAsk.body?.data?.context?.sections ?? []).map((section) => section.key);
const companyWithheld = (companyAsk.body?.data?.context?.withheld ?? []).map((entry) => entry.section);
check(
  'the company context uses the company scope, not the regulatory one',
  companyAsk.body?.data?.context?.scope?.dataScope === 'company' &&
    companyAsk.body?.data?.context?.scope?.companyId === COMPANY,
  `dataScope=${companyAsk.body?.data?.context?.scope?.dataScope} companyId=${companyAsk.body?.data?.context?.scope?.companyId}`,
);
check(
  'the alert console is withheld from a company account',
  companyWithheld.includes('alerts') && !companySections.includes('alerts'),
  `sections=${companySections.join(',')} withheld=${companyWithheld.join(',')}`,
);
check(
  'the answer says that the figures are the company’s own',
  String(companyAsk.body?.data?.answer ?? '').includes('company account'),
  String(companyAsk.body?.data?.answer ?? '').slice(0, 90),
);

console.log('\n— archiving —');
const archived = await call('PATCH', `/ai/assistant/conversations/${conversationId}/archive`, { token });
check('PATCH …/archive', archived.status === 200 && archived.body?.data?.deleted !== true, `HTTP ${archived.status}`);
const afterArchive = await call('POST', '/ai/assistant/ask', {
  token,
  body: { conversationId, question: 'Quels permis sont actifs ?' },
});
check(
  'an archived conversation refuses new questions',
  afterArchive.status === 400 && afterArchive.body?.error?.code === 'AI_CONVERSATION_ARCHIVED',
  `HTTP ${afterArchive.status} ${afterArchive.body?.error?.code}`,
);
const deleted = await call('DELETE', `/ai/assistant/conversations/${conversationId}`, { token });
check('DELETE …/conversations/:id', deleted.status === 200 && deleted.body?.data?.deleted === true, `HTTP ${deleted.status}`);

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
console.log(`analysis=${run?.id} alertsRaised=${run?.alerts} sampleAlert=${firstAlertId ?? target.id}`);
process.exit(fail === 0 ? 0 : 1);
