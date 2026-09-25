import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditSeverity, NotificationType, Prisma } from '@prisma/client';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface NotifyInput {
  /** One or more recipients. Duplicates are removed. */
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  severity?: AuditSeverity;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  expiresAt?: Date;
  /** Optional email body used when the recipient enabled email for this type. */
  emailSubject?: string;
  emailText?: string;
}

export interface NotifyResult {
  created: number;
  inAppDelivered: number;
  pushDelivered: number;
  emailDelivered: number;
  pushStatus: 'SENT' | 'NO_RECIPIENTS' | 'NOT_CONFIGURED' | 'FAILED';
  pushError?: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'high' | 'normal';
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Notification delivery.
 *
 * Every event writes an in-app notification row (respecting the recipient's
 * preference). Push is delivered through the Expo push service when
 * PUSH_PROVIDER=expo and the user has registered device tokens; email goes
 * through the configured SMTP transport. Delivery flags on the row always
 * reflect what actually happened — an unconfigured channel is recorded as
 * undelivered, never as a success.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) {
      return {
        created: 0,
        inAppDelivered: 0,
        pushDelivered: 0,
        emailDelivered: 0,
        pushStatus: 'NO_RECIPIENTS',
      };
    }

    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type: input.type },
    });
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));

    const recipients = await Promise.all(
      userIds.map(async (userId) => {
        const preference = preferenceByUser.get(userId);
        return {
          userId,
          // Defaults follow the product specification: in-app + push on, email off.
          inApp: preference?.inAppEnabled ?? true,
          push: preference?.pushEnabled ?? true,
          email: preference?.emailEnabled ?? false,
        };
      }),
    );

    const toPersist = recipients.filter((recipient) => recipient.inApp || recipient.push || recipient.email);
    if (toPersist.length === 0) {
      return {
        created: 0,
        inAppDelivered: 0,
        pushDelivered: 0,
        emailDelivered: 0,
        pushStatus: 'NO_RECIPIENTS',
      };
    }

    const pushTargets = toPersist.filter((recipient) => recipient.push);
    const pushOutcome = await this.sendPushToUsers(pushTargets.map((recipient) => recipient.userId), input);

    const emailTargets = toPersist.filter((recipient) => recipient.email);
    const emailOutcome = await this.sendEmailsToUsers(emailTargets.map((recipient) => recipient.userId), input);

    await this.prisma.notification.createMany({
      data: toPersist.map((recipient) => ({
        userId: recipient.userId,
        type: input.type,
        title: input.title.slice(0, 191),
        message: input.message.slice(0, 500),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
        severity: input.severity ?? AuditSeverity.INFO,
        deliveredInApp: recipient.inApp,
        deliveredPush: recipient.push && pushOutcome.deliveredUserIds.has(recipient.userId),
        deliveredEmail: recipient.email && emailOutcome.deliveredUserIds.has(recipient.userId),
        expiresAt: input.expiresAt ?? null,
      })),
    });

    return {
      created: toPersist.length,
      inAppDelivered: toPersist.filter((recipient) => recipient.inApp).length,
      pushDelivered: pushOutcome.deliveredUserIds.size,
      emailDelivered: emailOutcome.deliveredUserIds.size,
      pushStatus: pushOutcome.status,
      pushError: pushOutcome.error,
    };
  }

  /** Notifies every active user holding one of the given roles. */
  async notifyRoles(roleNames: string[], input: Omit<NotifyInput, 'userIds'>): Promise<NotifyResult> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: { some: { role: { name: { in: roleNames } } } },
      },
      select: { id: true },
    });
    return this.notify({ ...input, userIds: users.map((user) => user.id) });
  }

  /** Broadcast helper: every active, non-deleted account. */
  async notifyAllActive(input: Omit<NotifyInput, 'userIds'>): Promise<NotifyResult> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return this.notify({ ...input, userIds: users.map((user) => user.id) });
  }

  private async sendPushToUsers(
    userIds: string[],
    input: NotifyInput,
  ): Promise<{ status: NotifyResult['pushStatus']; deliveredUserIds: Set<string>; error?: string }> {
    const deliveredUserIds = new Set<string>();
    if (userIds.length === 0) return { status: 'NO_RECIPIENTS', deliveredUserIds };

    const provider = appConfig().notifications.pushProvider;
    if (provider !== 'expo') {
      this.logger.warn(
        `Push notification "${input.title}" not sent: PUSH_PROVIDER is "${provider}" (set PUSH_PROVIDER=expo to enable Expo push delivery).`,
      );
      return {
        status: 'NOT_CONFIGURED',
        deliveredUserIds,
        error: 'Push delivery is not configured on this server (PUSH_PROVIDER).',
      };
    }

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, token: true },
    });
    if (tokens.length === 0) {
      return { status: 'NO_RECIPIENTS', deliveredUserIds, error: 'No device tokens registered.' };
    }

    const messages: ExpoPushMessage[] = tokens.map((device) => ({
      to: device.token,
      title: input.title.slice(0, 100),
      body: input.message.slice(0, 178),
      data: {
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
      },
      sound: 'default',
      priority: input.severity === AuditSeverity.CRITICAL ? 'high' : 'normal',
    }));

    try {
      const response = await fetch(appConfig().notifications.expoPushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        return {
          status: 'FAILED',
          deliveredUserIds,
          error: `Expo push service responded with HTTP ${response.status}.`,
        };
      }
      const payload = (await response.json()) as { data?: ExpoPushTicket[] };
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') deliveredUserIds.add(tokens[index].userId);
        else {
          this.logger.warn(
            `Expo push rejected a message for user ${tokens[index].userId}: ${ticket.message ?? ticket.details?.error ?? 'unknown error'}`,
          );
        }
      });
      return { status: 'SENT', deliveredUserIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Expo push delivery failed: ${message}`);
      return { status: 'FAILED', deliveredUserIds, error: message };
    }
  }

  private async sendEmailsToUsers(
    userIds: string[],
    input: NotifyInput,
  ): Promise<{ deliveredUserIds: Set<string> }> {
    const deliveredUserIds = new Set<string>();
    if (userIds.length === 0) return { deliveredUserIds };
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    for (const user of users) {
      // Sequential on purpose: SMTP through a relay is rate-limited.
      // eslint-disable-next-line no-await-in-loop
      const result = await this.mail.send({
        to: user.email,
        subject: input.emailSubject ?? input.title,
        text: input.emailText ?? input.message,
      });
      if (result.status === 'SENT') deliveredUserIds.add(user.id);
    }
    return { deliveredUserIds };
  }

  // ------------------------------------------------------------- inbox API

  async list(
    userId: string,
    filters: { unreadOnly?: boolean; type?: NotificationType; page: number; limit: number },
  ) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      readAt: filters.unreadOnly ? null : undefined,
      type: filters.type,
    };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items,
      unreadCount: unread,
      meta: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
        hasNextPage: filters.page < Math.ceil(total / filters.limit),
        hasPreviousPage: filters.page > 1,
      },
    };
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unread };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
    }
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: notification.readAt ?? new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async remove(userId: string, id: string): Promise<{ deleted: boolean }> {
    const result = await this.prisma.notification.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' });
    }
    return { deleted: true };
  }

  /** Housekeeping used by the scheduler: drop notifications older than 90 days. */
  async purgeExpired(): Promise<{ removed: number }> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) }, readAt: { not: null } },
        ],
      },
    });
    return { removed: result.count };
  }
}
