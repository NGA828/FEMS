import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AiAnalysisStatus,
  AiAnalysisType,
  AiProvider,
  AlertStatus,
  AuditAction,
  AuditSeverity,
  GisFeatureType,
  NotificationType,
  Prisma,
  ReportStatus,
  RiskLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GisService } from '../gis/gis.service';
import { appConfig } from '../config/configuration';
import { parseJsonObject, stringifyJson } from '../common/utils/json.util';
import { References, uniqueReference } from '../common/utils/reference.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { hasPermission, canReadAll } from '../common/utils/access-scope.util';
import type { AuthenticatedUser } from '../common/decorators';
import { buildIntelligenceDataset, type DatasetScope, type IntelligenceDataset } from './ai-dataset';
import {
  ANALYSIS_RULES,
  ANALYSIS_THRESHOLDS,
  DETECTOR_VERSION,
  describeOutcome,
  findingFingerprint,
  outcomeConfidence,
  outcomeRisk,
  runRules,
  toAlertRecord,
  type Finding,
} from './anomaly-analyzer';
import { GeminiClient, AiNotConfiguredError, AiProviderError } from './gemini.client';
import {
  ALERT_ACTION_PERMISSIONS,
  ALERT_ACTIONS,
  ALERT_REASON_MIN_LENGTH,
  alertPosition,
  availableAlertActions,
  checkAlertTransition,
  compareRisk,
  summariseAlerts,
  validateReviewInput,
} from './alert-state';
import {
  ASSISTANT_MAX_QUESTION_LENGTH,
  ASSISTANT_MIN_QUESTION_LENGTH,
  ASSISTANT_SECTIONS,
  ASSISTANT_SYSTEM_INSTRUCTION,
  ASSISTANT_DISCLAIMER,
  answerFromContext,
  buildAssistantContext,
  detectIntent,
  renderContextForProvider,
  selectSections,
  type AssistantRecord,
  type AssistantSectionKey,
  type AssistantSnapshot,
} from './assistant-context';
import type {
  AlertQueryDto,
  AnalysisQueryDto,
  AskAssistantDto,
  ConversationQueryDto,
  RunAnalysisDto,
  ReviewAlertDto,
} from './dto/ai.dto';

const MAX_ASSISTANT_QUESTION_CHARS = ASSISTANT_MAX_QUESTION_LENGTH;

const ALERT_INCLUDE = {
  analysis: { select: { id: true, type: true, status: true, provider: true, model: true, summary: true, completedAt: true } },
  forest: { select: { id: true, code: true, name: true, region: true } },
  zone: { select: { id: true, code: true, name: true } },
  protectedArea: { select: { id: true, code: true, name: true, type: true } },
  company: { select: { id: true, name: true, status: true } },
  permit: { select: { id: true, permitNumber: true, status: true } },
  activity: { select: { id: true, reference: true, activityType: true, status: true } },
  inspection: { select: { id: true, reference: true, status: true, outcome: true } },
  observation: { select: { id: true, title: true, category: true, severity: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.AIAlertInclude;

/** Roles that triage AI signals — they are notified whenever new alerts are raised. */
const ALERT_REVIEWER_ROLES = [
  'FOREST_INSPECTOR',
  'GOVERNMENT_FOREST_OFFICER',
  'ENVIRONMENTAL_OFFICER',
  'ADMINISTRATOR',
];

/**
 * Artificial intelligence module.
 *
 * Two capabilities, both server-side:
 *   - Forest Intelligence: a deterministic rule engine over the live database
 *     raises labelled *signals* (never accusations) that an officer must review.
 *   - Forest Assistant: answers questions from the records the caller is
 *     authorised to read; Google Gemini is used only when a key is configured,
 *     and only as a narrator of data FEMS has already authorised.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gis: GisService,
    private readonly gemini: GeminiClient,
  ) {}

  // ------------------------------------------------------------------- status

  /** What the module can do right now — including whether Gemini is configured. */
  async status(user: AuthenticatedUser) {
    const [totalAlerts, pendingAlerts, lastAnalysis, conversations] = await Promise.all([
      this.prisma.aIAlert.count({ where: { ...this.alertScope(user) } }),
      this.prisma.aIAlert.count({ where: { ...this.alertScope(user), status: AlertStatus.NEW } }),
      this.prisma.aIAnalysis.findFirst({
        where: { requestedById: user.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, status: true, provider: true, completedAt: true, summary: true },
      }),
      this.prisma.aIConversation.count({ where: { userId: user.id, archivedAt: null } }),
    ]);

    const provider = this.gemini.describe();
    return {
      provider: provider.provider,
      geminiConfigured: provider.configured,
      model: provider.model,
      deterministicEngine: {
        version: DETECTOR_VERSION,
        rules: ANALYSIS_RULES.map((rule) => ({ code: rule.code, label: rule.label, alertType: rule.alertType })),
        thresholds: ANALYSIS_THRESHOLDS,
        description:
          'A rule engine that computes from records already stored in FEMS. It runs with or without Gemini and always produces the alerts; Gemini only writes narrative summaries.',
      },
      capabilities: {
        canRunAnalysis: hasPermission(user, 'ai:analysis_run'),
        canReviewAlerts: hasPermission(user, 'ai:alerts_review'),
        canReadAlerts: hasPermission(user, 'ai:alerts_read'),
        canUseAssistant: hasPermission(user, 'ai:assistant_use'),
        maxQuestionLength: MAX_ASSISTANT_QUESTION_CHARS,
        alertReviewSlaHours: appConfig().ai.reviewSlaHours,
      },
      counters: {
        alerts: totalAlerts,
        alertsAwaitingReview: pendingAlerts,
        conversations: conversations,
      },
      message: provider.message,
      guardrails: [
        'Signals are raised with status NEW: only an officer can confirm, dismiss or resolve them.',
        'The assistant answers from the records the caller is allowed to read; no data leaves the server otherwise.',
      ],
      lastAnalysis,
    };
  }

  /** Rule catalogue, thresholds and the assistant's data sections. */
  catalogue() {
    return {
      provider: this.gemini.describe(),
      detectorVersion: DETECTOR_VERSION,
      rules: ANALYSIS_RULES.map((rule) => ({
        code: rule.code,
        label: rule.label,
        alertType: rule.alertType,
      })),
      thresholds: ANALYSIS_THRESHOLDS,
      analysisTypes: Object.values(AiAnalysisType),
      alertStatuses: Object.values(AlertStatus),
      riskLevels: Object.values(RiskLevel),
      assistantSections: ASSISTANT_SECTIONS.map((section) => ({
        key: section.key,
        label: section.label,
        permission: `${section.permission}:read`,
        description: section.description,
      })),
      alertActions: ALERT_ACTIONS.map((action) => ({
        action,
        permissions: ALERT_ACTION_PERMISSIONS[action],
        reasonRequired: ['CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'].includes(action),
      })),
      reasonMinLength: ALERT_REASON_MIN_LENGTH,
    };
  }

  // ---------------------------------------------------------------- analyses

  /**
   * Runs the deterministic engine over the caller's scope, stores the analysis
   * and raises one NEW alert per new signal. Gemini, when configured, is asked
   * for a narrative summary *after* the facts are computed — it cannot change a
   * risk level, a status or a finding.
   */
  async runAnalysis(user: AuthenticatedUser, dto: RunAnalysisDto) {
    const scope = this.analysisScope(user, dto);
    const periodDays = dto.periodDays ?? 90;
    const analysis = await this.prisma.aIAnalysis.create({
      data: {
        type: dto.type,
        status: AiAnalysisStatus.RUNNING,
        provider: AiProvider.LOCAL_RULE_ENGINE,
        entityType: dto.permitId ? 'ExploitationPermit' : dto.forestId ? 'Forest' : dto.companyId ? 'Company' : null,
        entityId: dto.permitId ?? dto.forestId ?? dto.companyId ?? null,
        forestId: dto.forestId ?? null,
        zoneId: dto.zoneId ?? null,
        requestedById: user.id,
        startedAt: new Date(),
      },
    });

    const startedAt = Date.now();
    try {
      const dataset = await buildIntelligenceDataset(this.prisma, scope, { periodDays });
      const known = await this.knownFingerprints(dataset);
      const outcome = runRules(dataset, { knownFingerprints: known });

      const created: Array<{ id: string; reference: string; type: string; riskLevel: string }> = [];
      for (const finding of outcome.findings) {
        const alert = await this.createAlert(finding, analysis.id, dataset);
        if (alert) created.push({ id: alert.id, reference: alert.reference, type: alert.type, riskLevel: alert.riskLevel });
      }

      // Optional narrative from Gemini. It only ever describes what the rules found.
      let narrative = describeOutcome(outcome);
      let provider: AiProvider = AiProvider.LOCAL_RULE_ENGINE;
      let model: string | null = null;
      let tokensUsed: number | null = null;
      let providerError: string | null = null;

      if (dto.useProvider !== false && this.gemini.isConfigured) {
        try {
          const response = await this.gemini.generate({
            systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
            prompt: [
              'Summarise this FEMS forest-intelligence run for a forestry officer.',
              `Run type: ${dto.type}. Period: last ${periodDays} days. Records analysed: ${this.datasetSize(dataset)}.`,
              `Findings (already computed by the deterministic engine — do not invent, re-rank or add any):`,
              JSON.stringify(
                outcome.findings.map((finding) => ({
                  code: finding.code,
                  type: finding.type,
                  riskLevel: finding.riskLevel,
                  confidence: finding.confidence,
                  title: finding.title,
                  reasoning: finding.reasoning,
                })),
                null,
                1,
              ),
              'Write 3 to 6 sentences: what stands out, which records deserve a first look, and what an officer should do next. Never state that anybody is guilty.',
            ].join('\n'),
          });
          narrative = response.text;
          provider = AiProvider.GEMINI;
          model = response.model;
          tokensUsed = response.tokensUsed;
        } catch (error) {
          providerError = error instanceof Error ? error.message : 'Gemini call failed';
          this.logger.warn(`Analysis ${analysis.id}: Gemini narrative unavailable — ${providerError}`);
        }
      }

      const result = {
        detectorVersion: DETECTOR_VERSION,
        provider,
        rulesEvaluated: outcome.rulesEvaluated,
        duplicatesSkipped: outcome.duplicates,
        byRisk: outcome.byRisk,
        byType: outcome.byType,
        findings: outcome.findings.map((finding) => ({
          code: finding.code,
          type: finding.type,
          riskLevel: finding.riskLevel,
          confidence: finding.confidence,
          title: finding.title,
          entityType: finding.entityType,
          entityId: finding.entityId,
          reasoning: finding.reasoning,
        })),
        alertsRaised: created,
        warnings: outcome.warnings,
        thresholds: ANALYSIS_THRESHOLDS,
      };

      const completed = await this.prisma.aIAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: AiAnalysisStatus.COMPLETED,
          provider,
          model,
          resultJson: stringifyJson(result),
          responseJson: provider === AiProvider.GEMINI ? stringifyJson({ narrative }) : null,
          summary: narrative,
          riskLevel: outcome.findings.length ? outcomeRisk(outcome) : RiskLevel.LOW,
          confidence: outcome.findings.length ? outcomeConfidence(outcome) : 0,
          latencyMs: Date.now() - startedAt,
          tokensUsed,
          errorMessage: providerError,
          completedAt: new Date(),
        },
      });

      await this.audit.record({
        action: AuditAction.AI_ANALYSIS,
        entityType: 'AIAnalysis',
        entityId: completed.id,
        actorId: user.id,
        actorEmail: user.email,
        severity: outcome.byRisk.CRITICAL > 0 ? AuditSeverity.CRITICAL : outcome.byRisk.HIGH > 0 ? AuditSeverity.WARNING : AuditSeverity.INFO,
        description: `Ran ${dto.type} over ${this.datasetSize(dataset)} record(s): ${outcome.findings.length} signal(s), ${created.length} new alert(s)`,
        after: {
          provider,
          findings: outcome.findings.length,
          alertsRaised: created.length,
          duplicatesSkipped: outcome.duplicates,
          risk: outcome.findings.length ? outcomeRisk(outcome) : RiskLevel.LOW,
        },
      });

      if (created.length > 0) {
        await this.notifications.notifyRoles(ALERT_REVIEWER_ROLES, {
          type: NotificationType.AI_ALERT_GENERATED,
          title: `${created.length} new AI signal(s) to review`,
          message: `${narrative.slice(0, 240)}`,
          entityType: 'AIAnalysis',
          entityId: completed.id,
          actionUrl: '/ai/alerts',
          severity: outcome.byRisk.CRITICAL > 0 || outcome.byRisk.HIGH > 0 ? 'WARNING' : 'INFO',
        });
      }

      return {
        ...completed,
        result,
        alerts: created.length,
        duplicatesSkipped: outcome.duplicates,
        providerConfigured: this.gemini.isConfigured,
        providerError,
        notes: [
          'Signals are raised with status NEW and must be reviewed by an officer.',
          'The deterministic rule engine produced every risk level and every figure above; no model decided them.',
          ...(providerError ? [`The Gemini narrative was unavailable: ${providerError}`] : []),
          ...(dto.useProvider !== false && !this.gemini.isConfigured
            ? ['GEMINI_API_KEY is empty, so the narrative was produced by the rule engine instead of a model.']
            : []),
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown analysis error';
      await this.prisma.aIAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: AiAnalysisStatus.FAILED,
          errorMessage: message.slice(0, 500),
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt,
        },
      });
      this.logger.error(`Analysis ${analysis.id} failed: ${message}`);
      throw error;
    }
  }

  async listAnalyses(user: AuthenticatedUser, query: AnalysisQueryDto) {
    const where: Prisma.AIAnalysisWhereInput = {
      type: query.type,
      status: query.status,
      forestId: query.forestId,
      requestedById: hasPermission(user, 'ai:analysis_run') ? query.requestedById : user.id,
      createdAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.aIAnalysis.findMany({
        where,
        include: {
          requestedBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { alerts: true } },
        },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['createdAt', 'completedAt', 'riskLevel'], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.aIAnalysis.count({ where }),
    ]);

    return { items, total };
  }

  async findOneAnalysis(user: AuthenticatedUser, id: string) {
    const analysis = await this.prisma.aIAnalysis.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
        alerts: {
          select: { id: true, reference: true, type: true, riskLevel: true, status: true, title: true, confidence: true },
          orderBy: { detectedAt: 'desc' },
        },
      },
    });
    if (!analysis) throw new NotFoundException({ code: 'AI_ANALYSIS_NOT_FOUND', message: 'Analysis not found.' });
    if (!canReadAll(user, 'ai') && analysis.requestedById !== user.id) {
      throw new ForbiddenException({
        code: 'AI_ANALYSIS_FORBIDDEN',
        message: 'This analysis was run by another account.',
      });
    }
    const result = parseJsonObject<Record<string, unknown>>(analysis.resultJson);
    return { ...analysis, result };
  }

  // ------------------------------------------------------------------- alerts

  async listAlerts(user: AuthenticatedUser, query: AlertQueryDto) {
    const where: Prisma.AIAlertWhereInput = {
      status: query.status,
      type: query.type,
      riskLevel: query.riskLevel,
      detector: query.detector,
      forestId: query.forestId,
      companyId: query.companyId,
      permitId: query.permitId,
      ...this.alertScope(user, query.companyId),
      detectedAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.awaitingReview === 'true' ? { status: AlertStatus.NEW } : {}),
      ...(query.search
        ? { OR: [{ reference: { contains: query.search } }, { title: { contains: query.search } }] }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.aIAlert.findMany({
        where,
        include: ALERT_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['detectedAt', 'riskLevel', 'status'], 'detectedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.aIAlert.count({ where }),
    ]);

    const slaHours = appConfig().ai.reviewSlaHours;
    const items = rows
      .map((alert) => ({
        ...alert,
        review: alertPosition(alert, new Date(), slaHours),
        actions: availableAlertActions(alert.status, (permission) => hasPermission(user, permission)),
      }))
      .sort((a, b) => compareRisk(b.riskLevel, a.riskLevel));

    return { items, total, reviewSlaHours: slaHours };
  }

  async findOneAlert(user: AuthenticatedUser, id: string) {
    const alert = await this.prisma.aIAlert.findUnique({ where: { id }, include: ALERT_INCLUDE });
    if (!alert) throw new NotFoundException({ code: 'AI_ALERT_NOT_FOUND', message: 'Alert not found.' });
    this.assertAlertVisible(user, alert);

    const linkedViolation = alert.violationId
      ? await this.prisma.environmentalViolation.findUnique({
          where: { id: alert.violationId },
          select: { id: true, reference: true, status: true, severity: true, title: true },
        })
      : null;
    const relatedAlerts = await this.prisma.aIAlert.count({
      where: { entityType: alert.entityType, entityId: alert.entityId, id: { not: alert.id } },
    });

    const slaHours = appConfig().ai.reviewSlaHours;
    return {
      ...alert,
      review: alertPosition(alert, new Date(), slaHours),
      actions: availableAlertActions(alert.status, (permission) => hasPermission(user, permission)),
      linkedViolation,
      relatedAlerts,
      guardrails: [
        'This alert was raised by the deterministic rule engine and is not a finding of guilt.',
        'Only a named officer can confirm, dismiss or resolve it, and the reason is stored with the decision.',
      ],
    };
  }

  /**
   * Officer review of an alert. Authority is checked before the state machine so
   * an unauthorised caller always gets 403 — never a misleading 400.
   */
  async reviewAlert(user: AuthenticatedUser, id: string, dto: ReviewAlertDto) {
    for (const permission of ALERT_ACTION_PERMISSIONS[dto.action]) {
      if (!hasPermission(user, permission)) {
        throw new ForbiddenException({
          code: 'AI_ALERT_ACTION_FORBIDDEN',
          message: `Missing permission(s): ${permission}.`,
        });
      }
    }

    const alert = await this.prisma.aIAlert.findUnique({ where: { id }, include: ALERT_INCLUDE });
    if (!alert) throw new NotFoundException({ code: 'AI_ALERT_NOT_FOUND', message: 'Alert not found.' });
    this.assertAlertVisible(user, alert);

    const transition = checkAlertTransition(alert.status, dto.action);
    if (!transition.allowed) {
      throw new BadRequestException({ code: transition.code, message: transition.message });
    }

    const validation = validateReviewInput({
      action: dto.action,
      reason: dto.reason,
      resolutionAction: dto.resolutionAction,
      evidenceNote: dto.evidenceNote,
      violationId: dto.violationId,
    });
    if (!validation.ok) {
      throw new BadRequestException({
        code: 'AI_ALERT_REVIEW_INVALID',
        message: validation.problems[0].message,
        details: validation.problems,
      });
    }

    let linkedViolation: { id: string; reference: string } | null = null;
    if (dto.violationId) {
      const violation = await this.prisma.environmentalViolation.findFirst({
        where: { id: dto.violationId, deletedAt: null },
        select: { id: true, reference: true, companyId: true, forestId: true },
      });
      if (!violation) {
        throw new NotFoundException({ code: 'VIOLATION_NOT_FOUND', message: 'The case to link does not exist.' });
      }
      if (user.companyId && !user.permissions.includes('*') && violation.companyId !== user.companyId) {
        throw new ForbiddenException({
          code: 'VIOLATION_FORBIDDEN',
          message: 'That case concerns another organisation.',
        });
      }
      linkedViolation = { id: violation.id, reference: violation.reference };
    }

    const nextStatus = transition.to as AlertStatus;
    const reviewNote = [dto.reason?.trim(), dto.evidenceNote?.trim() ? `Evidence: ${dto.evidenceNote.trim()}` : null]
      .filter(Boolean)
      .join(' — ');

    const updated = await this.prisma.aIAlert.update({
      where: { id: alert.id },
      data: {
        status: nextStatus,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNotes: reviewNote || alert.reviewNotes,
        resolutionAction: nextStatus === AlertStatus.RESOLVED ? (dto.resolutionAction?.trim() ?? alert.resolutionAction) : alert.resolutionAction,
        resolvedAt: nextStatus === AlertStatus.RESOLVED ? new Date() : null,
        violationId: dto.action === 'CONFIRM' ? (linkedViolation?.id ?? alert.violationId) : alert.violationId,
      },
      include: ALERT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.AI_ALERT_REVIEW,
      entityType: 'AIAlert',
      entityId: updated.id,
      actorId: user.id,
      actorEmail: user.email,
      severity: nextStatus === AlertStatus.CONFIRMED ? AuditSeverity.WARNING : AuditSeverity.INFO,
      description: `${dto.action} on alert ${updated.reference} (${alert.status} → ${nextStatus})`,
      before: { status: alert.status },
      after: {
        status: nextStatus,
        reason: dto.reason?.trim() ?? null,
        violationId: updated.violationId,
        resolutionAction: dto.resolutionAction?.trim() ?? null,
      },
    });

    // The officer who ran the analysis that raised the alert is told about the decision.
    const recipients: string[] = [];
    if (alert.analysis?.id) {
      const requester = await this.prisma.aIAnalysis.findUnique({
        where: { id: alert.analysis.id },
        select: { requestedById: true },
      });
      if (requester?.requestedById) recipients.push(requester.requestedById);
    }

    await this.notifications.notify({
      userIds: [...new Set([...recipients, user.id])],
      type: nextStatus === AlertStatus.RESOLVED ? NotificationType.AI_ALERT_RESOLVED : NotificationType.AI_ALERT_ASSIGNED,
      title: `Alert ${updated.reference} is now ${nextStatus}`,
      message:
        `${user.firstName} ${user.lastName} recorded "${dto.action}" on ${updated.title}` +
        (linkedViolation ? ` and linked it to case ${linkedViolation.reference}.` : '.'),
      entityType: 'AIAlert',
      entityId: updated.id,
      actionUrl: `/ai/alerts/${updated.id}`,
    });

    await this.notifications.notifyRoles(ALERT_REVIEWER_ROLES, {
      type: NotificationType.AI_ALERT_ASSIGNED,
      title: `Alert ${updated.reference} ${dto.action.toLowerCase()}d`,
      message: `${updated.title} — ${nextStatus}${linkedViolation ? `, linked to ${linkedViolation.reference}` : ''}.`,
      entityType: 'AIAlert',
      entityId: updated.id,
      actionUrl: `/ai/alerts/${updated.id}`,
    });

    if (dto.requestInspection) {
      await this.notifications.notifyRoles(['FOREST_INSPECTOR', 'GOVERNMENT_FOREST_OFFICER'], {
        type: NotificationType.AI_ALERT_ASSIGNED,
        title: `Field verification requested for ${updated.reference}`,
        message: `${user.firstName} ${user.lastName} asks for a field inspection following alert ${updated.reference} (${updated.riskLevel}).`,
        entityType: 'AIAlert',
        entityId: updated.id,
        actionUrl: '/inspections/new',
        severity: 'WARNING',
      });
    }

    const slaHours = appConfig().ai.reviewSlaHours;
    return {
      ...updated,
      review: alertPosition(updated, new Date(), slaHours),
      actions: availableAlertActions(updated.status, (permission) => hasPermission(user, permission)),
      linkedViolation,
      inspectionRequested: Boolean(dto.requestInspection),
      decidedBy: { id: user.id, name: `${user.firstName} ${user.lastName}` },
    };
  }

  async alertStatistics(user: AuthenticatedUser) {
    const alerts = await this.prisma.aIAlert.findMany({
      where: { ...this.alertScope(user) },
      select: { id: true, status: true, riskLevel: true, type: true, detectedAt: true, detector: true, confidence: true },
    });
    const slaHours = appConfig().ai.reviewSlaHours;
    const summary = summariseAlerts(alerts, new Date(), slaHours);

    const byForestRows = await this.prisma.aIAlert.groupBy({
      by: ['forestId'],
      where: { ...this.alertScope(user) },
      _count: { _all: true },
    });
    const forestIds = byForestRows.map((row) => row.forestId).filter((id): id is string => Boolean(id));
    const forests = forestIds.length
      ? await this.prisma.forest.findMany({ where: { id: { in: forestIds } }, select: { id: true, name: true, region: true } })
      : [];

    const detectorRows = await this.prisma.aIAlert.groupBy({
      by: ['detector'],
      where: { ...this.alertScope(user) },
      _count: { _all: true },
    });

    const reviewed = alerts.filter((alert) => alert.status !== AlertStatus.NEW);
    const confirmed = alerts.filter((alert) => alert.status === AlertStatus.CONFIRMED || alert.status === AlertStatus.RESOLVED).length;

    return {
      ...summary,
      reviewSlaHours: slaHours,
      detectorVersion: DETECTOR_VERSION,
      provider: this.gemini.describe().provider,
      humanReview: {
        reviewed: reviewed.length,
        awaitingFirstReview: summary.awaitingReview,
        overdue: summary.overdueReview,
        confirmedByOfficer: confirmed,
        dismissedByOfficer: summary.dismissed,
        confirmationRate: reviewed.length === 0 ? null : Math.round((confirmed / reviewed.length) * 100),
      },
      byDetector: detectorRows.map((row) => ({ detector: row.detector, count: row._count._all })),
      byForest: byForestRows.map((row) => ({
        forestId: row.forestId,
        forestName: forests.find((forest) => forest.id === row.forestId)?.name ?? null,
        region: forests.find((forest) => forest.id === row.forestId)?.region ?? null,
        count: row._count._all,
      })),
      note:
        'Every figure here counts signals raised by the rule engine and the decisions officers recorded. A high number is a call for field work, not a statement about any organisation.',
    };
  }

  // ---------------------------------------------------------------- assistant

  /** Answers a question from the records the caller may read. */
  async ask(user: AuthenticatedUser, dto: AskAssistantDto) {
    if (!hasPermission(user, 'ai:assistant_use')) {
      throw new ForbiddenException({ code: 'AI_ASSISTANT_FORBIDDEN', message: 'Missing permission(s): ai:assistant_use.' });
    }

    const question = dto.question.trim();
    if (question.length < ASSISTANT_MIN_QUESTION_LENGTH || question.length > MAX_ASSISTANT_QUESTION_CHARS) {
      throw new BadRequestException({
        code: 'AI_QUESTION_INVALID',
        message: `The question must contain between ${ASSISTANT_MIN_QUESTION_LENGTH} and ${MAX_ASSISTANT_QUESTION_CHARS} characters.`,
      });
    }

    const conversation = dto.conversationId
      ? await this.prisma.aIConversation.findUnique({ where: { id: dto.conversationId } })
      : null;
    if (dto.conversationId && !conversation) {
      throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    }
    if (conversation && conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'AI_CONVERSATION_FORBIDDEN',
        message: 'This conversation belongs to another account.',
      });
    }
    if (conversation?.archivedAt) {
      throw new BadRequestException({
        code: 'AI_CONVERSATION_ARCHIVED',
        message: 'This conversation is archived; start a new one to keep asking questions.',
      });
    }

    const activeConversation =
      conversation ??
      (await this.prisma.aIConversation.create({
        data: {
          userId: user.id,
          title: question.slice(0, 120),
        },
      }));

    // 1 — build the context from what this caller is authorised to read.
    const snapshot = await this.buildAssistantSnapshot(user, dto);
    const { allowed, decisions } = selectSections(user.permissions);
    const context = buildAssistantContext(snapshot, allowed, decisions);

    await this.prisma.aIMessage.create({
      data: {
        conversationId: activeConversation.id,
        role: 'USER',
        content: question,
        intentJson: stringifyJson({ intent: detectIntent(question), scope: this.describeScope(user, dto) }),
        dataRefsJson: stringifyJson({ sections: context.sections.map((section) => section.key), withheld: context.withheld.map((entry) => entry.section) }),
      },
    });

    // 2 — answer: Gemini when configured, otherwise the deterministic reader.
    const startedAt = Date.now();
    let answerText: string;
    let provider: AiProvider = AiProvider.LOCAL_RULE_ENGINE;
    let model: string | null = null;
    let tokensUsed: number | null = null;
    let providerError: string | null = null;
    const ruleAnswer = answerFromContext(question, context);

    if (this.gemini.isConfigured) {
      try {
        const response = await this.gemini.generate({
          systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
          prompt: [
            `Question from ${user.firstName} ${user.lastName} (roles: ${user.roles.join(', ')}).`,
            `Authorised FEMS data for this answer (JSON):`,
            renderContextForProvider(context),
            `Question: ${question}`,
            `Answer in the question's language. Mention that the data covers ${context.companyId ? 'their company only' : 'the scope of their role'}.`,
          ].join('\n'),
        });
        answerText = response.text;
        provider = AiProvider.GEMINI;
        model = response.model;
        tokensUsed = response.tokensUsed;
      } catch (error) {
        providerError =
          error instanceof AiNotConfiguredError
            ? error.message
            : error instanceof AiProviderError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Gemini call failed';
        this.logger.warn(`Assistant provider error: ${providerError}`);
        if (dto.fallbackToRules === false) {
          await this.prisma.aIMessage.create({
            data: {
              conversationId: activeConversation.id,
              role: 'ERROR',
              content: 'The AI provider could not answer this question.',
              provider: AiProvider.GEMINI,
              model: this.gemini.model,
              latencyMs: Date.now() - startedAt,
              errorMessage: providerError.slice(0, 500),
            },
          });
          throw new ServiceUnavailableException({
            code: 'AI_PROVIDER_UNAVAILABLE',
            message: `The Gemini provider did not answer: ${providerError}`,
          });
        }
        answerText = `${ruleAnswer.text}\n\n(Note: the AI provider call failed — ${providerError} — so this answer was computed by the FEMS rule engine from the same authorised data.)`;
      }
    } else {
      answerText = `${ruleAnswer.text}\n\n(Note: GEMINI_API_KEY is not configured, so this answer was computed by the FEMS rule engine from your authorised data.)`;
    }

    const latencyMs = Date.now() - startedAt;
    const assistantMessage = await this.prisma.aIMessage.create({
      data: {
        conversationId: activeConversation.id,
        role: 'ASSISTANT',
        content: answerText,
        provider,
        model,
        intentJson: stringifyJson({ intent: ruleAnswer.intent, sectionsUsed: ruleAnswer.sectionsUsed }),
        dataRefsJson: stringifyJson(ruleAnswer.dataRefs),
        latencyMs,
        tokensUsed,
        errorMessage: providerError,
      },
    });

    await this.prisma.aIConversation.update({
      where: { id: activeConversation.id },
      data: {
        lastMessageAt: new Date(),
        contextJson: stringifyJson({
          sections: context.sections.map((section) => ({ key: section.key, records: section.records.length })),
          withheld: context.withheld,
          scope: this.describeScope(user, dto),
        }),
        ...(conversation ? {} : { title: question.slice(0, 120) }),
      },
    });

    await this.audit.record({
      action: AuditAction.AI_ANALYSIS,
      entityType: 'AIConversation',
      entityId: activeConversation.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Forest Assistant answered a question (${provider}, intent ${ruleAnswer.intent})`,
      after: {
        provider,
        sections: context.sections.map((section) => section.key),
        withheld: context.withheld.map((entry) => entry.section),
        records: context.totalRecords,
      },
    });

    return {
      conversationId: activeConversation.id,
      question,
      answer: assistantMessage.content,
      provider,
      model: model ?? 'deterministic-rule-engine',
      geminiConfigured: this.gemini.isConfigured,
      providerError,
      intent: ruleAnswer.intent,
      latencyMs,
      tokensUsed,
      context: {
        scope: this.describeScope(user, dto),
        sections: context.sections.map((section) => ({ key: section.key, label: section.label, records: section.records.length })),
        withheld: context.withheld,
        totalRecords: context.totalRecords,
      },
      dataRefs: ruleAnswer.dataRefs,
      disclaimer: ASSISTANT_DISCLAIMER,
      messageId: assistantMessage.id,
    };
  }

  async listConversations(user: AuthenticatedUser, query: ConversationQueryDto) {
    const where: Prisma.AIConversationWhereInput = {
      userId: user.id,
      archivedAt: query.includeArchived === 'true' ? undefined : null,
      ...(query.search ? { title: { contains: query.search } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.aIConversation.findMany({
        where,
        include: { _count: { select: { messages: true } } },
        orderBy: { lastMessageAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.aIConversation.count({ where }),
    ]);
    return { items, total };
  }

  async getConversation(user: AuthenticatedUser, id: string) {
    const conversation = await this.prisma.aIConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    if (conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'AI_CONVERSATION_FORBIDDEN',
        message: 'This conversation belongs to another account.',
      });
    }
    return {
      ...conversation,
      context: parseJsonObject<Record<string, unknown>>(conversation.contextJson),
      disclaimer: ASSISTANT_DISCLAIMER,
    };
  }

  async archiveConversation(user: AuthenticatedUser, id: string) {
    const conversation = await this.prisma.aIConversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    if (conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'AI_CONVERSATION_FORBIDDEN',
        message: 'This conversation belongs to another account.',
      });
    }
    const archived = await this.prisma.aIConversation.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { id: archived.id, archivedAt: archived.archivedAt, message: 'Conversation archived.' };
  }

  async deleteConversation(user: AuthenticatedUser, id: string) {
    const conversation = await this.prisma.aIConversation.findUnique({ where: { id }, include: { _count: { select: { messages: true } } } });
    if (!conversation) throw new NotFoundException({ code: 'AI_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    if (conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'AI_CONVERSATION_FORBIDDEN',
        message: 'This conversation belongs to another account.',
      });
    }
    await this.prisma.aIConversation.delete({ where: { id } });
    return { id, deleted: true, messagesDeleted: conversation._count.messages, message: 'Conversation deleted.' };
  }

  // ------------------------------------------------------------------ sweeps

  /**
   * Nightly forest-intelligence sweep. Each forest of the register is analysed
   * independently so one forest cannot hide behind another, and alerts are only
   * raised for findings that are not already awaiting review.
   */
  @Cron('0 4 * * *', { name: 'ai-risk-sweep' })
  async scheduledRiskSweep(): Promise<void> {
    if (!appConfig().ai.riskScheduleEnabled) {
      this.logger.log('Scheduled AI risk sweep is disabled by AI_RISK_SCHEDULE_ENABLED.');
      return;
    }

    const forests = await this.prisma.forest.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true },
      take: 50,
    });

    for (const forest of forests) {
      try {
        const dataset = await buildIntelligenceDataset(this.prisma, { forestId: forest.id }, { periodDays: 90 });
        const known = await this.knownFingerprints(dataset);
        const outcome = runRules(dataset, { knownFingerprints: known });
        if (outcome.findings.length === 0) continue;

        const analysis = await this.prisma.aIAnalysis.create({
          data: {
            type: AiAnalysisType.RISK_ASSESSMENT,
            status: AiAnalysisStatus.COMPLETED,
            provider: AiProvider.LOCAL_RULE_ENGINE,
            entityType: 'Forest',
            entityId: forest.id,
            forestId: forest.id,
            summary: `${describeOutcome(outcome)} (scheduled sweep)`,
            riskLevel: outcomeRisk(outcome),
            confidence: outcomeConfidence(outcome),
            resultJson: stringifyJson({
              detectorVersion: DETECTOR_VERSION,
              scheduled: true,
              byRisk: outcome.byRisk,
              byType: outcome.byType,
              findings: outcome.findings.map((finding) => ({ code: finding.code, title: finding.title, entityId: finding.entityId })),
            }),
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });

        let raised = 0;
        for (const finding of outcome.findings) {
          // eslint-disable-next-line no-await-in-loop
          const alert = await this.createAlert(finding, analysis.id, dataset);
          if (alert) raised += 1;
        }
        if (raised > 0) {
          await this.notifications.notifyRoles(ALERT_REVIEWER_ROLES, {
            type: NotificationType.AI_ALERT_GENERATED,
            title: `Nightly sweep raised ${raised} signal(s) in ${forest.name}`,
            message: describeOutcome(outcome),
            entityType: 'AIAnalysis',
            entityId: analysis.id,
            actionUrl: '/ai/alerts',
            severity: outcome.byRisk.CRITICAL > 0 ? 'CRITICAL' : 'WARNING',
          });
        }
        this.logger.log(`Nightly sweep: ${forest.name} → ${raised} new alert(s).`);
      } catch (error) {
        this.logger.error(`Nightly sweep failed for ${forest.name}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Creates the alert unless an equivalent one is already open. Always status NEW. */
  private async createAlert(finding: Finding, analysisId: string, dataset: IntelligenceDataset) {
    const record = toAlertRecord(finding);
    const existing = await this.prisma.aIAlert.findFirst({
      where: {
        type: record.type,
        entityType: record.entityType,
        entityId: record.entityId,
        status: { in: [AlertStatus.NEW, AlertStatus.REVIEWING, AlertStatus.CONFIRMED] },
      },
      select: { id: true, reference: true, status: true },
    });
    if (existing) return null;

    const reference = await uniqueReference(References.alert, async (candidate) => {
      const taken = await this.prisma.aIAlert.findUnique({ where: { reference: candidate }, select: { id: true } });
      return taken === null;
    });

    const alert = await this.prisma.aIAlert.create({
      data: {
        ...record,
        reference,
        analysisId,
        confidence: record.confidence,
        detectedAt: dataset.generatedAt,
      },
      select: { id: true, reference: true, type: true, riskLevel: true, latitude: true, longitude: true, title: true },
    });

    // Mirror the signal on the map so officers see it where it happened.
    if (alert.latitude !== null && alert.longitude !== null) {
      try {
        await this.gis.recordFeature({
          featureType: GisFeatureType.AI_ALERT,
          entityId: alert.id,
          label: alert.title,
          latitude: Number(alert.latitude),
          longitude: Number(alert.longitude),
          aiAlertId: alert.id,
        });
      } catch (error) {
        this.logger.warn(`Could not mirror alert ${alert.reference} on the map: ${error instanceof Error ? error.message : error}`);
      }
    }

    return alert;
  }

  /** Fingerprints of findings already carried by an open alert. */
  private async knownFingerprints(dataset: IntelligenceDataset): Promise<Set<string>> {
    const entityIds = [
      ...dataset.permits.map((permit) => permit.id),
      ...dataset.activities.map((activity) => activity.id),
      ...dataset.forests.map((forest) => forest.id),
      ...dataset.observations.map((observation) => observation.id),
      ...dataset.violations.map((violation) => violation.id),
    ];
    if (entityIds.length === 0) return new Set();

    const existing = await this.prisma.aIAlert.findMany({
      where: {
        entityId: { in: entityIds },
        status: { in: [AlertStatus.NEW, AlertStatus.REVIEWING, AlertStatus.CONFIRMED] },
      },
      select: { type: true, entityType: true, entityId: true, title: true },
    });
    return new Set(
      existing.map((alert) =>
        findingFingerprint({
          type: alert.type,
          entityType: alert.entityType ?? '',
          entityId: alert.entityId ?? '',
        }),
      ),
    );
  }

  private datasetSize(dataset: IntelligenceDataset): number {
    return (
      dataset.forests.length +
      dataset.permits.length +
      dataset.activities.length +
      dataset.inspections.length +
      dataset.violations.length +
      dataset.payments.length +
      dataset.observations.length
    );
  }

  /** Analysis scope: a company account is pinned to its own company, always. */
  private analysisScope(user: AuthenticatedUser, dto: RunAnalysisDto): DatasetScope {
    if (user.companyId && !user.permissions.includes('*')) {
      return { companyId: user.companyId, forestId: dto.forestId, zoneId: dto.zoneId, permitId: dto.permitId };
    }
    if (!hasPermission(user, 'ai:analysis_run')) {
      throw new ForbiddenException({ code: 'AI_ANALYSIS_FORBIDDEN', message: 'Missing permission(s): ai:analysis_run.' });
    }
    return { forestId: dto.forestId, zoneId: dto.zoneId, companyId: dto.companyId, permitId: dto.permitId };
  }

  private alertScope(user: AuthenticatedUser, companyId?: string): Prisma.AIAlertWhereInput {
    if (user.companyId && !user.permissions.includes('*')) return { companyId: user.companyId };
    if (hasPermission(user, 'ai:alerts_read')) return { companyId };
    return { companyId: companyId ?? user.companyId ?? '__none__' };
  }

  private assertAlertVisible(
    user: AuthenticatedUser,
    alert: { companyId: string | null },
  ): void {
    if (user.companyId && !user.permissions.includes('*')) {
      if (alert.companyId === user.companyId) return;
      throw new ForbiddenException({ code: 'AI_ALERT_FORBIDDEN', message: 'This alert concerns another organisation.' });
    }
    if (!hasPermission(user, 'ai:alerts_read')) {
      throw new ForbiddenException({ code: 'AI_ALERT_FORBIDDEN', message: 'Missing permission(s): ai:alerts_read.' });
    }
  }

  private describeScope(user: AuthenticatedUser, dto: AskAssistantDto) {
    return {
      role: user.roles,
      companyId: user.companyId,
      forestId: dto.forestId ?? null,
      companyFilter: dto.companyId ?? null,
      permitId: dto.permitId ?? null,
      dataScope: user.companyId ? 'company' : 'regulatory',
    };
  }

  /**
   * Reads the assistant's five-minute snapshot. Every section is filtered by the
   * caller's scope *and* by the section permission — the provider never receives
   * rows the caller could not have read through the REST API.
   */
  private async buildAssistantSnapshot(user: AuthenticatedUser, dto: AskAssistantDto): Promise<AssistantSnapshot> {
    const { allowed } = selectSections(user.permissions);
    const companyId = user.companyId ?? dto.companyId ?? null;
    const forestId = dto.forestId;
    const permitId = dto.permitId;
    // Only defined filters are sent to Prisma — `null` means "no filter", which is
    // not the same thing as "records without a company".
    const optional = <T extends string>(values: Record<T, string | undefined>): Record<T, string> => {
      const output = {} as Record<T, string>;
      for (const [key, value] of Object.entries(values) as Array<[T, string | undefined]>) {
        if (value) output[key] = value;
      }
      return output;
    };
    const permitFilter = optional({ companyId: companyId ?? undefined, forestId, permitId });
    const activityFilter = optional({ companyId: companyId ?? undefined, forestId, permitId });
    const inspectionFilter = optional({ companyId: companyId ?? undefined, forestId, permitId });
    const violationFilter = optional({ companyId: companyId ?? undefined, forestId, permitId });
    const paymentFilter = optional({ companyId: companyId ?? undefined, permitId });
    const alertFilter = optional({ companyId: companyId ?? undefined, forestId, permitId });
    const section = <T>(key: AssistantSectionKey, loader: () => Promise<T[]>): Promise<T[]> =>
      allowed.includes(key) ? loader() : Promise.resolve([]);

    const stringifyDetails = (details: Record<string, unknown>): Record<string, string | number | null> => {
      const output: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(details)) {
        if (value === null || value === undefined) output[key] = null;
        else if (typeof value === 'number' || typeof value === 'string') output[key] = value;
        else output[key] = String(value);
      }
      return output;
    };

    const [forests, permits, activities, inspections, violations, payments, alerts, reports] = await Promise.all([
      section('forests', async () => {
        const rows = await this.prisma.forest.findMany({
          where: { deletedAt: null, id: forestId },
          select: { id: true, code: true, name: true, region: true, status: true, totalAreaHa: true, annualAllowableCutM3: true },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.code} — ${row.name}`,
          details: stringifyDetails({
            region: row.region,
            status: row.status,
            areaHa: Number(row.totalAreaHa),
            annualAllowableCutM3: row.annualAllowableCutM3 === null ? null : Number(row.annualAllowableCutM3),
          }),
        }));
      }),
      section('permits', async () => {
        const rows = await this.prisma.exploitationPermit.findMany({
          where: { deletedAt: null, ...permitFilter, ...(permitId ? { id: permitId } : {}) },
          include: { company: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.permitNumber} — ${row.company?.name ?? '—'}`,
          details: stringifyDetails({
            status: row.status,
            type: row.type,
            volumeApprovedM3: row.volumeApprovedM3 === null ? null : Number(row.volumeApprovedM3),
            volumeRequestedM3: Number(row.volumeRequestedM3),
            feeAmountXAF: Number(row.feeAmount),
            validity: `${row.startDate.toISOString().slice(0, 10)} → ${row.endDate.toISOString().slice(0, 10)}`,
          }),
        }));
      }),
      section('activities', async () => {
        const rows = await this.prisma.exploitationActivity.findMany({
          where: { deletedAt: null, ...activityFilter },
          orderBy: { plannedStartDate: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.activityType}`,
          details: stringifyDetails({
            status: row.status,
            plannedVolumeM3: Number(row.plannedVolumeM3),
            harvestedVolumeM3: Number(row.harvestedVolumeM3),
            treesFelled: row.harvestedTreeCount,
            plannedStart: row.plannedStartDate.toISOString().slice(0, 10),
          }),
        }));
      }),
      section('inspections', async () => {
        const rows = await this.prisma.inspection.findMany({
          where: { deletedAt: null, ...inspectionFilter },
          orderBy: { createdAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.type}`,
          details: stringifyDetails({
            status: row.status,
            outcome: row.outcome,
            complianceScore: row.complianceScore,
            completedAt: row.completedAt ? row.completedAt.toISOString().slice(0, 10) : null,
          }),
        }));
      }),
      section('violations', async () => {
        const rows = await this.prisma.environmentalViolation.findMany({
          where: { deletedAt: null, ...violationFilter },
          orderBy: { detectedAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.title}`,
          details: stringifyDetails({
            status: row.status,
            severity: row.severity,
            detectedAt: row.detectedAt.toISOString().slice(0, 10),
            penaltyXAF: Number(row.penaltyAmountXAF),
            remediationRequired: row.remediationRequired ? 'yes' : 'no',
          }),
        }));
      }),
      section('payments', async () => {
        const rows = await this.prisma.payment.findMany({
          where: { ...paymentFilter },
          orderBy: { createdAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.purpose}`,
          details: stringifyDetails({
            status: row.status,
            amount: Number(row.amount),
            currency: row.currency,
            paidAt: row.paidAt ? row.paidAt.toISOString().slice(0, 10) : null,
          }),
        }));
      }),
      section('alerts', async () => {
        const rows = await this.prisma.aIAlert.findMany({
          where: { ...alertFilter },
          orderBy: { detectedAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.title}`,
          details: stringifyDetails({
            type: row.type,
            riskLevel: row.riskLevel,
            status: row.status,
            detector: row.detector,
            confidence: row.confidence === null ? null : Number(row.confidence),
          }),
        }));
      }),
      section('reports', async () => {
        const rows = await this.prisma.report.findMany({
          where: { deletedAt: null, ...permitFilter, status: ReportStatus.READY },
          orderBy: { generatedAt: 'desc' },
          take: 25,
        });
        return rows.map<AssistantRecord>((row) => ({
          id: row.id,
          label: `${row.reference} — ${row.title}`,
          details: stringifyDetails({
            type: row.type,
            format: row.format,
            status: row.status,
            generatedAt: row.generatedAt ? row.generatedAt.toISOString().slice(0, 10) : null,
          }),
        }));
      }),
    ]);

    return {
      generatedAt: new Date(),
      companyId: user.companyId,
      sections: { forests, permits, activities, inspections, violations, payments, alerts, reports },
    };
  }
}
