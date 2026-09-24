import { ChecklistResult, InspectionOutcome, InspectionStatus } from '@prisma/client';

/**
 * Pure inspection lifecycle + compliance rules.
 *
 * An inspection is the human regulatory control of FEMS: a field officer visits
 * the site, answers the checklist with real GPS positions and evidence, then a
 * reviewer decides. No automated signal (including AI) can skip these steps.
 */

export const INSPECTION_ACTIONS = ['START', 'SUBMIT', 'REVIEW', 'CLOSE', 'CANCEL'] as const;
export type InspectionAction = (typeof INSPECTION_ACTIONS)[number];

export interface InspectionTransition {
  action: InspectionAction;
  label: string;
  from: InspectionStatus[];
  to: InspectionStatus;
  requiresReason: boolean;
  /** Only the assigned inspector (or an administrator) may perform it. */
  inspectorOnly: boolean;
}

export const INSPECTION_TRANSITIONS: Record<InspectionAction, InspectionTransition> = {
  START: {
    action: 'START',
    label: 'Start field inspection',
    from: [InspectionStatus.SCHEDULED],
    to: InspectionStatus.IN_PROGRESS,
    requiresReason: false,
    inspectorOnly: true,
  },
  SUBMIT: {
    action: 'SUBMIT',
    label: 'Submit inspection report',
    from: [InspectionStatus.IN_PROGRESS],
    to: InspectionStatus.SUBMITTED,
    requiresReason: false,
    inspectorOnly: true,
  },
  REVIEW: {
    action: 'REVIEW',
    label: 'Review submitted inspection',
    from: [InspectionStatus.SUBMITTED],
    to: InspectionStatus.REVIEWED,
    requiresReason: false,
    inspectorOnly: false,
  },
  CLOSE: {
    action: 'CLOSE',
    label: 'Close inspection',
    from: [InspectionStatus.REVIEWED],
    to: InspectionStatus.CLOSED,
    requiresReason: false,
    inspectorOnly: false,
  },
  CANCEL: {
    action: 'CANCEL',
    label: 'Cancel inspection',
    from: [InspectionStatus.SCHEDULED, InspectionStatus.IN_PROGRESS],
    to: InspectionStatus.CANCELLED,
    requiresReason: true,
    inspectorOnly: false,
  },
};

export interface TransitionCheck {
  ok: boolean;
  code?: 'INSPECTION_ACTION_UNKNOWN' | 'INSPECTION_INVALID_TRANSITION' | 'REASON_REQUIRED';
  message?: string;
  transition?: InspectionTransition;
}

export function isInspectionAction(value: string): value is InspectionAction {
  return (INSPECTION_ACTIONS as readonly string[]).includes(value.toUpperCase());
}

export function checkInspectionTransition(
  action: string,
  currentStatus: InspectionStatus,
  reason?: string | null,
): TransitionCheck {
  const normalised = action.toUpperCase();
  if (!isInspectionAction(normalised)) {
    return {
      ok: false,
      code: 'INSPECTION_ACTION_UNKNOWN',
      message: `Unknown inspection action ${action}. Expected one of: ${INSPECTION_ACTIONS.join(', ')}.`,
    };
  }
  const transition = INSPECTION_TRANSITIONS[normalised];
  if (!transition.from.includes(currentStatus)) {
    return {
      ok: false,
      code: 'INSPECTION_INVALID_TRANSITION',
      message: `An inspection in status ${currentStatus} cannot be ${normalised.toLowerCase()}ed.`,
    };
  }
  if (transition.requiresReason && !reason) {
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message: `A reason is required to ${normalised.toLowerCase()} an inspection.`,
    };
  }
  return { ok: true, transition };
}

/** Only scheduled or in-progress inspections can still be edited. */
export function isInspectionEditable(status: InspectionStatus): boolean {
  return status === InspectionStatus.SCHEDULED || status === InspectionStatus.IN_PROGRESS;
}

export interface ChecklistItemInput {
  result: ChecklistResult;
}

export interface ComplianceResult {
  /** 0–100, or null when no checklist item is applicable. */
  score: number | null;
  applicable: number;
  passed: number;
  failed: number;
  notApplicable: number;
}

/**
 * Compliance score = share of applicable checklist items that passed.
 * `NOT_APPLICABLE` items are excluded so a short checklist cannot inflate the
 * score, and a checklist with no applicable item yields `null` (no score),
 * never 0 or 100.
 */
export function computeComplianceScore(items: ChecklistItemInput[]): ComplianceResult {
  const passed = items.filter((item) => item.result === ChecklistResult.PASS).length;
  const failed = items.filter((item) => item.result === ChecklistResult.FAIL).length;
  const notApplicable = items.filter((item) => item.result === ChecklistResult.NOT_APPLICABLE).length;
  const applicable = passed + failed;
  if (applicable === 0) {
    return { score: null, applicable, passed, failed, notApplicable };
  }
  return { score: Math.round((passed / applicable) * 100), applicable, passed, failed, notApplicable };
}

/** The outcome an inspector must justify: PASS/FAIL results drive the verdict. */
export function outcomeMatchesChecklist(outcome: InspectionOutcome, compliance: ComplianceResult): boolean {
  if (outcome === InspectionOutcome.COMPLIANT) return compliance.failed === 0;
  return compliance.failed > 0;
}

/** Distance beyond which an inspection is refused as implausible for the site. */
export const INSPECTION_SITE_WARN_M = 1_000;
export const INSPECTION_SITE_MAX_M = 25_000;

export interface SiteDistanceCheck {
  ok: boolean;
  code?: 'INSPECTION_TOO_FAR_FROM_SITE';
  message?: string;
  warning?: string | null;
  distanceM: number;
}

/**
 * Compares the GPS position captured on site with the position of the activity
 * being inspected. A field report filed tens of kilometres away from the site is
 * rejected; a report slightly off-site (thick canopy, access road) is accepted
 * with a warning stored on the record.
 */
export function checkSiteDistance(distanceM: number): SiteDistanceCheck {
  if (!Number.isFinite(distanceM)) {
    return { ok: true, warning: null, distanceM: Number.NaN };
  }
  if (distanceM > INSPECTION_SITE_MAX_M) {
    return {
      ok: false,
      code: 'INSPECTION_TOO_FAR_FROM_SITE',
      message: `The captured position is ${Math.round(distanceM)} m away from the inspected site (limit ${INSPECTION_SITE_MAX_M} m).`,
      distanceM,
    };
  }
  if (distanceM > INSPECTION_SITE_WARN_M) {
    return {
      ok: true,
      warning: `The captured position is ${Math.round(distanceM)} m away from the inspected site.`,
      distanceM,
    };
  }
  return { ok: true, warning: null, distanceM };
}

/**
 * Default checklist template per inspection type. Used when an inspection is
 * created without an explicit checklist; every item can still be answered
 * `NOT_APPLICABLE` in the field.
 */
export const INSPECTION_CHECKLIST_TEMPLATES: Record<string, Array<{ code: string; label: string }>> = {
  ROUTINE: [
    { code: 'ROU-01', label: 'Permit displayed and valid on site' },
    { code: 'ROU-02', label: 'Boundary marks of the cutting area respected' },
    { code: 'ROU-03', label: 'Harvest volumes match the activity register' },
    { code: 'ROU-04', label: 'Felled trees marked and recorded' },
    { code: 'ROU-05', label: 'Access road and drainages maintained' },
  ],
  COMPLIANCE: [
    { code: 'COM-01', label: 'Permit conditions implemented' },
    { code: 'COM-02', label: 'Protected species left standing' },
    { code: 'COM-03', label: 'Diameter and species quotas respected' },
    { code: 'COM-04', label: 'Harvest register complete and up to date' },
    { code: 'COM-05', label: 'Safety equipment available to the crew' },
  ],
  ENVIRONMENTAL: [
    { code: 'ENV-01', label: 'Water bodies protected (buffer strips kept)' },
    { code: 'ENV-02', label: 'No illegal dumping of waste or oil' },
    { code: 'ENV-03', label: 'Soil erosion control in place' },
    { code: 'ENV-04', label: 'Wildlife corridors preserved' },
    { code: 'ENV-05', label: 'Protected area boundary respected' },
  ],
  POST_ACTIVITY: [
    { code: 'POS-01', label: 'Site cleared of harvest debris' },
    { code: 'POS-02', label: 'Harvested volume verified against declarations' },
    { code: 'POS-03', label: 'Replanting or regeneration obligations met' },
    { code: 'POS-04', label: 'Temporary infrastructure removed' },
  ],
  INCIDENT: [
    { code: 'INC-01', label: 'Incident area secured' },
    { code: 'INC-02', label: 'Witnesses and parties identified' },
    { code: 'INC-03', label: 'Damage assessed and photographed' },
    { code: 'INC-04', label: 'Immediate corrective action agreed' },
  ],
  VERIFICATION: [
    { code: 'VER-01', label: 'Declared volumes and species verified' },
    { code: 'VER-02', label: 'Transport documents match the load' },
    { code: 'VER-03', label: 'Equipment registered on site' },
    { code: 'VER-04', label: 'GPS position of the verification captured' },
  ],
};

export function defaultChecklist(type: string): Array<{ code: string; label: string }> {
  return INSPECTION_CHECKLIST_TEMPLATES[type.toUpperCase()] ?? INSPECTION_CHECKLIST_TEMPLATES.ROUTINE;
}
