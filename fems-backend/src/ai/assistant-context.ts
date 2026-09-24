/**
 * Forest Assistant — authorisation-first context building.
 *
 * The assistant can only ever see what the caller is allowed to read: the
 * sections below are selected from the caller's own permissions *before* any
 * question is sent to a provider, and a company account is additionally pinned
 * to its own records. The provider therefore receives a bounded, explicitly
 * labelled extract — never the database, never another organisation's data.
 */

export type AssistantSectionKey =
  | 'forests'
  | 'permits'
  | 'activities'
  | 'inspections'
  | 'violations'
  | 'payments'
  | 'alerts'
  | 'reports';

export interface AssistantSectionDefinition {
  key: AssistantSectionKey;
  label: string;
  /** Permission that opens this section; `read_own` holders get their own rows. */
  permission: string;
  description: string;
}

export const ASSISTANT_SECTIONS: AssistantSectionDefinition[] = [
  { key: 'forests', label: 'Forest register', permission: 'forests', description: 'Forests, zones and protected areas the caller may read.' },
  { key: 'permits', label: 'Permits', permission: 'permits', description: 'Exploitation permits, their volumes, validity and fee position.' },
  { key: 'activities', label: 'Exploitation activities', permission: 'exploitation', description: 'Planned and recorded field activities with harvested volumes.' },
  { key: 'inspections', label: 'Inspections', permission: 'inspections', description: 'Field inspections, outcomes and compliance scores.' },
  { key: 'violations', label: 'Environmental cases', permission: 'environmental', description: 'Cases opened from documented evidence and their status.' },
  { key: 'payments', label: 'Payments', permission: 'payments', description: 'Fees, penalties and their settlement position.' },
  { key: 'alerts', label: 'AI alerts', permission: 'ai', description: 'Signals raised by the rule engine and their review status.' },
  { key: 'reports', label: 'Reports', permission: 'reports', description: 'Generated regulatory reports and exports.' },
];

export interface AssistantRecord {
  id: string;
  label: string;
  details: Record<string, string | number | null>;
}

export interface AssistantSnapshot {
  generatedAt: Date;
  /** Set when the caller belongs to a company — the context is then company-limited. */
  companyId: string | null;
  sections: Record<AssistantSectionKey, AssistantRecord[]>;
}

export interface SectionDecision {
  key: AssistantSectionKey;
  label: string;
  included: boolean;
  reason: string;
}

export interface AssistantContext {
  generatedAt: Date;
  companyId: string | null;
  sections: Array<{ key: AssistantSectionKey; label: string; records: AssistantRecord[] }>;
  withheld: Array<{ section: AssistantSectionKey; label: string; reason: string }>;
  decisions: SectionDecision[];
  totalRecords: number;
}

/** Longest question accepted by the assistant. */
export const ASSISTANT_MAX_QUESTION_LENGTH = 800;
export const ASSISTANT_MIN_QUESTION_LENGTH = 3;
/** Context rows per section sent to a provider — keeps the prompt bounded. */
export const ASSISTANT_MAX_RECORDS_PER_SECTION = 15;
/** Hard character ceiling for the rendered context. */
export const ASSISTANT_MAX_CONTEXT_CHARS = 12_000;

export const ASSISTANT_DISCLAIMER =
  'The assistant is advisory only: it summarises records held in FEMS, it does not accuse anybody and it never replaces an officer’s decision.';

export const ASSISTANT_SYSTEM_INSTRUCTION = [
  'You are the Forest Assistant of FEMS (Forest Exploitation Management System), used by the forestry services of Cameroon.',
  'You answer strictly from the JSON context provided by FEMS for this question. If the context does not contain the answer, say so plainly instead of guessing.',
  'Never state or imply that a company, an organisation or a person has broken the law, is illegal, or is guilty. AI signals in FEMS are unverified until an officer confirms them; describe them as "signals awaiting review" and point to the review status.',
  'Never invent identifiers, volumes, amounts, dates or references: quote only what the context contains, with its units.',
  'Never promise an outcome, never issue an authorisation, never give legal advice. Where a decision is needed, name the responsible role and the next procedural step.',
  'Respect confidentiality: only the data in this context may be mentioned, and only aggregate it when the caller is a company account.',
  'Answer in the language of the question (French or English), in at most six short paragraphs, with figures rounded as they appear in the context.',
].join(' ');

/** Selects the sections a caller may see, and records why the others are withheld. */
export function selectSections(permissions: string[]): { allowed: AssistantSectionKey[]; decisions: SectionDecision[] } {
  const wildcard = permissions.includes('*');
  const decisions: SectionDecision[] = ASSISTANT_SECTIONS.map((section) => {
    const hasFull = wildcard || permissions.includes(`${section.permission}:read`);
    const hasOwn = permissions.includes(`${section.permission}:read_own`);
    return {
      key: section.key,
      label: section.label,
      included: hasFull || hasOwn,
      reason: hasFull
        ? 'Full read access to this module.'
        : hasOwn
          ? 'Access limited to the caller’s own records.'
          : `Withheld: the caller does not hold ${section.permission}:read or ${section.permission}:read_own.`,
    };
  });
  return { allowed: decisions.filter((decision) => decision.included).map((decision) => decision.key), decisions };
}

/** Applies the selection to a snapshot, capping each section. */
export function buildAssistantContext(
  snapshot: AssistantSnapshot,
  allowed: AssistantSectionKey[],
  decisions: SectionDecision[] = [],
): AssistantContext {
  const sections: AssistantContext['sections'] = [];
  const withheld: AssistantContext['withheld'] = [];
  let totalRecords = 0;

  for (const definition of ASSISTANT_SECTIONS) {
    const records = snapshot.sections[definition.key] ?? [];
    if (!allowed.includes(definition.key)) {
      withheld.push({
        section: definition.key,
        label: definition.label,
        reason: `Not included: the caller cannot read ${definition.label.toLowerCase()}.`,
      });
      continue;
    }
    const capped = records.slice(0, ASSISTANT_MAX_RECORDS_PER_SECTION);
    totalRecords += capped.length;
    sections.push({ key: definition.key, label: definition.label, records: capped });
  }

  return {
    generatedAt: snapshot.generatedAt,
    companyId: snapshot.companyId,
    sections,
    withheld,
    decisions: decisions.length ? decisions : [],
    totalRecords,
  };
}

/** Renders the context as the JSON document handed to the provider. */
export function renderContextForProvider(context: AssistantContext): string {
  const payload: {
    generatedAt: string;
    scope: string;
    sections: Array<{ section: string; records: Array<Record<string, unknown>> }>;
    withheld: string[];
    truncation?: string;
  } = {
    generatedAt: context.generatedAt.toISOString(),
    scope: context.companyId ? 'company-scoped' : 'regulatory',
    sections: context.sections.map((section) => ({
      section: section.label,
      records: section.records.map((record) => ({ reference: record.label, ...record.details })),
    })),
    withheld: context.withheld.map((entry) => entry.label),
  };
  let rendered = JSON.stringify(payload, null, 2);
  let truncationNote: string | null = null;

  // Halve the richest section repeatedly until the document fits. Section
  // headings and the withheld list always survive, so the model can never
  // mistake "not included" for "nothing recorded".
  while (rendered.length > ASSISTANT_MAX_CONTEXT_CHARS) {
    const richest = payload.sections.reduce(
      (largest, section) => (section.records.length > largest.records.length ? section : largest),
      payload.sections[0],
    );
    if (!richest || richest.records.length === 0) break;
    const keep = Math.floor(richest.records.length / 2);
    truncationNote = `Only ${keep} of ${richest.records.length} ${richest.section} records fitted the context budget.`;
    richest.records = richest.records.slice(0, keep);
    rendered = JSON.stringify(payload, null, 2);
  }

  if (rendered.length > ASSISTANT_MAX_CONTEXT_CHARS) {
    truncationNote =
      'The records themselves were too large for the context budget: only the sections and their counts are available.';
    payload.sections = payload.sections.map((section) => ({ ...section, records: [] }));
    rendered = JSON.stringify(payload, null, 2);
  }

  if (truncationNote) {
    payload.truncation = truncationNote;
    rendered = JSON.stringify(payload, null, 2);
  }
  return rendered;
}

export type AssistantIntent =
  | 'PERMITS'
  | 'HARVEST'
  | 'PAYMENTS'
  | 'INSPECTIONS'
  | 'VIOLATIONS'
  | 'ALERTS'
  | 'FORESTS'
  | 'REPORTS'
  | 'GREETING'
  | 'UNKNOWN';

const INTENT_KEYWORDS: Array<{ intent: AssistantIntent; words: string[] }> = [
  { intent: 'GREETING', words: ['bonjour', 'salut', 'hello', 'hi', 'bonsoir', 'coucou'] },
  { intent: 'ALERTS', words: ['alerte', 'alert', 'signal', 'anomalie', 'anomaly', 'risque', 'risk', 'ia'] },
  { intent: 'VIOLATIONS', words: ['violation', 'infraction', 'case', 'cases', 'dossier', 'sanction', 'pénalité', 'penalty', 'amende', 'litige'] },
  {
    intent: 'PAYMENTS',
    words: [
      'paiement',
      'payment',
      'payé',
      'payer',
      'payons',
      'facture',
      'fee',
      'fees',
      'frais',
      'redevance',
      'impayé',
      'solde',
      'recette',
      'receipt',
      'reçu',
      'encaiss',
      'collecté',
    ],
  },
  { intent: 'INSPECTIONS', words: ['inspection', 'control', 'contrôle', 'mission', 'vérification', 'compliance', 'conformité'] },
  {
    intent: 'HARVEST',
    words: ['récolte', 'recolte', 'harvest', 'volume', 'abattage', 'felling', 'coupe', 'bois', 'm3', 'm³', 'arbre', 'tree', 'trees'],
  },
  { intent: 'PERMITS', words: ['permis', 'permit', 'autorisation', 'licence', 'agrément', 'demande', 'application', 'validité'] },
  { intent: 'FORESTS', words: ['forêt', 'forest', 'zone', 'zones', 'parcelle', 'ufa', 'concession'] },
  { intent: 'REPORTS', words: ['rapport', 'report', 'export', 'bilan', 'statistique', 'statistics', 'résumé'] },
];

/**
 * Token matcher with a conservative stem rule: a token matches a keyword when it
 * is the same word, or — for keywords of five letters or more — starts with it
 * ("paiements" matches "paiement", but "histoire" never matches "hi").
 */
function mentions(tokens: string[], word: string): boolean {
  return tokens.some((token) => token === word || (word.length >= 5 && token.startsWith(word)));
}

/** Cheap, deterministic intent routing (no provider needed, also used as a hint). */
export function detectIntent(question: string): AssistantIntent {
  const tokens = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const entry of INTENT_KEYWORDS) {
    if (entry.words.some((word) => mentions(tokens, word))) return entry.intent;
  }
  return 'UNKNOWN';
}

export interface AssistantAnswer {
  text: string;
  intent: AssistantIntent;
  sectionsUsed: AssistantSectionKey[];
  dataRefs: Array<{ entityType: string; id: string; label: string }>;
}

const formatRecord = (record: AssistantRecord, fields: string[]): string => {
  const parts = fields
    .map((field) => {
      const value = record.details[field];
      return value === null || value === undefined || value === '' ? null : `${field}=${value}`;
    })
    .filter((part): part is string => part !== null);
  return parts.length ? `${record.label} (${parts.join(', ')})` : record.label;
};

const sectionOf = (context: AssistantContext, key: AssistantSectionKey) =>
  context.sections.find((section) => section.key === key)?.records ?? [];

/**
 * Deterministic answer used when no provider is configured (or when the caller
 * asks for rule-engine answers). It really reads the context: every sentence
 * comes from a stored record, and nothing is invented.
 */
export function answerFromContext(question: string, context: AssistantContext): AssistantAnswer {
  const intent = detectIntent(question);
  const refsOf = (key: AssistantSectionKey) =>
    sectionOf(context, key).map((record) => ({ entityType: key, id: record.id, label: record.label }));

  const scopeLine = context.companyId
    ? 'Your account is a company account: the figures below cover your organisation’s records only.'
    : 'Figures cover the records your role is authorised to read.';

  switch (intent) {
    case 'GREETING': {
      return {
        text:
          'Bonjour. I am the FEMS Forest Assistant. I can summarise the permits, exploitation activities, inspections, environmental cases, payments and AI signals that your account is allowed to read. ' +
          `${scopeLine} Ask me for example: "Quels permis sont actifs ?", "Quelles inspections ont trouvé une non-conformité ?", "Quelles alertes attendent une revue ?"`,
        intent,
        sectionsUsed: [],
        dataRefs: [],
      };
    }
    case 'PERMITS': {
      const records = sectionOf(context, 'permits');
      return {
        text: records.length
          ? `I can see ${records.length} permit record(s) in your scope. ${records
              .slice(0, 8)
              .map((record) => formatRecord(record, ['status', 'volumeApprovedM3', 'validity', 'outstandingXAF']))
              .join('; ')}. ${scopeLine}`
          : `No permit is visible to your account in FEMS today. ${scopeLine}`,
        intent,
        sectionsUsed: ['permits'],
        dataRefs: refsOf('permits'),
      };
    }
    case 'HARVEST': {
      const records = sectionOf(context, 'activities');
      const total = records.reduce((sum, record) => sum + Number(record.details.harvestedVolumeM3 ?? 0), 0);
      return {
        text: records.length
          ? `The ${records.length} exploitation activities in your scope recorded ${Math.round(total * 100) / 100} m³ harvested. Most recent: ${records
              .slice(0, 6)
              .map((record) => formatRecord(record, ['status', 'harvestedVolumeM3', 'plannedVolumeM3']))
              .join('; ')}. ${scopeLine}`
          : `No exploitation activity is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['activities'],
        dataRefs: refsOf('activities'),
      };
    }
    case 'PAYMENTS': {
      const records = sectionOf(context, 'payments');
      const settled = records.filter((record) => record.details.status === 'SUCCESSFUL');
      const total = settled.reduce((sum, record) => sum + Number(record.details.amount ?? 0), 0);
      return {
        text: records.length
          ? `${records.length} payment record(s) are in your scope, of which ${settled.length} settled — ${Math.round(total * 100) / 100} XAF collected. Recent: ${records
              .slice(0, 6)
              .map((record) => formatRecord(record, ['status', 'amount', 'purpose']))
              .join('; ')}. Only provider-confirmed payments count as settled. ${scopeLine}`
          : `No payment is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['payments'],
        dataRefs: refsOf('payments'),
      };
    }
    case 'INSPECTIONS': {
      const records = sectionOf(context, 'inspections');
      const scored = records.filter((record) => Number(record.details.complianceScore ?? 0) > 0);
      const average = scored.length
        ? Math.round(scored.reduce((sum, record) => sum + Number(record.details.complianceScore), 0) / scored.length)
        : null;
      return {
        text: records.length
          ? `${records.length} inspection(s) are in your scope${average === null ? '' : `, with an average compliance score of ${average}/100`}. ${records
              .slice(0, 6)
              .map((record) => formatRecord(record, ['status', 'outcome', 'complianceScore']))
              .join('; ')}. ${scopeLine}`
          : `No inspection is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['inspections'],
        dataRefs: refsOf('inspections'),
      };
    }
    case 'VIOLATIONS': {
      const records = sectionOf(context, 'violations');
      const open = records.filter((record) => !['RESOLVED', 'DISMISSED', 'CLOSED'].includes(String(record.details.status)));
      return {
        text: records.length
          ? `${records.length} environmental case(s) are in your scope, ${open.length} still open. ${records
              .slice(0, 8)
              .map((record) => formatRecord(record, ['status', 'severity', 'penaltyXAF']))
              .join('; ')}. A case is only opened from documented field evidence, and only an officer decides its outcome. ${scopeLine}`
          : `No environmental case is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['violations'],
        dataRefs: refsOf('violations'),
      };
    }
    case 'ALERTS': {
      const records = sectionOf(context, 'alerts');
      const awaiting = records.filter((record) => record.details.status === 'NEW');
      return {
        text: records.length
          ? `The rule engine raised ${records.length} signal(s) in your scope, ${awaiting.length} still awaiting a first review. ${records
              .slice(0, 8)
              .map((record) => formatRecord(record, ['type', 'riskLevel', 'status']))
              .join('; ')}. Signals are not findings: they become regulatory only when an officer confirms them. ${scopeLine}`
          : `No AI signal is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['alerts'],
        dataRefs: refsOf('alerts'),
      };
    }
    case 'FORESTS': {
      const records = sectionOf(context, 'forests');
      return {
        text: records.length
          ? `${records.length} forest/zone record(s) are in your scope: ${records
              .slice(0, 8)
              .map((record) => formatRecord(record, ['region', 'areaHa', 'status']))
              .join('; ')}. ${scopeLine}`
          : `No forest record is visible to your account. ${scopeLine}`,
        intent,
        sectionsUsed: ['forests'],
        dataRefs: refsOf('forests'),
      };
    }
    case 'REPORTS': {
      const records = sectionOf(context, 'reports');
      return {
        text: records.length
          ? `${records.length} report(s) are in your scope: ${records
              .slice(0, 8)
              .map((record) => formatRecord(record, ['type', 'format', 'status']))
              .join('; ')}. Reports are generated from the live database and can be downloaded in PDF, CSV or JSON. ${scopeLine}`
          : `No report is visible to your account yet. ${scopeLine}`,
        intent,
        sectionsUsed: ['reports'],
        dataRefs: refsOf('reports'),
      };
    }
    default: {
      const overview = context.sections
        .map((section) => `${section.label}: ${section.records.length}`)
        .join(', ');
      const redacted = context.withheld.length
        ? ` Sections withheld from this answer: ${context.withheld.map((entry) => entry.label).join(', ')}.`
        : '';
      return {
        text:
          `I did not recognise a precise question, so here is what your account can see in FEMS: ${overview || 'no records in scope'}.${redacted} ` +
          `Ask about permits, harvested volumes, payments, inspections, environmental cases or AI signals, and I will answer from those records. ${ASSISTANT_DISCLAIMER}`,
        intent,
        sectionsUsed: context.sections.map((section) => section.key),
        dataRefs: [],
      };
    }
  }
}
