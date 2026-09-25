import {
  ASSISTANT_DISCLAIMER,
  ASSISTANT_MAX_CONTEXT_CHARS,
  ASSISTANT_MAX_RECORDS_PER_SECTION,
  ASSISTANT_SECTIONS,
  ASSISTANT_SYSTEM_INSTRUCTION,
  answerFromContext,
  buildAssistantContext,
  detectIntent,
  renderContextForProvider,
  selectSections,
  type AssistantSectionKey,
  type AssistantSnapshot,
} from './assistant-context';

const NOW = new Date('2026-06-10T12:00:00Z');

const EMPTY_SECTIONS: Record<AssistantSectionKey, AssistantSnapshot['sections'][AssistantSectionKey]> = {
  forests: [],
  permits: [],
  activities: [],
  inspections: [],
  violations: [],
  payments: [],
  alerts: [],
  reports: [],
};

function snapshot(overrides: Partial<AssistantSnapshot['sections']> = {}, companyId: string | null = null): AssistantSnapshot {
  return { generatedAt: NOW, companyId, sections: { ...EMPTY_SECTIONS, ...overrides } };
}

const ALL_PERMISSIONS = ['*'];

describe('assistant-context', () => {
  describe('selectSections', () => {
    it('opens every section for an administrator', () => {
      const { allowed } = selectSections(ALL_PERMISSIONS);
      expect(allowed).toHaveLength(ASSISTANT_SECTIONS.length);
    });

    it('opens nothing without permissions', () => {
      const { allowed, decisions } = selectSections([]);
      expect(allowed).toEqual([]);
      expect(decisions.every((decision) => !decision.included)).toBe(true);
    });

    it('gives a company account only its own-scope sections', () => {
      const { allowed } = selectSections([
        'forests:read',
        'permits:read_own',
        'exploitation:read_own',
        'payments:read_own',
        'reports:read_own',
        'ai:assistant_use',
      ]);
      expect(allowed).toEqual(['forests', 'permits', 'activities', 'payments', 'reports']);
      expect(allowed).not.toContain('alerts');
      expect(allowed).not.toContain('violations');
    });

    it('records why a section was withheld', () => {
      const { decisions } = selectSections(['forests:read']);
      const alerts = decisions.find((decision) => decision.key === 'alerts');
      expect(alerts?.included).toBe(false);
      expect(alerts?.reason).toContain('ai:read');
    });

    it('explains the difference between full and own-only access', () => {
      const { decisions } = selectSections(['permits:read_own']);
      const permits = decisions.find((decision) => decision.key === 'permits');
      expect(permits?.included).toBe(true);
      expect(permits?.reason).toContain('own records');
    });
  });

  describe('buildAssistantContext', () => {
    const permits = Array.from({ length: 40 }, (_, index) => ({
      id: `permit-${index}`,
      label: `FEMS-EXP-2026-${index.toString().padStart(4, '0')}`,
      details: { status: 'ACTIVE' },
    }));

    it('only keeps the sections the caller may read', () => {
      const context = buildAssistantContext(snapshot({ permits, violations: [{ id: 'v1', label: 'VIO-1', details: {} }] }), ['permits']);
      expect(context.sections.map((section) => section.key)).toEqual(['permits']);
      expect(context.withheld.map((entry) => entry.section)).toContain('violations');
    });

    it('caps the records per section so a prompt stays bounded', () => {
      const context = buildAssistantContext(snapshot({ permits }), ['permits']);
      expect(context.sections[0].records).toHaveLength(ASSISTANT_MAX_RECORDS_PER_SECTION);
    });

    it('keeps the company scope visible in the context', () => {
      const context = buildAssistantContext(snapshot({ permits }, 'company-1'), ['permits']);
      expect(context.companyId).toBe('company-1');
    });

    it('counts what was actually sent', () => {
      const context = buildAssistantContext(snapshot({ permits, payments: [{ id: 'p1', label: 'PAY-1', details: {} }] }), [
        'permits',
        'payments',
      ]);
      expect(context.totalRecords).toBe(ASSISTANT_MAX_RECORDS_PER_SECTION + 1);
    });
  });

  describe('renderContextForProvider', () => {
    it('renders a JSON document with the sections and the withheld list', () => {
      const context = buildAssistantContext(
        snapshot({ permits: [{ id: 'permit-1', label: 'FEMS-EXP-2026-0001', details: { status: 'ACTIVE', volumeApprovedM3: 1000 } }] }),
        ['permits'],
      );
      const rendered = JSON.parse(renderContextForProvider(context));
      expect(rendered.sections[0].section).toBe('Permits');
      expect(rendered.sections[0].records[0].reference).toBe('FEMS-EXP-2026-0001');
      expect(rendered.withheld).toContain('AI alerts');
      expect(rendered.scope).toBe('regulatory');
    });

    it('marks a company-scoped context', () => {
      const context = buildAssistantContext(snapshot({}, 'company-9'), []);
      expect(JSON.parse(renderContextForProvider(context)).scope).toBe('company-scoped');
    });

    it('never exceeds the hard character ceiling', () => {
      const permits = Array.from({ length: ASSISTANT_MAX_RECORDS_PER_SECTION }, (_, index) => ({
        id: `permit-${index}`,
        label: `FEMS-EXP-2026-${index}`,
        details: { description: 'x'.repeat(2000), status: 'ACTIVE' },
      }));
      const context = buildAssistantContext(snapshot({ permits }), ['permits']);
      expect(renderContextForProvider(context).length).toBeLessThanOrEqual(ASSISTANT_MAX_CONTEXT_CHARS);
    });

    it('says which sections were left out, so the model cannot imply they were empty', () => {
      const context = buildAssistantContext(snapshot({ permits: [] }), ['permits']);
      const rendered = JSON.parse(renderContextForProvider(context));
      expect(rendered.withheld.length).toBeGreaterThan(0);
    });
  });

  describe('detectIntent', () => {
    it('routes French and English questions', () => {
      expect(detectIntent('Quels permis sont actifs ?')).toBe('PERMITS');
      expect(detectIntent('how much volume was harvested last month?')).toBe('HARVEST');
      expect(detectIntent('Quels paiements restent impayés ?')).toBe('PAYMENTS');
      expect(detectIntent('liste les inspections non conformes')).toBe('INSPECTIONS');
      expect(detectIntent('quelles alertes attendent une revue ?')).toBe('ALERTS');
      expect(detectIntent('combien de dossiers de violation sont ouverts ?')).toBe('VIOLATIONS');
      expect(detectIntent('superficie de la forêt de Ngoyang')).toBe('FORESTS');
      expect(detectIntent('génère un rapport de synthèse')).toBe('REPORTS');
      expect(detectIntent('bonjour')).toBe('GREETING');
      expect(detectIntent('quelle est la météo ?')).toBe('UNKNOWN');
    });

    it('prefers the most specific intent when keywords overlap', () => {
      // "alerte" is checked before the generic forest words.
      expect(detectIntent('alerte sur la forêt de Ngoyang')).toBe('ALERTS');
    });
  });

  describe('answerFromContext', () => {
    const context = buildAssistantContext(
      snapshot({
        permits: [
          {
            id: 'permit-1',
            label: 'FEMS-EXP-2026-0001',
            details: { status: 'ACTIVE', volumeApprovedM3: 1000, validity: '2026-01-01 → 2026-12-31' },
          },
        ],
        activities: [
          { id: 'activity-1', label: 'ACT-20260501-AAAAAA', details: { status: 'IN_PROGRESS', harvestedVolumeM3: 120.5, plannedVolumeM3: 200 } },
          { id: 'activity-2', label: 'ACT-20260502-BBBBBB', details: { status: 'COMPLETED', harvestedVolumeM3: 79.5, plannedVolumeM3: 80 } },
        ],
        payments: [
          { id: 'payment-1', label: 'PAY-PER-2026', details: { status: 'SUCCESSFUL', amount: 2_500_000, purpose: 'PERMIT_FEE' } },
          { id: 'payment-2', label: 'PAY-PEN-2026', details: { status: 'PENDING', amount: 400_000, purpose: 'PENALTY' } },
        ],
        alerts: [{ id: 'alert-1', label: 'ALR-20260610-ABC123', details: { type: 'OVER_HARVESTING', riskLevel: 'HIGH', status: 'NEW' } }],
      }),
      ['permits', 'activities', 'payments', 'alerts'],
    );

    it('answers a permit question from the stored figures', () => {
      const answer = answerFromContext('Quels permis sont actifs ?', context);
      expect(answer.intent).toBe('PERMITS');
      expect(answer.text).toContain('FEMS-EXP-2026-0001');
      expect(answer.text).toContain('ACTIVE');
      expect(answer.dataRefs[0].id).toBe('permit-1');
    });

    it('adds up harvested volumes across the visible activities', () => {
      const answer = answerFromContext('Quel volume a été récolté ?', context);
      expect(answer.intent).toBe('HARVEST');
      expect(answer.text).toContain('200 m³');
    });

    it('counts only provider-settled payments as collected', () => {
      const answer = answerFromContext('Combien avons-nous payé ?', context);
      expect(answer.text).toContain('2500000 XAF');
      expect(answer.text).toContain('provider-confirmed');
    });

    it('describes alerts as signals awaiting a review, not as findings', () => {
      const answer = answerFromContext('Quelles alertes attendent une revue ?', context);
      expect(answer.text).toContain('awaiting a first review');
      expect(answer.text).toContain('not findings');
    });

    it('says plainly when a section is empty instead of inventing data', () => {
      const empty = buildAssistantContext(snapshot(), ['permits']);
      const answer = answerFromContext('Quels permis sont actifs ?', empty);
      expect(answer.text).toContain('No permit is visible');
    });

    it('falls back to an overview for an unrecognised question and lists what was withheld', () => {
      const answer = answerFromContext('raconte-moi une histoire', context);
      expect(answer.intent).toBe('UNKNOWN');
      expect(answer.text).toContain('Permits: 1');
      expect(answer.text).toContain('Sections withheld from this answer');
      expect(answer.text).toContain('withheld');
      expect(answer.text).toContain(ASSISTANT_DISCLAIMER);
    });

    it('tells a company account that the figures are its own', () => {
      const companyContext = buildAssistantContext(snapshot({ permits: context.sections[0].records }, 'company-1'), ['permits']);
      expect(answerFromContext('nos permis', companyContext).text).toContain('company account');
    });

    it('greets without touching data', () => {
      const answer = answerFromContext('bonjour', context);
      expect(answer.intent).toBe('GREETING');
      expect(answer.dataRefs).toEqual([]);
      expect(answer.text).toContain('Forest Assistant');
    });
  });

  describe('policy text', () => {
    it('forbids the model from accusing anybody', () => {
      expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/Never state or imply that a company/i);
      expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/signals awaiting review/i);
      expect(ASSISTANT_SYSTEM_INSTRUCTION).toMatch(/never invent/i);
    });

    it('requires an answer in the language of the question', () => {
      expect(ASSISTANT_SYSTEM_INSTRUCTION).toContain('French or English');
    });

    it('states that the assistant is advisory only', () => {
      expect(ASSISTANT_DISCLAIMER).toContain('advisory only');
      expect(ASSISTANT_DISCLAIMER).toContain('never replaces');
    });
  });
});
