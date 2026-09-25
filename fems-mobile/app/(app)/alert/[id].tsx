/**
 * AI alert detail and human review.
 *
 * The screen states what the detector observed, what it does NOT claim, and the
 * actions the API will accept from this account. Confirming requires a written
 * reason and can be linked to an environmental case; dismissing and resolving
 * require their own notes, exactly as the DTO enforces.
 */
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import type { AlertAction } from '../../../src/api/types';
import { useAiStatus, useAlert, useAiCatalogue, useReviewAlert, useRunAnalysis, useViolations } from '../../../src/api/queries';
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
  ToneScope,
  useToast,
} from '../../../src/ui';
import { alertStatusLabel, alertTypeLabel, formatDateTime, formatPercent, formatRelative, riskLabel } from '../../../src/lib/format';

const ACTION_COPY: Record<string, { label: string; help: string; destructive?: boolean }> = {
  ACKNOWLEDGE: { label: 'Acknowledge', help: 'Records that an officer has picked the alert up; the clock for the review SLA keeps running.' },
  CONFIRM: { label: 'Confirm', help: 'States that the facts behind the alert were checked and hold. A written reason is required.' },
  DISMISS: { label: 'Dismiss', help: 'States that the detection does not hold. A written reason is required and is kept in the audit trail.' },
  RESOLVE: { label: 'Resolve', help: 'Closes the alert after the situation was dealt with. Describe what was actually done.' },
  REOPEN: { label: 'Reopen', help: 'Puts the alert back in the review queue when new facts appear.' },
};

export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const alert = useAlert(id ?? null);
  const catalogue = useAiCatalogue();
  const aiStatus = useAiStatus();
  const review = useReviewAlert(id ?? '');
  const runAnalysis = useRunAnalysis();
  const violations = useViolations({ status: 'CONFIRMED', limit: 25 });

  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [resolutionAction, setResolutionAction] = useState('');
  const [violationId, setViolationId] = useState<string | null>(null);
  const [requestInspection, setRequestInspection] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const data = alert.data;
  const canReview = hasPermission('ai:alerts_review');
  const reasonMinLength = catalogue.data?.reasonMinLength ?? 10;

  const problems: Record<string, string> = {
    ...serverFields,
    ...(action && ['CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'].includes(action) && reason.trim().length < reasonMinLength
      ? { reason: `A written reason of at least ${reasonMinLength} characters is required.` }
      : {}),
    ...(action === 'RESOLVE' && resolutionAction.trim().length < reasonMinLength ? { resolutionAction: 'Describe what was done to close the alert.' } : {}),
    ...(action === 'CONFIRM' && evidenceNote.trim().length > 0 && evidenceNote.trim().length < reasonMinLength
      ? { evidenceNote: `Evidence notes must be at least ${reasonMinLength} characters when provided.` }
      : {}),
  };

  const submit = async () => {
    if (!action) return;
    setFailure(null);
    setServerFields({});
    if (Object.keys(problems).length > 0) {
      setFailure('The review was refused by the app before reaching the API: ' + Object.values(problems)[0]);
      return;
    }
    setBusy(true);
    try {
      await review.mutateAsync({
        action,
        reason: reason.trim() || undefined,
        evidenceNote: evidenceNote.trim() || undefined,
        resolutionAction: resolutionAction.trim() || undefined,
        violationId: violationId ?? undefined,
        requestInspection: requestInspection || undefined,
      });
      toast.success('Review recorded', `${ACTION_COPY[action]?.label ?? action} by ${user?.firstName ?? 'you'}.`);
      setAction(null);
      setReason('');
      setEvidenceNote('');
      setResolutionAction('');
      setViolationId(null);
      setRequestInspection(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The review could not be recorded.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (alert.isLoading) {
    return (
      <ToneScope tone="dark">
        <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
          <SkeletonDetail />
        </ScrollView>
      </ToneScope>
    );
  }

  if (alert.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={alert.error} onRetry={() => alert.refetch()} />
        <Button label="Back to the console" variant="secondary" onPress={() => router.replace('/alerts')} fullWidth />
      </ScrollView>
    );
  }

  const catalogueByAction = new Map((catalogue.data?.alertActions ?? []).map((entry) => [entry.action as AlertAction, entry]));
  const availableActions = (data.actions ?? []).map((code) => ({
    action: code as AlertAction,
    label: ACTION_COPY[code]?.label ?? code,
    description: ACTION_COPY[code]?.help,
    reasonRequired: catalogueByAction.get(code as AlertAction)?.reasonRequired ?? ['CONFIRM', 'DISMISS', 'RESOLVE', 'REOPEN'].includes(code),
  }));

  return (
    <ToneScope tone="dark">
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={<RefreshControl refreshing={alert.isRefetching} onRefresh={() => alert.refetch()} tintColor={theme.colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
          <Caption tone="primary" style={{ fontWeight: '700' }}>
            ‹ Back
          </Caption>
        </Pressable>

        <Row justify="space-between" align="flex-start" style={{ marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Overline style={{ marginBottom: 4 }}>{alertTypeLabel(data.type, language)}</Overline>
            <Title>{data.title}</Title>
            <Caption tone="muted">{data.reference}</Caption>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <StatusPill status={data.status} label={alertStatusLabel(data.status, language)} />
            <RiskPill level={data.riskLevel} label={riskLabel(data.riskLevel, language)} />
          </View>
        </Row>

        <Row gap={8} wrap style={{ marginBottom: 14 }}>
          <Badge label={data.detector} tone="primary" icon="hardware-chip-outline" />
          {data.confidence !== undefined && data.confidence !== null ? (
            <Badge label={`confidence ${formatPercent(Number(data.confidence) * 100)}`} tone="neutral" />
          ) : null}
          {data.review?.overdue ? (
            <Badge label={`review overdue (SLA ${aiStatus.data?.capabilities.alertReviewSlaHours ?? 72}h)`} tone="danger" icon="alarm-outline" />
          ) : null}
          {data.review?.requiresHumanDecision ? <Badge label="human decision required" tone="warning" /> : null}
          {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
        </Row>

        <Card style={{ marginBottom: 14 }}>
          <Overline style={{ marginBottom: 6 }}>What the detector saw</Overline>
          <Body style={{ marginBottom: 10 }}>{data.description}</Body>
          {data.reasoning ? (
            <>
              <Overline style={{ marginBottom: 6 }}>Reasoning</Overline>
              <Caption tone="muted" style={{ marginBottom: 10 }}>
                {data.reasoning}
              </Caption>
            </>
          ) : null}
          {data.guardrails && data.guardrails.length > 0 ? (
            <>
              <Overline style={{ marginBottom: 6 }}>Guardrails applied by the API</Overline>
              {data.guardrails.map((line) => (
                <Row key={line} gap={8} style={{ marginBottom: 4 }}>
                  <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.primary} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    {line}
                  </Caption>
                </Row>
              ))}
            </>
          ) : null}
          <View style={{ marginTop: 12 }}>
            <Notice tone="info" title="Advisory only">
              This alert is a statistical signal, not a finding. FEMS never records a person or a company as illegally exploiting the forest because of a model:
              the review below is what gives it any legal weight.
            </Notice>
          </View>
        </Card>

        {canReview ? (
          <Section title="Human review">
            <Card>
              <Caption tone="muted" style={{ marginBottom: 10 }}>
                {data.review?.isClosed
                  ? `This alert is closed (status ${data.status}, ${data.review?.isClosed ? 'no further review required' : ''}). Reopening it puts it back in the queue of the officers responsible.`
                  : 'Every action below is recorded with your account, the timestamp and the reason you give.'}
              </Caption>
              <SelectSheet
                label="Decision"
                value={action}
                options={availableActions.map((entry) => ({
                  value: entry.action,
                  label: entry.label,
                  description: entry.description,
                }))}
                onChange={(value) => setAction(value)}
                placeholder={availableActions.length ? 'Choose what to record' : 'No decision available for this alert'}
              />
              {action ? <Caption tone="faint" style={{ marginBottom: 8 }}>{ACTION_COPY[action]?.help}</Caption> : null}

              {action === 'CONFIRM' || action === 'DISMISS' || action === 'RESOLVE' || action === 'REOPEN' ? (
                <TextField
                  label="Reason"
                  required
                  multiline
                  value={reason}
                  onChangeText={setReason}
                  placeholder={
                    action === 'CONFIRM'
                      ? 'What was checked, with whom, and what confirms the signal'
                      : action === 'DISMISS'
                        ? 'Why the detection does not hold (e.g. the volume was declared in a revision already approved)'
                        : 'Why the alert is being reopened or resolved'
                  }
                  error={problems.reason}
                  help={`${reason.trim().length} / ${reasonMinLength} characters minimum — stored in the audit trail.`}
                />
              ) : null}

              {action === 'CONFIRM' ? (
                <>
                  <TextField
                    label="Evidence note"
                    multiline
                    value={evidenceNote}
                    onChangeText={setEvidenceNote}
                    placeholder="Documents, photographs or field findings that support the confirmation"
                    error={problems.evidenceNote}
                  />
                  <SelectSheet
                    label="Link to an environmental case"
                    value={violationId}
                    options={(violations.data?.items ?? []).map((entry) => ({
                      value: entry.id,
                      label: `${entry.reference} — ${entry.title}`,
                      description: `${entry.severity} · ${entry.forest?.name ?? ''}`,
                    }))}
                    onChange={setViolationId}
                    placeholder="Optional — attach this alert to a confirmed case"
                  />
                  <Row gap={8} style={{ marginTop: 4, marginBottom: 8 }}>
                    <Button
                      label={requestInspection ? 'Field verification requested' : 'Request field verification'}
                      size="sm"
                      variant={requestInspection ? 'primary' : 'secondary'}
                      icon={requestInspection ? 'checkmark-circle-outline' : 'walk-outline'}
                      onPress={() => setRequestInspection((current) => !current)}
                    />
                  </Row>
                </>
              ) : null}

              {action === 'RESOLVE' ? (
                <TextField
                  label="What was done"
                  required
                  multiline
                  value={resolutionAction}
                  onChangeText={setResolutionAction}
                  placeholder="e.g. the missing volume was declared and the royalty regularised with the treasury"
                  error={problems.resolutionAction}
                />
              ) : null}

              {failure ? (
                <View style={{ marginBottom: 10 }}>
                  <Notice tone="danger" title="Review refused">
                    {failure}
                  </Notice>
                </View>
              ) : null}

              <Button label="Record the review" icon="shield-checkmark-outline" loading={busy} disabled={!action} onPress={() => void submit()} fullWidth />
            </Card>
          </Section>
        ) : (
          <Section title="Human review">
            <Card>
              <Caption tone="muted">
                Your account does not hold `ai:alerts_review`, so the decisions are read-only here. An officer of the forest service or the environment ministry
                records them.
              </Caption>
              {data.reviewedAt ? (
                <View style={{ marginTop: 10 }}>
                  <Definition label="Last decision" value={`${data.status} by ${data.reviewedBy ? `${data.reviewedBy.firstName} ${data.reviewedBy.lastName}` : '—'}`} />
                  <Definition label="Recorded" value={formatDateTime(data.reviewedAt, language)} />
                  {data.reviewNotes ? <Definition label="Notes" value={data.reviewNotes} /> : null}
                </View>
              ) : null}
            </Card>
          </Section>
        )}

        <Section title="Record">
          <Card>
            <Definition label="Forest" value={data.forest?.name ?? '—'} />
            <Definition label="Company" value={data.company?.name ?? '—'} />
            <Definition label="Permit" value={data.permit?.permitNumber ?? '—'} />
            <Definition label="Activity" value={data.activity?.reference ?? '—'} />
            <Definition label="Case" value={data.violation ? `${data.violation.reference} (${data.violation.status})` : '—'} />
            <Definition label="Detected" value={formatDateTime(data.detectedAt, language)} />
            <Definition label="Reviewed" value={data.reviewedAt ? formatDateTime(data.reviewedAt, language) : 'not yet'} />
            <Definition label="Resolved" value={data.resolvedAt ? formatDateTime(data.resolvedAt, language) : '—'} />
            <Definition
              label="Analysis"
              value={data.analysis ? `${data.analysis.type} · ${data.analysis.provider} · ${data.analysis.status}` : '—'}
            />
            {data.latitude && data.longitude ? (
              <Definition label="Position" value={`${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}`} />
            ) : null}
          </Card>
        </Section>

        {data.relatedAlerts && data.relatedAlerts.length > 0 ? (
          <Section title="Related signals">
            <Card padded={false}>
              {data.relatedAlerts.map((related, index) => (
                <Pressable
                  key={related.id}
                  onPress={() => router.push({ pathname: '/alert/[id]', params: { id: related.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Related alert ${related.reference}`}
                  style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}
                >
                  <Row justify="space-between">
                    <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                      {related.title}
                    </Body>
                    <Badge label={alertStatusLabel(related.status, language)} tone="neutral" compact />
                  </Row>
                  <Caption tone="muted">
                    {related.reference} · {riskLabel(related.riskLevel, language)}
                  </Caption>
                </Pressable>
              ))}
            </Card>
          </Section>
        ) : null}

        {data.analysis?.id ? (
          <View style={{ marginBottom: 12 }}>
            <Button
              label="Re-run the analysis for this scope"
              variant="secondary"
              icon="pulse-outline"
              loading={runAnalysis.isPending}
              onPress={() =>
                void runAnalysis
                  .mutateAsync({ type: data.analysis?.type ?? 'RISK_ASSESSMENT', forestId: data.forestId ?? undefined, permitId: data.permitId ?? undefined })
                  .then(() => toast.success('Analysis re-run', 'The engine produced a fresh set of findings for the same scope.'))
                  .catch((error) => toast.error('Analysis refused', error instanceof ApiError ? error.message : undefined))
              }
              fullWidth
            />
          </View>
        ) : null}

        <Divider style={{ marginVertical: 12 }} />
        <Row gap={8} style={{ marginBottom: 12 }}>
          {data.forestId ? (
            <Button label="See on the map" size="sm" variant="ghost" icon="map-outline" onPress={() => router.push({ pathname: '/map', params: { forestId: data.forestId ?? '' } })} />
          ) : null}
          {data.permitId ? (
            <Button
              label="Open the permit"
              size="sm"
              variant="ghost"
              icon="document-text-outline"
              onPress={() => router.push({ pathname: '/permit/[id]', params: { id: data.permitId ?? '' } })}
            />
          ) : null}
          {data.violationId ? (
            <Button
              label="Open the case"
              size="sm"
              variant="ghost"
              icon="warning-outline"
              onPress={() => router.push({ pathname: '/violation/[id]', params: { id: data.violationId ?? '' } })}
            />
          ) : null}
        </Row>
        <Tiny tone="faint" style={{ textAlign: 'center' }}>
          Alert {data.id.slice(0, 8)} · detected {formatRelative(data.detectedAt, language)} · engine {catalogue.data?.detectorVersion ?? 'fems-rules'} · review SLA{' '}
          {aiStatus.data?.capabilities.alertReviewSlaHours ?? 72} h
        </Tiny>
      </ScrollView>
    </ToneScope>
  );
}
