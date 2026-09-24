import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditSeverity,
  NotificationType,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  PermitStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitsService } from '../permits/permits.service';
import { appConfig } from '../config/configuration';
import { References, uniqueReference } from '../common/utils/reference.util';
import { stringifyJson } from '../common/utils/json.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { canReadAll } from '../common/utils/access-scope.util';
import type { AuthenticatedUser } from '../common/decorators';
import { CampayNotConfiguredError, CampayProvider, CampayRequestError } from './providers/campay.provider';
import {
  canRefund,
  checkPayableAmount,
  isProviderSettleable,
  nextStatusForProviderOutcome,
  requiresPayerPhone,
} from './payment-rules';
import { SimulatorProvider } from './providers/simulator.provider';
import type { ProviderOutcome as ProviderOutcomeStatus } from './payment-rules';
import type {
  CampayWebhookDto,
  InitiatePaymentDto,
  PaymentQueryDto,
  SimulatePaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';

const PAYMENT_INCLUDE = {
  payer: { select: { id: true, firstName: true, lastName: true, email: true } },
  company: { select: { id: true, name: true } },
  permit: { select: { id: true, permitNumber: true, status: true, feeAmount: true } },
  violation: { select: { id: true, reference: true, status: true, penaltyAmountXAF: true } },
  initiatedBy: { select: { id: true, firstName: true, lastName: true } },
  verifiedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly permits: PermitsService,
    private readonly campay: CampayProvider,
    private readonly simulator: SimulatorProvider,
  ) {}

  /** The provider actually in use for new payments. */
  get providerKind(): PaymentProvider {
    return appConfig().payments.provider === 'campay' ? PaymentProvider.CAMPAY : PaymentProvider.SIMULATOR;
  }

  /**
   * Honest description of the payment path currently in use — the mobile app
   * shows this verbatim so nobody believes money is moving when it is not.
   */
  describeProvider() {
    const currency = appConfig().payments.campay.currency;
    if (this.providerKind === PaymentProvider.CAMPAY) {
      const missing = this.campay.missingConfiguration();
      return {
        provider: 'CAMPAY' as const,
        sandbox: false,
        configured: this.campay.configured,
        missing,
        currency,
        webhookConfigured: Boolean(appConfig().payments.campay.webhookSecret),
        message: this.campay.configured
          ? 'Campay mobile money is configured: collections are requested from the live gateway and settled by server-side verification.'
          : `Campay is selected but not configured (missing ${missing.join(', ')}). Payments will be rejected with CAMPAY_NOT_CONFIGURED instead of being simulated.`,
      };
    }
    return {
      provider: 'SIMULATOR' as const,
      sandbox: true,
      configured: true,
      missing: [] as string[],
      currency,
      webhookConfigured: false,
      message: this.simulator.instructions,
    };
  }

  // ------------------------------------------------------------------ reads

  async list(user: AuthenticatedUser, query: PaymentQueryDto) {
    const and: Prisma.PaymentWhereInput[] = [];
    if (!canReadAll(user, 'payments')) {
      and.push({
        OR: [{ payerId: user.id }, { initiatedById: user.id }, { companyId: user.companyId ?? '__none__' }],
      });
    }
    const where: Prisma.PaymentWhereInput = {
      status: query.status,
      purpose: query.purpose,
      permitId: query.permitId,
      companyId: canReadAll(user, 'payments') ? query.companyId : user.companyId ?? '__none__',
      initiatedAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search } },
              { providerReference: { contains: query.search } },
              { receiptNumber: { contains: query.search } },
            ],
          }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['initiatedAt', 'amount', 'status'], 'initiatedAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    this.assertVisible(user, payment);
    return payment;
  }

  // --------------------------------------------------------------- initiate

  async initiate(user: AuthenticatedUser, dto: InitiatePaymentDto) {
    if (dto.clientRef) {
      const existing = await this.prisma.payment.findUnique({ where: { clientRef: dto.clientRef }, include: PAYMENT_INCLUDE });
      if (existing) return { payment: existing, duplicate: true };
    }

    const method = dto.method;
    if (requiresPayerPhone(method) && !dto.payerPhone) {
      throw new BadRequestException({
        code: 'PAYER_PHONE_REQUIRED',
        message: `A payer phone number is required for ${method.replace(/_/g, ' ').toLowerCase()} payments.`,
      });
    }

    let permit: { id: string; permitNumber: string; status: PermitStatus; companyId: string } | null = null;
    if (dto.purpose === PaymentPurpose.PERMIT_FEE) {
      if (!dto.permitId) {
        throw new BadRequestException({
          code: 'PERMIT_REQUIRED',
          message: 'A permit is required to settle permit fees.',
        });
      }
      permit = await this.prisma.exploitationPermit.findFirst({
        where: { id: dto.permitId, deletedAt: null },
        select: { id: true, permitNumber: true, status: true, companyId: true },
      });
      if (!permit) throw new NotFoundException({ code: 'PERMIT_NOT_FOUND', message: 'Permit not found.' });
      if (permit.status === PermitStatus.DRAFT || permit.status === PermitStatus.CANCELLED) {
        throw new ConflictException({
          code: 'PERMIT_NOT_BILLABLE',
          message: `Permit ${permit.permitNumber} is ${permit.status}; fees can only be settled once the permit has been approved.`,
        });
      }
      if (!canReadAll(user, 'payments') && permit.companyId !== user.companyId) {
        throw new ForbiddenException({
          code: 'PERMIT_FORBIDDEN',
          message: 'This permit belongs to another company.',
        });
      }
      const outstanding = await this.permits.outstandingBalance(permit.id);
      const amountCheck = checkPayableAmount(dto.amount, outstanding);
      if (!amountCheck.ok) {
        if (amountCheck.code === 'PERMIT_FULLY_PAID') {
          throw new ConflictException({
            code: amountCheck.code,
            message: `Permit ${permit.permitNumber} has no outstanding balance.`,
          });
        }
        throw new BadRequestException({
          code: amountCheck.code,
          message: amountCheck.message,
          details: { outstandingBalance: outstanding },
        });
      }
    }

    const reference = await uniqueReference(
      () => References.payment(dto.purpose),
      async (candidate) => (await this.prisma.payment.count({ where: { reference: candidate } })) === 0,
    );

    const currency = appConfig().payments.campay.currency;
    const companyId = permit?.companyId ?? user.companyId ?? null;

    const created = await this.prisma.payment.create({
      data: {
        reference,
        purpose: dto.purpose,
        status: PaymentStatus.PENDING,
        provider: this.providerKind,
        method,
        amount: new Prisma.Decimal(dto.amount),
        currency,
        payerId: user.id,
        companyId,
        permitId: permit?.id ?? null,
        violationId: dto.violationId ?? null,
        initiatedById: user.id,
        providerPhone: dto.payerPhone ?? null,
        notes: dto.notes,
        clientRef: dto.clientRef ?? null,
        isDemo: this.providerKind === PaymentProvider.SIMULATOR,
      },
      include: PAYMENT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.PAYMENT_INITIATED,
      entityType: 'Payment',
      entityId: created.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Payment ${created.reference} initiated — ${dto.amount} ${currency} (${dto.purpose}, ${this.providerKind})`,
      after: { amount: dto.amount, purpose: dto.purpose, method, provider: this.providerKind },
    });

    if (this.providerKind === PaymentProvider.SIMULATOR) {
      const acknowledgement = this.simulator.acknowledge(created.reference);
      const updated = await this.prisma.payment.update({
        where: { id: created.id },
        data: {
          providerReference: acknowledgement.providerReference,
          providerPayloadJson: stringifyJson(acknowledgement.payload),
        },
        include: PAYMENT_INCLUDE,
      });
      await this.markPermitPaymentPending(permit, user);
      await this.notifyOutcome(updated, 'INITIATED');
      return { payment: updated, duplicate: false, sandbox: true, instructions: this.simulator.instructions };
    }

    // Real provider: request the collection. A provider failure is recorded on
    // the payment row and reported to the caller — the payment never becomes
    // SUCCESSFUL because the provider was unreachable.
    try {
      const result = await this.campay.collect({
        amount: dto.amount,
        currency,
        method,
        phone: dto.payerPhone ?? '',
        reference: created.reference,
        description: `${dto.purpose} — ${permit?.permitNumber ?? created.reference}`,
      });
      const updated = await this.prisma.payment.update({
        where: { id: created.id },
        data: {
          status: PaymentStatus.PROCESSING,
          providerReference: result.providerReference,
          providerPayloadJson: stringifyJson(result.payload),
          processedAt: new Date(),
        },
        include: PAYMENT_INCLUDE,
      });
      await this.markPermitPaymentPending(permit, user);
      await this.notifyOutcome(updated, 'INITIATED');
      return { payment: updated, duplicate: false, sandbox: false };
    } catch (error) {
      const reason =
        error instanceof CampayNotConfiguredError
          ? error.message
          : error instanceof CampayRequestError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown provider error';

      const failed = await this.prisma.payment.update({
        where: { id: created.id },
        data: { status: PaymentStatus.FAILED, failureReason: reason.slice(0, 500), processedAt: new Date() },
        include: PAYMENT_INCLUDE,
      });
      await this.audit.record({
        action: AuditAction.PAYMENT_FAILED,
        severity: AuditSeverity.CRITICAL,
        entityType: 'Payment',
        entityId: created.id,
        actorId: user.id,
        actorEmail: user.email,
        description: `Payment ${created.reference} failed at initiation: ${reason}`,
      });
      await this.notifyOutcome(failed, 'FAILED');

      if (error instanceof CampayNotConfiguredError) {
        throw new ServiceUnavailableException({
          code: 'CAMPAY_NOT_CONFIGURED',
          message: reason,
          details: { paymentId: created.id, reference: created.reference },
        });
      }
      throw new BadGatewayException({
        code: 'PAYMENT_PROVIDER_ERROR',
        message: reason,
        details: { paymentId: created.id, reference: created.reference },
      });
    }
  }

  /**
   * The permit moves to PAYMENT_PENDING as soon as a fee collection has been
   * accepted by the provider — that is what makes the fee visible as "awaiting
   * settlement" in the workflow, and what unlocks ACTIVATE once it is paid.
   */
  private async markPermitPaymentPending(
    permit: { id: string; permitNumber: string; status: PermitStatus } | null,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (!permit || permit.status !== PermitStatus.APPROVED) return;
    try {
      await this.permits.transition(user, permit.id, 'MARK_PAYMENT_PENDING', {});
    } catch (error) {
      // Never lose a payment because the workflow step failed; the officer can
      // still move the permit manually.
      this.logger.warn(
        `Payment accepted but permit ${permit.permitNumber} could not be moved to PAYMENT_PENDING: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Verifies a payment against the provider. The mobile app never decides a
   * payment outcome: only this server call (or a signed webhook) can move a
   * payment to SUCCESSFUL.
   */
  async verify(user: AuthenticatedUser, id: string, dto: VerifyPaymentDto) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    if (payment.status === PaymentStatus.SUCCESSFUL) {
      return { payment, verification: { status: 'ALREADY_VERIFIED', message: 'This payment is already settled.' } };
    }
    const notVerifiable: PaymentStatus[] = [PaymentStatus.CANCELLED, PaymentStatus.REFUNDED];
    if (notVerifiable.includes(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_VERIFIABLE',
        message: `A ${payment.status.toLowerCase()} payment cannot be verified.`,
      });
    }
    if (payment.provider !== PaymentProvider.CAMPAY || !payment.providerReference) {
      throw new BadRequestException({
        code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
        message:
          'This payment was created with the sandbox provider, which has no external system to verify against. Confirm its outcome with POST /payments/:id/simulate.',
      });
    }

    let result;
    try {
      result = await this.campay.getTransaction(payment.providerReference);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown provider error';
      throw new BadGatewayException({
        code: 'PAYMENT_PROVIDER_UNREACHABLE',
        message: `Could not read the transaction back from Campay: ${reason}`,
        details: { providerReference: payment.providerReference },
      });
    }

    if (result.status === 'SUCCESSFUL') {
      const settled = await this.markSuccessful(payment.id, user.id, dto.notes, result.payload);
      return { payment: settled, verification: { status: 'SUCCESSFUL', message: 'Campay confirms the payment was received.' } };
    }
    if (result.status === 'FAILED') {
      const failed = await this.markFailed(payment.id, result.failureReason ?? 'Campay reported the transaction as failed.');
      return { payment: failed, verification: { status: 'FAILED', message: failed.failureReason ?? 'Payment failed.' } };
    }

    const stillPending = await this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.PROCESSING,
        providerPayloadJson: stringifyJson(result.payload),
        processedAt: new Date(),
      },
      include: PAYMENT_INCLUDE,
    });
    return {
      payment: stillPending,
      verification: { status: 'PENDING', message: 'Campay still reports the transaction as pending — the payer has not approved it yet.' },
    };
  }

  /** Sandbox-only confirmation, gated on the payments:verify permission. */
  async simulate(user: AuthenticatedUser, id: string, dto: SimulatePaymentDto) {
    if (this.providerKind !== PaymentProvider.SIMULATOR) {
      throw new BadRequestException({
        code: 'SANDBOX_DISABLED',
        message:
          'The sandbox confirmation endpoint is only available while PAYMENT_PROVIDER=simulator. Verify real Campay payments with POST /payments/:id/verify.',
      });
    }
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    if (payment.provider !== PaymentProvider.SIMULATOR) {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_SANDBOX',
        message: 'This payment was sent to the real mobile-money provider; use POST /payments/:id/verify instead.',
      });
    }
    if (!isProviderSettleable(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_VERIFIABLE',
        message: `A ${payment.status.toLowerCase()} payment cannot be confirmed again.`,
      });
    }

    if (dto.outcome === 'SUCCESSFUL') {
      const settled = await this.markSuccessful(payment.id, user.id, dto.notes, { sandbox: true, confirmedBy: user.email });
      return { payment: settled, sandbox: true };
    }
    if (dto.outcome === 'FAILED') {
      const failed = await this.markFailed(payment.id, dto.notes ?? 'Marked as failed in the local sandbox.');
      return { payment: failed, sandbox: true };
    }
    const cancelled = await this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.CANCELLED, processedAt: new Date(), failureReason: dto.notes ?? 'Cancelled in the local sandbox.' },
      include: PAYMENT_INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.PAYMENT_FAILED,
      severity: AuditSeverity.WARNING,
      entityType: 'Payment',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Sandbox payment ${cancelled.reference} cancelled`,
    });
    await this.notifyOutcome(cancelled, 'FAILED');
    return { payment: cancelled, sandbox: true };
  }

  /** Refund recorded after the money was actually returned by the provider. */
  async refund(user: AuthenticatedUser, id: string, notes?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    if (!canRefund(payment.status)) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_REFUNDABLE',
        message: `Only a SUCCESSFUL payment can be refunded (current status: ${payment.status}).`,
      });
    }

    const refunded = await this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.REFUNDED, refundedAt: new Date(), notes: notes ?? payment.notes },
      include: PAYMENT_INCLUDE,
    });

    await this.audit.record({
      action: AuditAction.PAYMENT_VERIFIED,
      severity: AuditSeverity.WARNING,
      entityType: 'Payment',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Payment ${payment.reference} refunded (${payment.amount} ${payment.currency})`,
      after: { status: 'REFUNDED', notes: notes ?? null },
    });

    if (payment.permitId) {
      await this.notifications.notifyRoles(['GOVERNMENT_FOREST_OFFICER', 'FOREST_INSPECTOR'], {
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment refunded',
        message: `${payment.amount} ${payment.currency} was refunded for permit ${payment.permit?.permitNumber ?? payment.permitId}. Any permit activated on that settlement must be reviewed.`,
        entityType: 'Payment',
        entityId: id,
        actionUrl: `/payments/${id}`,
      });
    }

    return refunded;
  }

  /** Campay calls this endpoint; the shared secret in the header is verified. */
  async handleCampayWebhook(secretHeader: string | undefined, dto: CampayWebhookDto) {
    if (!this.campay.verifyWebhookSecret(secretHeader)) {
      throw new ForbiddenException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'The webhook secret is missing or does not match CAMPAY_WEBHOOK_SECRET.',
      });
    }
    const providerReference = dto.reference ?? dto.external_reference;
    if (!providerReference) {
      throw new BadRequestException({
        code: 'WEBHOOK_REFERENCE_MISSING',
        message: 'The webhook payload carries neither reference nor external_reference.',
      });
    }

    const payment =
      (await this.prisma.payment.findFirst({ where: { providerReference } })) ??
      (await this.prisma.payment.findFirst({ where: { reference: providerReference } }));
    if (!payment) {
      this.logger.warn(`Campay webhook for unknown reference ${providerReference} ignored`);
      return { received: true, matched: false };
    }

    const status = (dto.status ?? '').toUpperCase();
    const outcome: ProviderOutcomeStatus['status'] =
      status === 'SUCCESSFUL' || status === 'SUCCESS' ? 'SUCCESSFUL' : status === 'FAILED' ? 'FAILED' : 'PENDING';
    const nextStatus = nextStatusForProviderOutcome(payment.status, { status: outcome });
    if (nextStatus === PaymentStatus.SUCCESSFUL) {
      await this.markSuccessful(payment.id, null, dto.reason, { webhook: true, ...(dto.extra ?? {}) });
    } else if (nextStatus === PaymentStatus.FAILED) {
      await this.markFailed(payment.id, dto.reason ?? 'Campay reported a failure.');
    }
    return { received: true, matched: true, status: nextStatus };
  }

  // ------------------------------------------------------------ transitions

  private async markSuccessful(
    paymentId: string,
    verifierId: string | null,
    notes: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const settled = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: PAYMENT_INCLUDE });
      if (current.status === PaymentStatus.SUCCESSFUL) return current;

      const receiptNumber =
        current.receiptNumber ??
        (await uniqueReference(
          () => References.receipt(),
          async (candidate) => (await tx.payment.count({ where: { receiptNumber: candidate } })) === 0,
        ));

      return tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.SUCCESSFUL,
          paidAt: current.paidAt ?? new Date(),
          processedAt: new Date(),
          verifiedAt: new Date(),
          verifiedById: verifierId,
          receiptNumber,
          failureReason: null,
          notes: notes ?? current.notes,
          providerPayloadJson: stringifyJson(payload),
        },
        include: PAYMENT_INCLUDE,
      });
    });

    await this.audit.record({
      action: AuditAction.PAYMENT_VERIFIED,
      entityType: 'Payment',
      entityId: paymentId,
      actorId: verifierId ?? undefined,
      description: `Payment ${settled.reference} settled — receipt ${settled.receiptNumber}`,
      after: { amount: Number(settled.amount), currency: settled.currency, receiptNumber: settled.receiptNumber },
    });

    await this.notifyOutcome(settled, 'SUCCESSFUL');

    if (settled.permitId) {
      const outstanding = await this.permits.outstandingBalance(settled.permitId);
      if (outstanding <= 0) {
        await this.notifications.notifyRoles(['GOVERNMENT_FOREST_OFFICER', 'COMPANY_REPRESENTATIVE'], {
          type: NotificationType.PAYMENT_SUCCESSFUL,
          title: 'Permit fees fully settled',
          message: `Permit ${settled.permit?.permitNumber ?? settled.permitId} is fully paid. It can now be activated to start field work.`,
          entityType: 'Payment',
          entityId: settled.id,
          actionUrl: `/permits/${settled.permitId}`,
        });
      }
    }

    return settled;
  }

  private async markFailed(paymentId: string, reason: string) {
    const failed = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.FAILED, failureReason: reason.slice(0, 500), processedAt: new Date() },
      include: PAYMENT_INCLUDE,
    });
    await this.audit.record({
      action: AuditAction.PAYMENT_FAILED,
      severity: AuditSeverity.WARNING,
      entityType: 'Payment',
      entityId: paymentId,
      description: `Payment ${failed.reference} failed: ${reason}`,
    });
    await this.notifyOutcome(failed, 'FAILED');
    return failed;
  }

  private async notifyOutcome(
    payment: Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>,
    outcome: 'INITIATED' | 'SUCCESSFUL' | 'FAILED',
  ) {
    const type =
      outcome === 'INITIATED'
        ? NotificationType.PAYMENT_INITIATED
        : outcome === 'SUCCESSFUL'
          ? NotificationType.PAYMENT_SUCCESSFUL
          : NotificationType.PAYMENT_FAILED;

    const title =
      outcome === 'INITIATED'
        ? 'Payment initiated'
        : outcome === 'SUCCESSFUL'
          ? 'Payment received'
          : 'Payment failed';

    const amount = `${Number(payment.amount)} ${payment.currency}`;
    const message =
      outcome === 'INITIATED'
        ? `${amount} was requested for ${payment.purpose.replace(/_/g, ' ').toLowerCase()} (reference ${payment.reference}).`
        : outcome === 'SUCCESSFUL'
          ? `${amount} was received for ${payment.purpose.replace(/_/g, ' ').toLowerCase()} — receipt ${payment.receiptNumber}.`
          : `${amount} for ${payment.purpose.replace(/_/g, ' ').toLowerCase()} did not go through${payment.failureReason ? `: ${payment.failureReason}` : '.'}`;

    const recipients = new Set<string>([payment.payerId, payment.initiatedById]);
    if (payment.companyId) {
      const members = await this.prisma.user.findMany({
        where: { companyId: payment.companyId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const member of members) recipients.add(member.id);
    }

    await this.notifications.notify({
      userIds: [...recipients],
      type,
      title,
      message,
      entityType: 'Payment',
      entityId: payment.id,
      actionUrl: `/payments/${payment.id}`,
      severity: outcome === 'FAILED' ? AuditSeverity.WARNING : AuditSeverity.INFO,
    });
  }

  // -------------------------------------------------------------- analytics

  async statistics(user: AuthenticatedUser, query: PaymentQueryDto) {
    const scope: Prisma.PaymentWhereInput = canReadAll(user, 'payments')
      ? query.companyId
        ? { companyId: query.companyId }
        : {}
      : { OR: [{ payerId: user.id }, { companyId: user.companyId ?? '__none__' }] };

    const where: Prisma.PaymentWhereInput = {
      ...scope,
      initiatedAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
    };

    const [byStatus, byPurpose, totals, monthly] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.payment.groupBy({ by: ['purpose'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.payment.aggregate({
        where,
        _count: { _all: true },
        _sum: { amount: true },
        _max: { paidAt: true },
      }),
      this.prisma.$queryRaw<Array<{ month: string; collected: string | number | null; count: bigint | number }>>`
        SELECT DATE_FORMAT(initiatedAt, '%Y-%m') AS month,
               SUM(CASE WHEN status = 'SUCCESSFUL' THEN amount ELSE 0 END) AS collected,
               COUNT(*) AS count
        FROM payments
        WHERE initiatedAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY month
        ORDER BY month ASC
      `,
    ]);

    return {
      total: totals._count._all,
      totalAmount: Number(totals._sum.amount ?? 0),
      lastPaymentAt: totals._max.paidAt,
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all, amount: Number(row._sum.amount ?? 0) })),
      byPurpose: byPurpose.map((row) => ({ purpose: row.purpose, count: row._count._all, amount: Number(row._sum.amount ?? 0) })),
      monthly: monthly.map((row) => ({ month: row.month, collected: Number(row.collected ?? 0), count: Number(row.count) })),
    };
  }

  /** Data behind the printable receipt (the PDF itself is produced by the reports module). */
  async receipt(user: AuthenticatedUser, id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    this.assertVisible(user, payment);
    if (payment.status !== PaymentStatus.SUCCESSFUL || !payment.receiptNumber) {
      throw new ConflictException({
        code: 'RECEIPT_UNAVAILABLE',
        message: 'A receipt is only available for a successfully settled payment.',
      });
    }

    const organisation = await this.prisma.systemSetting.findFirst({
      where: { key: 'organization.name' },
      select: { value: true },
    });

    return {
      receiptNumber: payment.receiptNumber,
      issuedAt: payment.verifiedAt ?? payment.paidAt ?? payment.updatedAt,
      issuedBy: payment.verifiedBy ? `${payment.verifiedBy.firstName} ${payment.verifiedBy.lastName}` : 'FEMS automated settlement',
      organisation: organisation?.value ?? 'Ministère des Forêts et de la Faune — FEMS',
      payment: {
        reference: payment.reference,
        purpose: payment.purpose,
        method: payment.method,
        amount: Number(payment.amount),
        currency: payment.currency,
        provider: payment.provider,
        providerReference: payment.providerReference,
        isSandbox: payment.provider === PaymentProvider.SIMULATOR,
        paidAt: payment.paidAt,
      },
      payer: {
        id: payment.payer.id,
        name: `${payment.payer.firstName} ${payment.payer.lastName}`,
        email: payment.payer.email,
        phone: payment.providerPhone,
      },
      company: payment.company,
      permit: payment.permit,
    };
  }

  private assertVisible(user: AuthenticatedUser, payment: { payerId: string; companyId: string | null }): void {
    if (canReadAll(user, 'payments')) return;
    if (payment.payerId === user.id) return;
    if (user.companyId && payment.companyId === user.companyId) return;
    throw new ForbiddenException({ code: 'PAYMENT_FORBIDDEN', message: 'This payment belongs to another account.' });
  }
}
