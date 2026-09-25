/**
 * Environmental case detail.
 *
 * The lifecycle of a case is a state machine on the server: an officer first
 * authorises the action through their permissions, then the service validates the
 * transition. The buttons below come from `actions` on the case itself, so the app
 * offers exactly what the API will accept — including the written reason that
 * confirm, dismiss, escalate and resolve require.
 */
import React, { useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useAttachEvidence,
  usePaymentProvider,
  useUploadFile,
  useViolation,
  useViolationAction,
  useViolations,
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
  Notice,
  Overline,
  RiskPill,
  Row,
  Section,
  SelectSheet,
  SkeletonDetail,
  StatusPill,
  TextField,
  Tiny,
  Title,
  useConfirm,
  useToast,
} from '../../../src/ui';
import { formatCurrency, formatDate, formatDateTime, formatRelative, severityLabel, violationStatusLabel } from '../../../src/lib/format';

const ACTION_COPY: Record<string, { label: string; help: string; requiresReason: boolean }> = {
  ACKNOWLEDGE: { label: 'Acknowledge', help: 'Records that the case has been picked up by the service.', requiresReason: false },
  START_INVESTIGATION: { label: 'Start investigation', help: 'Opens the investigation phase; the case leaves the open queue.', requiresReason: false },
  CONFIRM: { label: 'Confirm the case', help: 'Confirms the facts and sets the penalty. A written reason is required.', requiresReason: true },
  DISMISS: { label: 'Dismiss', help: 'Closes the case without a finding. A written reason is required.', requiresReason: true },
  ESCALATE: { label: 'Escalate', help: 'Sends the case to the next level (judicial or ministerial). A reason is required.', requiresReason: true },
  RESOLVE: { label: 'Resolve', help: 'Closes the case once the penalty is settled and the remediation is done.', requiresReason: true },
  REOPEN: { label: 'Reopen', help: 'Brings a closed case back into the workflow. A reason is required.', requiresReason: true },
};

export default function ViolationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const violation = useViolation(id ?? null);
  const action = useViolationAction(id ?? '');
  const upload = useUploadFile();
  const attachEvidence = useAttachEvidence({ violationId: id });
  const provider = usePaymentProvider();
  const linked = useViolations({ companyId: violation.data?.companyId ?? undefined, limit: 5 });

  const [choice, setChoice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [penalty, setPenalty] = useState('');
  const [damage, setDamage] = useState('');
  const [remediation, setRemediation] = useState('');
  const [remediationDeadline, setRemediationDeadline] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldProblems, setFieldProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const data = violation.data;
  const canUpdate = hasPermission('environmental:update') || hasPermission('environmental:confirm');
  const chosen = choice ? ACTION_COPY[choice] : null;

  const problems: Record<string, string> = {
    ...fieldProblems,
    ...(chosen?.requiresReason && reason.trim().length < 10 ? { reason: 'At least 10 characters are required for this decision.' } : {}),
    ...(choice === 'CONFIRM' && penalty && Number(penalty) < 0 ? { penaltyAmountXAF: 'The penalty cannot be negative.' } : {}),
  };

  const submit = async () => {
    if (!choice) return;
    setFailure(null);
    setFieldProblems({});
    if (Object.keys(problems).length > 0) {
      setFailure(Object.values(problems)[0]);
      return;
    }
    setBusy(true);
    try {
      await action.mutateAsync({
        action: choice,
        reason: reason.trim() || undefined,
        penaltyAmountXAF: penalty ? Number(penalty) : undefined,
        estimatedDamageXAF: damage ? Number(damage) : undefined,
        remediationRequired: remediation.trim() ? true : undefined,
        remediationNotes: remediation.trim() || undefined,
        remediationDeadline: remediationDeadline ? new Date(remediationDeadline).toISOString() : undefined,
      });
      toast.success('Case updated', `${chosen?.label ?? choice} recorded.`);
      setChoice(null);
      setReason('');
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldProblems(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The action could not be recorded.');
      }
    } finally {
      setBusy(false);
    }
  };

  const attachPhoto = async () => {
    setBusy(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await ImagePicker.launchImageLibraryAsync({ quality: 0.8 })
          : await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.length) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      const stored = await upload.mutateAsync({
        file: { uri: asset.uri, name: asset.fileName ?? `case-evidence-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' },
        folder: 'evidence',
      });
      await attachEvidence.mutateAsync({
        type: 'PHOTO',
        source: Platform.OS === 'web' ? 'DEVICE_LIBRARY' : 'DEVICE_CAMERA',
        fileKey: stored.fileKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        title: `Case evidence ${new Date().toLocaleTimeString()}`,
        violationId: id,
        latitude: data?.latitude,
        longitude: data?.longitude,
        capturedAt: new Date().toISOString(),
      });
      toast.success('Evidence attached', 'It is stored with the case and its position.');
    } catch (error) {
      toast.error('Upload failed', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (violation.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <SkeletonDetail />
      </ScrollView>
    );
  }

  if (violation.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={violation.error} onRetry={() => violation.refetch()} />
        <Button label="Back to the register" variant="secondary" onPress={() => router.replace('/violation')} fullWidth />
      </ScrollView>
    );
  }

  const actions = data.actions ?? [];
  const outstanding = data.penalty?.outstandingXAF ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={<RefreshControl refreshing={violation.isRefetching} onRefresh={() => violation.refetch()} tintColor={theme.colors.primary} />}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Title>{data.title}</Title>
          <Caption tone="muted">{data.reference}</Caption>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <StatusPill status={data.status} label={violationStatusLabel(data.status, language)} />
          <RiskPill level={data.severity} label={severityLabel(data.severity, language)} />
        </View>
      </Row>

      <Row gap={8} wrap style={{ marginBottom: 14 }}>
        {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
        {data.remediationOverdue ? <Badge label="remediation overdue" tone="danger" icon="alarm-outline" /> : null}
        {data.penalty && data.penalty.settled ? <Badge label="penalty settled" tone="success" icon="checkmark-circle-outline" /> : null}
        {data.aiAlertId ? <Badge label="raised from an AI alert" tone="info" icon="sparkles-outline" /> : null}
      </Row>

      <Card style={{ marginBottom: 14 }}>
        <Body style={{ marginBottom: 10 }}>{data.description}</Body>
        <Row gap={10} wrap>
          <Badge label={`estimated damage ${formatCurrency(data.estimatedDamageXAF ?? 0, 'XAF', language)}`} tone="neutral" />
          <Badge label={`penalty ${formatCurrency(data.penaltyAmountXAF ?? 0, 'XAF', language)}`} tone="primary" />
          {outstanding > 0 ? <Badge label={`outstanding ${formatCurrency(outstanding, 'XAF', language)}`} tone="warning" /> : null}
        </Row>
      </Card>

      {actions.length > 0 && canUpdate ? (
        <Section title="Case workflow">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              These are the transitions the API exposes for this case and your role. Anything else is refused with a state-machine error.
            </Caption>
            <SelectSheet
              label="Decision"
              value={choice}
              options={actions.map((entry) => ({
                value: entry.action,
                label: ACTION_COPY[entry.action]?.label ?? entry.action.replace(/_/g, ' '),
                description: ACTION_COPY[entry.action]?.help,
              }))}
              onChange={(value) => setChoice(value)}
              placeholder="Choose what to record"
            />
            {chosen ? <Caption tone="faint" style={{ marginBottom: 8 }}>{chosen.help}</Caption> : null}

            {chosen?.requiresReason ? (
              <TextField
                label="Reason"
                required
                multiline
                value={reason}
                onChangeText={setReason}
                placeholder="Facts checked, parties heard, measurements taken…"
                error={problems.reason}
                help={`${reason.trim().length}/10 characters minimum — kept in the audit trail.`}
              />
            ) : null}

            {choice === 'CONFIRM' ? (
              <>
                <Row gap={10}>
                  <TextField label="Penalty (XAF)" keyboardType="numeric" value={penalty} onChangeText={setPenalty} style={{ flex: 1 }} suffix="XAF" />
                  <TextField label="Estimated damage (XAF)" keyboardType="numeric" value={damage} onChangeText={setDamage} style={{ flex: 1 }} suffix="XAF" />
                </Row>
                <TextField label="Remediation required" multiline value={remediation} onChangeText={setRemediation} placeholder="e.g. replant 120 stems of sapelli in the degraded block" />
                <TextField label="Remediation deadline" value={remediationDeadline} onChangeText={setRemediationDeadline} placeholder="YYYY-MM-DD" />
              </>
            ) : null}

            {failure ? (
              <View style={{ marginBottom: 10 }}>
                <Notice tone="danger" title="The API refused the action">
                  {failure}
                </Notice>
              </View>
            ) : null}

            <Button label={chosen?.label ?? 'Record the decision'} icon="checkmark-done-outline" loading={busy} disabled={!choice} onPress={() => void submit()} fullWidth />
          </Card>
        </Section>
      ) : null}

      {outstanding > 0 && hasPermission('payments:create') ? (
        <Section title="Settle the penalty">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              {formatCurrency(outstanding, 'XAF', language)} is still due on this case. Payment is initiated on the server and confirmed by the provider (
              {provider.data?.provider === 'SIMULATOR' ? 'sandbox simulator' : (provider.data?.provider ?? 'provider')}).
            </Caption>
            <Button
              label="Pay the penalty"
              icon="card-outline"
              onPress={() => router.push({ pathname: '/payment/new', params: { violationId: data.id, purpose: 'PENALTY' } })}
              fullWidth
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Record">
        <Card>
          <Definition label="Forest" value={data.forest ? `${data.forest.name} (${data.forest.code})` : '—'} />
          <Definition label="Zone" value={data.zone?.name ?? '—'} />
          <Definition label="Protected area" value={data.protectedArea?.name ?? '—'} />
          <Definition label="Company" value={data.company?.name ?? '—'} />
          <Definition label="Permit" value={data.permit?.permitNumber ?? '—'} />
          <Definition label="Activity" value={data.activity?.reference ?? '—'} />
          <Definition label="Inspection" value={data.inspection?.reference ?? '—'} />
          <Definition label="Observation" value={data.observation?.title ?? '—'} />
          <Definition label="Detected" value={formatDateTime(data.detectedAt, language)} />
          <Definition label="Detected by" value={data.detectedBy ? `${data.detectedBy.firstName} ${data.detectedBy.lastName}` : '—'} />
          <Definition label="Resolved" value={data.resolvedAt ? formatDateTime(data.resolvedAt, language) : '—'} />
          <Definition label="Resolved by" value={data.resolvedBy ? `${data.resolvedBy.firstName} ${data.resolvedBy.lastName}` : '—'} />
          <Definition label="Remediation due" value={data.remediationDeadline ? formatDate(data.remediationDeadline, language) : '—'} />
          {data.remediationRequired ? <Definition label="Remediation" value={data.remediationRequired} /> : null}
          {data.investigationNotes ? <Definition label="Investigation notes" value={data.investigationNotes} /> : null}
          {data.resolutionSummary ? <Definition label="Resolution" value={data.resolutionSummary} /> : null}
          {data.latitude && data.longitude ? <Definition label="Position" value={`${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}`} /> : null}
        </Card>
      </Section>

      <Section
        title="Evidence"
        action={
          hasPermission('inspections:evidence_upload') || canUpdate ? (
            <Pressable onPress={() => void attachPhoto()} accessibilityRole="button" accessibilityLabel="Attach evidence">
              <Caption tone="primary" style={{ fontWeight: '700' }}>
                + Add
              </Caption>
            </Pressable>
          ) : undefined
        }
      >
        {data.evidences && data.evidences.length > 0 ? (
          <Card padded={false}>
            {data.evidences.map((evidence, index) => (
              <View key={evidence.id} style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                    {evidence.title ?? evidence.fileKey}
                  </Body>
                  <Badge label={evidence.type} tone="info" compact />
                </Row>
                <Caption tone="muted">
                  {Math.max(1, Math.round(evidence.sizeBytes / 1024))} KB · {formatRelative(evidence.createdAt ?? evidence.capturedAt, language)}
                </Caption>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">No file attached to this case yet.</Caption>
          </Card>
        )}
      </Section>

      {data.payments && data.payments.length > 0 ? (
        <Section title="Penalty payments">
          <Card padded={false}>
            {data.payments.map((payment, index) => (
              <Pressable
                key={payment.id}
                onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Payment ${payment.reference}`}
                style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}
              >
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600' }}>{formatCurrency(payment.amount, payment.currency ?? 'XAF', language)}</Body>
                  <Badge label={payment.status} tone={payment.status === 'SUCCESSFUL' ? 'success' : payment.status === 'FAILED' ? 'danger' : 'warning'} />
                </Row>
                <Caption tone="muted">
                  {payment.reference} · {payment.provider} · {formatDateTime(payment.paidAt ?? payment.initiatedAt, language)}
                </Caption>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {data.companyId && linked.data?.items && linked.data.items.length > 1 ? (
        <Section title="Other cases for this company">
          <Card padded={false}>
            {linked.data.items
              .filter((entry) => entry.id !== data.id)
              .slice(0, 4)
              .map((entry, index) => (
                <Pressable
                  key={entry.id}
                  onPress={() => router.push({ pathname: '/violation/[id]', params: { id: entry.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Case ${entry.reference}`}
                  style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}
                >
                  <Row justify="space-between">
                    <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                      {entry.title}
                    </Body>
                    <Badge label={severityLabel(entry.severity, language)} tone="neutral" compact />
                  </Row>
                  <Caption tone="muted">
                    {entry.reference} · {violationStatusLabel(entry.status, language)}
                  </Caption>
                </Pressable>
              ))}
          </Card>
        </Section>
      ) : null}

      {data.status === 'CONFIRMED' || data.status === 'ESCALATED' ? (
        <View style={{ marginBottom: 12 }}>
          <Overline style={{ marginBottom: 6 }}>Closing an escalated case</Overline>
          <Caption tone="muted">
            An escalated case is closed by the authority that received it; the FEMS record keeps the decision and the date. Resolution requires the penalty to be
            settled or explicitly waived, which the API checks.
          </Caption>
        </View>
      ) : null}

      <Divider style={{ marginVertical: 12 }} />
      <Row gap={8} style={{ justifyContent: 'center' }}>
        {data.permitId ? (
          <Button
            label="Permit"
            size="sm"
            variant="ghost"
            icon="document-text-outline"
            onPress={() => router.push({ pathname: '/permit/[id]', params: { id: data.permitId ?? '' } })}
          />
        ) : null}
        {data.inspectionId ? (
          <Button
            label="Inspection"
            size="sm"
            variant="ghost"
            icon="clipboard-outline"
            onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: data.inspectionId ?? '' } })}
          />
        ) : null}
        {data.latitude && data.longitude ? (
          <Button
            label="Map"
            size="sm"
            variant="ghost"
            icon="map-outline"
            onPress={() =>
              router.push({ pathname: '/map', params: { latitude: String(data.latitude), longitude: String(data.longitude), label: data.reference } })
            }
          />
        ) : null}
      </Row>
      <Tiny tone="faint" style={{ textAlign: 'center', marginTop: 8 }}>
        Case {data.id.slice(0, 8)} · created {formatRelative(data.createdAt, language)}
      </Tiny>
    </ScrollView>
  );
}
