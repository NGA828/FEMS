/**
 * Permit detail.
 *
 * The screen shows the record, its full state history and — from
 * `GET /permits/:id/actions` — exactly the transitions the backend is willing to
 * accept for this user at this moment. Choosing one posts it to
 * `POST /permits/:id/actions/:action`; the API validates the transition, the
 * role and any reason or volume it requires, and its answer (or refusal) is what
 * the user sees. Documents can be uploaded and verified from here too.
 */
import React, { useMemo, useState } from 'react';

import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useActivities,
  useAttachPermitDocument,
  usePayments,
  usePermit,
  usePermitActions,
  usePermitDocuments,
  usePermitTimeline,
  usePermitAction,
  usePermits,
  useUploadFile,
  useVerifyPermitDocument,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
  ErrorState,
  Heading,
  Notice,
  Overline,
  Row,
  Section,
  SkeletonDetail,
  StatusPill,
  TextField,
  Timeline,
  Tiny,
  Title,
  statusTone,
  useToast,
} from '../../../src/ui';
import {
  activityStatusLabel,
  activityTypeLabel,
  documentTypeLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelative,
  formatVolume,
  humanize,
  paymentPurposeLabel,
  paymentStatusLabel,
  permitStatusLabel,
  permitTypeLabel,
  truncate,
} from '../../../src/lib/format';

const ACTION_COPY: Record<string, { title: string; needsReason: boolean; needsVolume?: boolean; destructive?: boolean }> = {
  SUBMIT: { title: 'Submit the application', needsReason: false },
  START_REVIEW: { title: 'Start the review', needsReason: false },
  REQUEST_REVISION: { title: 'Request a revision', needsReason: true },
  APPROVE: { title: 'Approve the permit', needsReason: false, needsVolume: true },
  REJECT: { title: 'Reject the application', needsReason: true, destructive: true },
  ACTIVATE: { title: 'Activate the permit', needsReason: false },
  SUSPEND: { title: 'Suspend the permit', needsReason: true, destructive: true },
  REVOKE: { title: 'Revoke the permit', needsReason: true, destructive: true },
  CANCEL: { title: 'Cancel the permit', needsReason: true, destructive: true },
  RENEW: { title: 'Request a renewal', needsReason: false },
};

export default function PermitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission, user } = useAuth();

  const permit = usePermit(id ?? null);
  const actions = usePermitActions(id ?? null);
  const timeline = usePermitTimeline(id ?? null);
  const documents = usePermitDocuments(id ?? null);
  const relatedActivities = useActivities({ permitId: id, limit: 5 });
  const relatedPayments = usePayments({ permitId: id, limit: 5 });
  const siblings = usePermits({ limit: 1 });

  const runAction = usePermitAction(id ?? '');
  const upload = useUploadFile();
  const attachDocument = useAttachPermitDocument(id ?? '');
  const verifyDocument = useVerifyPermitDocument(id ?? '');

  const [decision, setDecision] = useState<{ action: string; label: string; requiresReason: boolean; needsVolume: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [approvedVolume, setApprovedVolume] = useState('');
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<keyof typeof DOCUMENT_TYPES>('EXPLOITATION_LICENCE');

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const canVerifyDocuments = hasPermission('permits:review');
  const canUploadDocuments = hasPermission('permits:manage_documents') || hasPermission('permits:create') || hasPermission('permits:update');

  const data = permit.data;
  const availableActions = actions.data?.actions ?? [];

  const reasonMinLength = 10;
  const decisionValid = useMemo(() => {
    if (!decision) return false;
    if (decision.requiresReason && reason.trim().length < reasonMinLength) return false;
    if (decision.needsVolume && (!approvedVolume || Number(approvedVolume) <= 0)) return false;
    return true;
  }, [decision, reason, approvedVolume]);

  const submitDecision = async () => {
    if (!decision) return;
    try {
      await runAction.mutateAsync({
        action: decision.action,
        payload: {
          ...(decision.requiresReason ? { reason: reason.trim() } : {}),
          ...(decision.needsVolume ? { volumeApprovedM3: Number(approvedVolume) } : {}),
        },
      });
      toast.success(`${decision.label} accepted`, 'The state machine recorded the transition in the permit history.');
      setDecision(null);
      setReason('');
      setApprovedVolume('');
    } catch (error) {
      const details = error instanceof ApiError ? Object.values(fieldErrors(error))[0] : undefined;
      toast.error(
        error instanceof ApiError ? (error.code === 'PERMIT_INVALID_TRANSITION' ? 'Transition refused' : 'Action refused') : 'Action failed',
        details ?? (error instanceof ApiError ? error.message : undefined),
      );
    }
  };

  const pickAndUpload = async () => {
    setUploading(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });

      if (result.canceled || !result.assets?.length) {
        setUploading(false);
        return;
      }
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `permit-document-${Date.now()}.jpg`;
      const uri = asset.base64 && Platform.OS === 'web' ? `data:${mimeType};base64,${asset.base64}` : asset.uri;

      const stored = await upload.mutateAsync({ file: { uri, name, mimeType }, folder: 'permits/documents' });
      await attachDocument.mutateAsync({
        type: docType,
        title: name,
        fileKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        notes: `Uploaded from the FEMS mobile app (${Platform.OS})`,
      });
      toast.success('Document attached', `${documentTypeLabel(docType, language)} · ${Math.round(stored.sizeBytes / 1024)} KB`);
    } catch (error) {
      toast.error('Upload failed', error instanceof ApiError ? error.message : 'The file could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  if (permit.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <SkeletonDetail />
      </ScrollView>
    );
  }

  if (permit.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={permit.error} onRetry={() => permit.refetch()} />
        <Button label="Back to the register" variant="secondary" onPress={() => router.replace('/permits')} fullWidth />
      </ScrollView>
    );
  }

  const outstanding = actions.data?.outstandingBalance ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={
        <RefreshControl
          refreshing={permit.isRefetching}
          onRefresh={() => {
            void permit.refetch();
            void actions.refetch();
            void timeline.refetch();
            void documents.refetch();
          }}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={6}>
            <Body style={{ fontWeight: '800', fontSize: 17 }}>{data.permitNumber}</Body>
            {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
          <Title>{data.title}</Title>
        </View>
        <StatusPill status={data.status} label={permitStatusLabel(data.status, language)} />
      </Row>

      {data.status === 'PAYMENT_PENDING' && outstanding > 0 ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="warning" title="Fee outstanding">
            {formatCurrency(outstanding, 'XAF', language)} must be settled before the permit can be activated.
          </Notice>
          {hasPermission('payments:create') ? (
            <Row gap={8} style={{ marginTop: 8 }}>
              <Button
                label="Pay the permit fee"
                icon="card-outline"
                onPress={() => router.push({ pathname: '/payment/new', params: { permitId: data.id } })}
              />
            </Row>
          ) : null}
        </View>
      ) : null}

      {decision ? (
        <Card style={{ marginBottom: 16, borderColor: theme.colors.primary, borderWidth: 1 }}>
          <Overline style={{ marginBottom: 6 }}>Decision</Overline>
          <Heading style={{ marginBottom: 10 }}>{decision.label}</Heading>
          {decision.needsVolume ? (
            <TextField
              label="Approved volume (m³)"
              required
              keyboardType="numeric"
              value={approvedVolume}
              onChangeText={setApprovedVolume}
              help={`Requested: ${formatVolume(data.volumeRequestedM3, language)}`}
            />
          ) : null}
          {decision.requiresReason ? (
            <TextField
              label="Reason"
              required
              multiline
              value={reason}
              onChangeText={setReason}
              placeholder="Explain the decision — it is stored in the permit history and the audit trail"
              help={`${reason.trim().length}/${reasonMinLength} characters minimum`}
            />
          ) : null}
          {!decision.requiresReason && !decision.needsVolume ? (
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              This transition is recorded in the permit history with your account as the author.
            </Caption>
          ) : null}
          <Row gap={8}>
            <Button label="Confirm" onPress={submitDecision} loading={runAction.isPending} disabled={!decisionValid} icon="checkmark-outline" />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setDecision(null);
                setReason('');
                setApprovedVolume('');
              }}
            />
          </Row>
        </Card>
      ) : null}

      {availableActions.length > 0 ? (
        <Section title="Available actions">
          <Row gap={8} wrap>
            {availableActions.map((action) => {
              const copy = ACTION_COPY[action.action] ?? { title: action.label, needsReason: action.requiresReason };
              return (
                <Button
                  key={action.action}
                  label={action.label}
                  size="sm"
                  variant={copy.destructive ? 'danger' : action.action === 'APPROVE' || action.action === 'ACTIVATE' ? 'primary' : 'secondary'}
                  icon={copy.destructive ? 'alert-circle-outline' : 'arrow-forward-outline'}
                  onPress={() =>
                    setDecision({
                      action: action.action,
                      label: copy.title,
                      requiresReason: action.requiresReason,
                      needsVolume: Boolean(copy.needsVolume),
                    })
                  }
                />
              );
            })}
          </Row>
          <Caption tone="faint" style={{ marginTop: 8 }}>
            Offered by the backend for your role and this state — {humanize(data.status)} → {availableActions.map((action) => humanize(action.targetStatus)).join(', ')}
          </Caption>
        </Section>
      ) : (
        <Section title="Available actions">
          <Card>
            <Row gap={10}>
              <Ionicons name="lock-closed-outline" size={18} color={theme.colors.textMuted} />
              <Caption tone="muted" style={{ flex: 1 }}>
                No transition is available on this permit for your role. The state machine only exposes steps your account is entitled to perform.
              </Caption>
            </Row>
          </Card>
        </Section>
      )}

      <Section title="Permit">
        <Card>
          <Definition label="Type" value={permitTypeLabel(data.type, language)} />
          <Definition label="Purpose" value={truncate(data.purpose ?? '—', 160)} />
          <Definition label="Company" value={data.company?.name ?? '—'} />
          <Definition label="Forest" value={data.forest ? `${data.forest.name} (${data.forest.code})` : '—'} />
          <Definition label="Zone" value={data.zone ? `${data.zone.name} (${data.zone.code})` : 'Whole forest'} />
          <Definition label="Valid from" value={formatDate(data.startDate, language)} />
          <Definition label="Valid until" value={formatDate(data.endDate, language)} />
          <Definition label="Volume requested" value={formatVolume(data.volumeRequestedM3, language)} />
          <Definition label="Volume approved" value={data.volumeApprovedM3 ? formatVolume(data.volumeApprovedM3, language) : '—'} />
          <Definition label="Fee" value={formatCurrency(data.feeAmount ?? 0, data.currency ?? 'XAF', language)} />
          <Definition label="Royalty rate" value={`${formatCurrency(data.royaltyRatePerM3 ?? 0, 'XAF', language)} / m³`} />
          <Definition label="Outstanding balance" value={formatCurrency(outstanding, 'XAF', language)} tone={outstanding > 0 ? 'danger' : 'success'} />
          <Definition label="Conditions" value={data.conditions ? truncate(data.conditions, 200) : '—'} />
        </Card>
      </Section>

      {relatedActivities.data && relatedActivities.data.items.length > 0 ? (
        <Section
          title="Exploitation activities"
          action={
            hasPermission('exploitation:create') ? (
              <Pressable
                onPress={() => router.push({ pathname: '/activity/capture', params: { permitId: data.id } })}
                accessibilityRole="button"
                accessibilityLabel="Record an activity on this permit"
              >
                <Caption tone="primary" style={{ fontWeight: '700' }}>
                  Record
                </Caption>
              </Pressable>
            ) : null
          }
        >
          <Card padded={false}>
            {relatedActivities.data.items.map((activity, index) => (
              <Pressable
                key={activity.id}
                onPress={() => router.push({ pathname: '/activity/[id]', params: { id: activity.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Activity ${activity.reference}`}
                style={({ pressed }) => ({
                  padding: 14,
                  backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                })}
              >
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Body style={{ fontWeight: '600' }}>{activity.reference}</Body>
                  <StatusPill status={activity.status} label={activityStatusLabel(activity.status, language)} />
                </Row>
                <Caption tone="muted">
                  {activityTypeLabel(activity.activityType, language)} · harvested {formatVolume(activity.harvestedVolumeM3 ?? 0, language)} of{' '}
                  {formatVolume(activity.plannedVolumeM3, language)}
                </Caption>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {relatedPayments.data && relatedPayments.data.items.length > 0 ? (
        <Section title="Payments">
          <Card padded={false}>
            {relatedPayments.data.items.map((payment, index) => (
              <Pressable
                key={payment.id}
                onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Payment ${payment.reference}`}
                style={({ pressed }) => ({
                  padding: 14,
                  backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                })}
              >
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600' }}>{formatCurrency(payment.amount, payment.currency ?? 'XAF', language)}</Body>
                  <StatusPill status={payment.status} label={paymentStatusLabel(payment.status, language)} />
                </Row>
                <Caption tone="muted">
                  {paymentPurposeLabel(payment.purpose, language)} · {payment.reference} · {payment.provider ?? '—'}
                </Caption>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Documents">
        {documents.isLoading ? (
          <Caption tone="muted">Loading documents…</Caption>
        ) : (documents.data ?? []).length === 0 ? (
          <Card>
            <Caption tone="muted">
              No document has been attached to this permit yet. Registration papers, the tax clearance and the environmental assessment are required for
              verification.
            </Caption>
          </Card>
        ) : (
          <Card padded={false}>
            {(documents.data ?? []).map((document, index) => (
              <View
                key={document.id}
                style={{
                  padding: 14,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                  gap: 4,
                }}
              >
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                    {document.title}
                  </Body>
                  <Badge label={document.isVerified ? 'Verified' : 'Unverified'} tone={document.isVerified ? 'success' : 'warning'} />
                </Row>
                <Caption tone="muted">
                  {documentTypeLabel(document.type, language)} · {Math.max(1, Math.round(document.sizeBytes / 1024))} KB
                  {document.verifiedAt ? ` · verified ${formatRelative(document.verifiedAt, language)}` : ''}
                </Caption>
                {canVerifyDocuments ? (
                  <Row gap={8} style={{ marginTop: 4 }}>
                    <Button
                      label={document.isVerified ? 'Revoke verification' : 'Verify'}
                      size="sm"
                      variant={document.isVerified ? 'ghost' : 'secondary'}
                      loading={verifyDocument.isPending}
                      onPress={() =>
                        void verifyDocument.mutateAsync(
                          { documentId: document.id, isVerified: !document.isVerified },
                          {
                            onSuccess: () => toast.success(document.isVerified ? 'Verification revoked' : 'Document verified'),
                            onError: (error) => toast.error('Could not update', error instanceof ApiError ? error.message : undefined),
                          },
                        )
                      }
                    />
                  </Row>
                ) : null}
              </View>
            ))}
          </Card>
        )}

        {canUploadDocuments ? (
          <Card style={{ marginTop: 12 }}>
            <Overline style={{ marginBottom: 8 }}>Attach a document</Overline>
            <Row gap={8} wrap style={{ marginBottom: 10 }}>
              {(Object.keys(DOCUMENT_TYPES) as (keyof typeof DOCUMENT_TYPES)[]).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setDocType(type)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: docType === type }}
                  accessibilityLabel={DOCUMENT_TYPES[type]}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: theme.radii.pill,
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderColor: docType === type ? theme.colors.primary : theme.colors.border,
                    backgroundColor: docType === type ? theme.colors.primarySoft : theme.colors.surface,
                  }}
                >
                  <Tiny style={{ color: docType === type ? theme.colors.primary : theme.colors.textMuted, fontWeight: '600' }}>
                    {DOCUMENT_TYPES[type]}
                  </Tiny>
                </Pressable>
              ))}
            </Row>
            <Button
              label={uploading ? 'Uploading…' : 'Choose a photo or scan'}
              icon="cloud-upload-outline"
              loading={uploading}
              onPress={() => void pickAndUpload()}
            />
            <Caption tone="faint" style={{ marginTop: 8 }}>
              Files are stored by the backend storage module (folder `permits/documents`) and the upload is recorded with your account as the actor.
            </Caption>
          </Card>
        ) : null}
      </Section>

      <Section title="History">
        <Card>
          <Timeline
            entries={(timeline.data ?? []).map((entry) => ({
              id: entry.id,
              title: entry.fromStatus
                ? `${permitStatusLabel(entry.fromStatus, language)} → ${permitStatusLabel(entry.toStatus, language)}`
                : `${permitStatusLabel(entry.toStatus, language)}`,
              description: entry.reason ?? undefined,
              timestamp: `${formatDateTime(entry.createdAt, language)}${entry.changedBy ? ` · ${entry.changedBy.firstName} ${entry.changedBy.lastName}` : ''}`,
              tone: statusTone(entry.toStatus),
              icon: entry.reason ? 'document-text-outline' : 'ellipse',
            }))}
          />
        </Card>
      </Section>

      <Section title="Record">
        <Card>
          <Definition label="Created" value={formatDateTime(data.createdAt, language)} />
          <Definition label="Submitted" value={data.submittedAt ? formatDateTime(data.submittedAt, language) : '—'} />
          <Definition label="Approved" value={data.approvedAt ? `${formatDateTime(data.approvedAt, language)}${data.approvedBy ? ` · ${data.approvedBy.firstName} ${data.approvedBy.lastName}` : ''}` : '—'} />
          <Definition label="Activated" value={data.activatedAt ? formatDateTime(data.activatedAt, language) : '—'} />
          <Definition label="Revisions" value={String(data.revisionCount ?? 0)} />
          <Definition label="Renewals" value={String(data.renewalCount ?? 0)} />
          {data.suspensionReason ? <Definition label="Suspension reason" value={data.suspensionReason} tone="danger" /> : null}
          {data.rejectionReason ? <Definition label="Rejection reason" value={data.rejectionReason} tone="danger" /> : null}
        </Card>
      </Section>

      <Tiny tone="faint" style={{ textAlign: 'center', marginTop: 4 }}>
        {siblings.data?.meta?.total ?? 0} permits in your scope · record {data.id.slice(0, 8)}
      </Tiny>
    </ScrollView>
  );
}

/** Document categories offered when attaching a file (mirrors the Prisma enum). */
const DOCUMENT_TYPES = {
  EXPLOITATION_LICENCE: 'Exploitation licence',
  MANAGEMENT_PLAN: 'Management plan',
  TAX_CLEARANCE: 'Tax clearance',
  ENVIRONMENTAL_IMPACT_ASSESSMENT: 'Impact assessment',
  COMPANY_REGISTRATION: 'Company registration',
  OTHER: 'Other',
} as const;
