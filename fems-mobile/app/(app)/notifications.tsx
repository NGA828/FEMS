/**
 * Notifications inbox.
 *
 * Rows come from `GET /notifications` for the signed-in account; opening one
 * marks it read through the API and follows the entity it points at (permit,
 * inspection, case, payment, report) so the user lands on the record the message
 * is about. The filter runs on the server, not over a cached page.
 */
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../../src/api/queries';
import type { AppNotification } from '../../src/api/types';
import { useTheme } from '../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Row,
  Section,
  SkeletonList,
  Title,
  Tiny,
  useToast,
} from '../../src/ui';
import { formatRelative, notificationTypeLabel } from '../../src/lib/format';

/** Maps a notification type to the screen that shows the record it is about. */
function routeFor(notification: AppNotification): string | null {
  const { entityType, entityId, actionUrl } = notification;
  if (actionUrl) return actionUrl;
  if (!entityId) return null;
  switch (entityType) {
    case 'ExploitationPermit':
      return `/permit/${entityId}`;
    case 'Inspection':
      return `/inspection/${entityId}`;
    case 'EnvironmentalViolation':
      return `/violation/${entityId}`;
    case 'Payment':
      return `/payment/${entityId}`;
    case 'Report':
      return `/report/${entityId}`;
    case 'AIAlert':
      return `/alert/${entityId}`;
    case 'ExploitationActivity':
      return `/activity/${entityId}`;
    case 'Company':
      return `/company/${entityId}`;
    default:
      return null;
  }
}

function severityTone(severity: AppNotification['severity']): 'info' | 'warning' | 'danger' {
  if (severity === 'CRITICAL') return 'danger';
  if (severity === 'WARNING') return 'warning';
  return 'info';
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notifications = useNotifications({ limit: 40, unreadOnly });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const open = async (notification: AppNotification) => {
    if (!notification.readAt) {
      markRead.mutate(notification.id, {
        onError: (error) => toast.error('Could not mark as read', error instanceof ApiError ? error.message : undefined),
      });
    }
    const target = routeFor(notification);
    if (target) router.push(target as never);
    else toast.info(notification.title, notification.message);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }}
      refreshControl={
        <RefreshControl
          refreshing={notifications.isRefetching}
          onRefresh={() => notifications.refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
        <View style={{ flex: 1 }}>
          <Title>Notifications</Title>
          <Caption tone="muted">Permit decisions, inspections assigned to you, cases, payments and alerts.</Caption>
        </View>
        <Button
          label="Mark all read"
          size="sm"
          variant="secondary"
          icon="checkmark-done-outline"
          loading={markAll.isPending}
          onPress={() =>
            markAll.mutate(undefined, {
              onSuccess: (result) => toast.success('Inbox cleared', `${result.updated} notification(s) marked as read.`),
            })
          }
        />
      </Row>

      <Row gap={8} style={{ marginBottom: 16 }}>
        <Button label="All" size="sm" variant={unreadOnly ? 'secondary' : 'primary'} onPress={() => setUnreadOnly(false)} />
        <Button label="Unread only" size="sm" variant={unreadOnly ? 'primary' : 'secondary'} onPress={() => setUnreadOnly(true)} />
      </Row>

      <Section>
        {notifications.isLoading ? (
          <SkeletonList rows={4} />
        ) : notifications.isError ? (
          <ErrorState error={notifications.error} onRetry={() => notifications.refetch()} />
        ) : (notifications.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title={unreadOnly ? 'No unread notification' : 'Your inbox is empty'}
            description={
              unreadOnly
                ? 'Everything that arrived has been read.'
                : 'FEMS notifies you when a permit changes state, an inspection is assigned, a payment settles or an alert is raised in your scope.'
            }
            actionLabel={unreadOnly ? 'Show all' : undefined}
            onAction={unreadOnly ? () => setUnreadOnly(false) : undefined}
          />
        ) : (
          notifications.data?.items.map((notification) => (
            <Pressable
              key={notification.id}
              onPress={() => void open(notification)}
              accessibilityRole="button"
              accessibilityLabel={`${notification.title}. ${notification.message}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 10 })}
            >
              <Card>
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <Row gap={6} style={{ flex: 1 }}>
                    {notification.readAt ? null : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary }} />}
                    <Badge label={notificationTypeLabel(notification.type)} tone={severityTone(notification.severity)} />
                  </Row>
                  <Tiny tone="faint">{formatRelative(notification.createdAt)}</Tiny>
                </Row>
                <Body style={{ fontWeight: '600', marginBottom: 2 }} lines={2}>
                  {notification.title}
                </Body>
                <Caption tone="muted" lines={3}>
                  {notification.message}
                </Caption>
                <Row justify="space-between" style={{ marginTop: 8 }}>
                  <Row gap={8}>
                    {notification.deliveredInApp ? (
                      <Row gap={4}>
                        <Ionicons name="phone-portrait-outline" size={12} color={theme.colors.textFaint} />
                        <Tiny tone="faint">in-app</Tiny>
                      </Row>
                    ) : null}
                    {notification.deliveredEmail ? (
                      <Row gap={4}>
                        <Ionicons name="mail-outline" size={12} color={theme.colors.textFaint} />
                        <Tiny tone="faint">email</Tiny>
                      </Row>
                    ) : null}
                    {notification.deliveredPush ? (
                      <Row gap={4}>
                        <Ionicons name="notifications-outline" size={12} color={theme.colors.textFaint} />
                        <Tiny tone="faint">push</Tiny>
                      </Row>
                    ) : null}
                  </Row>
                  {routeFor(notification) ? (
                    <Row gap={4}>
                      <Tiny style={{ color: theme.colors.primary }}>Open record</Tiny>
                      <Ionicons name="chevron-forward" size={12} color={theme.colors.primary} />
                    </Row>
                  ) : null}
                </Row>
              </Card>
            </Pressable>
          ))
        )}
      </Section>
    </ScrollView>
  );
}
