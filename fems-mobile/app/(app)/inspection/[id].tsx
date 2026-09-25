/**
 * Inspection detail and field execution.
 *
 * The screen walks the real inspection workflow: start (device GPS captured into
 * the record), fill the checklist, attach photographic evidence, submit with an
 * outcome and the verified volumes, then — for reviewers — review and close. The
 * API decides which of those steps are legal: the buttons shown come from the
 * permission set and the record's status, and every action is validated again on
 * the server (including the rule that a visit cannot close while the cases it
 * opened are still open).
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useAttachEvidence,
  useCancelInspection,
  useCloseInspection,
  useInspection,
  useReviewInspection,
  useStartInspection,
  useSubmitInspection,
  useUploadFile,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useDevicePosition, accuracyBand } from '../../../src/hooks/useDevicePosition';
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
  ScoreRing,
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
import {
  checklistResultLabel,
  formatDateTime,
  formatRelative,
  inspectionOutcomeLabel,
  inspectionStatusLabel,
  inspectionTypeLabel,
} from '../../../src/lib/format';

const OUTCOMES = [
  { value: 'COMPLIANT', label: 'Compliant', description: 'Every checked requirement was met' },
  { value: 'MINOR_NON_COMPLIANCE', label: 'Minor non-compliance', description: 'Correctable on site' },
  { value: 'MAJOR_NON_COMPLIANCE', label: 'Major non-compliance', description: 'Requires follow-up action' },
  { value: 'CRITICAL_NON_COMPLIANCE', label: 'Critical non-compliance', description: 'Stop-work level finding' },
] as const;

const CHECKLIST_RESULTS = [
  { value: 'PASS', label: 'Pass' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
] as const;

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const position = useDevicePosition();

  const inspection = useInspection(id ?? null);
  const start = useStartInspection(id ?? '');
  const submit = useSubmitInspection(id ?? '');
  const review = useReviewInspection(id ?? '');
  const close = useCloseInspection(id ?? '');
  const cancel = useCancelInspection(id ?? '');
  const upload = useUploadFile();
  const attachEvidence = useAttachEvidence({ inspectionId: id });

  const [checklist, setChecklist] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['value'] | null>(null);
  const [summary, setSummary] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [verifiedVolume, setVerifiedVolume] = useState('');
  const [verifiedTrees, setVerifiedTrees] = useState('');
  const [discrepancies, setDiscrepancies] = useState('');
  const [busy, setBusy] = useState(false);

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const data = inspection.data;

  const effectiveChecklist = useMemo(() => {
    if (!data?.checklist) return [];
    return data.checklist.map((item) => ({
      ...item,
      result: (checklist[item.id ?? item.code] as (typeof CHECKLIST_RESULTS)[number]['value']) ?? item.result,
      notes: notes[item.id ?? item.code] ?? item.notes ?? '',
    }));
  }, [data?.checklist, checklist, notes]);

  const canStart = hasPermission('inspections:submit') && data?.status === 'SCHEDULED';
  const canSubmit = hasPermission('inspections:submit') && (data?.status === 'IN_PROGRESS' || data?.status === 'SCHEDULED');
  const canReview = hasPermission('inspections:review') && data?.status === 'SUBMITTED';
  const canClose = hasPermission('inspections:close') && data?.status === 'REVIEWED';
  const canCancel = hasPermission('inspections:update') && data && ['SCHEDULED', 'IN_PROGRESS'].includes(data.status);

  const doStart = async () => {
    setBusy(true);
    try {
      const fix = position.fix ?? (await position.refresh());
      if (!fix) {
        toast.error('No GPS fix', position.error?.message ?? 'The device could not provide a position.');
        return;
      }
      await start.mutateAsync({
        latitude: fix.latitude,
        longitude: fix.longitude,
        locationAccuracyM: fix.accuracyM ?? undefined,
        gpsSource: fix.source,
        gpsCapturedAt: fix.capturedAt,
      });
      toast.success('Inspection started', `Position recorded (±${fix.accuracyM ? Math.round(fix.accuracyM) : '—'} m).`);
    } catch (error) {
      toast.error('Could not start', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!outcome) {
      toast.error('Choose an outcome', 'The inspection cannot be submitted without a compliance outcome.');
      return;
    }
    setBusy(true);
    try {
      await submit.mutateAsync({
        outcome,
        summary: summary.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
        checklist: effectiveChecklist.map((item, index) => ({
          code: item.code,
          label: item.label,
          result: item.result,
          notes: (item.notes ?? '').trim() || undefined,
          sortOrder: item.sortOrder ?? index,
        })),
        verifiedHarvestedVolumeM3: verifiedVolume ? Number(verifiedVolume) : undefined,
        verifiedTreeCount: verifiedTrees ? Number(verifiedTrees) : undefined,
        discrepancies: discrepancies.trim() || undefined,
      });
      toast.success('Inspection submitted', 'It is now with the reviewer.');
    } catch (error) {
      const detail = error instanceof ApiError ? Object.values(fieldErrors(error))[0] : undefined;
      toast.error('Submission refused', detail ?? (error instanceof ApiError ? error.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  const attachPhoto = async () => {
    setBusy(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
          : await ImagePicker.launchCameraAsync({ quality: 0.8 });
      const picked = result.canceled ? await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: Platform.OS === 'web' }) : result;
      if (picked.canceled || !picked.assets?.length) {
        setBusy(false);
        return;
      }
      const asset = picked.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `inspection-evidence-${Date.now()}.jpg`;
      const uri = asset.base64 && Platform.OS === 'web' ? `data:${mimeType};base64,${asset.base64}` : asset.uri;

      const stored = await upload.mutateAsync({ file: { uri, name, mimeType }, folder: 'inspections/evidence' });
      const fix = position.fix ?? null;
      await attachEvidence.mutateAsync({
        type: 'PHOTO',
        source: Platform.OS === 'web' ? 'UPLOAD' : 'DEVICE_CAMERA',
        fileKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        title: `Evidence ${new Date().toLocaleTimeString()}`,
        caption: summary.trim() || undefined,
        inspectionId: id,
        latitude: fix?.latitude,
        longitude: fix?.longitude,
        locationAccuracyM: fix?.accuracyM ?? undefined,
        gpsSource: fix?.source,
        capturedAt: fix?.capturedAt ?? new Date().toISOString(),
      });
      toast.success('Evidence attached', 'The photo is stored with its position and inspector.');
    } catch (error) {
      toast.error('Evidence failed', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (inspection.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
          <SkeletonDetail />
        </ScrollView>
      </View>
    );
  }

  if (inspection.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={inspection.error} onRetry={() => inspection.refetch()} />
      </ScrollView>
    );
  }

  const band = accuracyBand(position.accuracyM ?? (data.locationAccuracyM ? Number(data.locationAccuracyM) : null));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={
        <RefreshControl refreshing={inspection.isRefetching} onRefresh={() => inspection.refetch()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
      }
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Row gap={6}>
            <Body style={{ fontWeight: '800', fontSize: 17 }}>{data.reference}</Body>
            {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
          <Title>{data.title}</Title>
        </View>
        <StatusPill status={data.status} label={inspectionStatusLabel(data.status, language)} />
      </Row>

      <Row gap={12} style={{ marginBottom: 14 }}>
        <ScoreRing value={data.complianceScore ?? null} label="compliance" />
        <View style={{ flex: 1, gap: 4 }}>
          <Badge label={inspectionTypeLabel(data.type, language)} tone="primary" />
          {data.outcome ? <Badge label={inspectionOutcomeLabel(data.outcome, language)} tone={data.outcome === 'COMPLIANT' ? 'success' : 'warning'} /> : null}
          <Caption tone="muted">
            {data.inspector ? `Inspector: ${data.inspector.firstName} ${data.inspector.lastName}` : 'Not yet assigned'}
          </Caption>
          <Caption tone="muted">{data.forest ? `${data.forest.name} (${data.forest.code})` : '—'}</Caption>
        </View>
      </Row>

      {canStart ? (
        <ToneScope tone="dark">
          <Card style={{ marginBottom: 16 }}>
            <Overline style={{ marginBottom: 6 }}>Field capture</Overline>
            <Heading style={{ marginBottom: 6 }}>Start the inspection on site</Heading>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              The API records the device position with this visit, so the distance from the target area can be checked later.
            </Caption>
            <Row gap={10} style={{ marginBottom: 10 }}>
              <Badge
                label={position.fix ? `${position.fix.latitude.toFixed(5)}, ${position.fix.longitude.toFixed(5)}` : 'No fix yet'}
                tone={position.fix ? 'success' : 'warning'}
                icon="location-outline"
              />
              <Badge label={band.label} tone={band.tone === 'good' ? 'success' : band.tone === 'fair' ? 'warning' : 'danger'} />
              {position.fix?.mocked ? <Badge label="simulated fix" tone="danger" /> : null}
            </Row>
            {position.error ? (
              <View style={{ marginBottom: 10 }}>
                <Notice tone="danger" title="Location unavailable">
                  {position.error.message}
                </Notice>
              </View>
            ) : null}
            <Row gap={8}>
              <Button label="Get position" variant="secondary" icon="navigate-outline" loading={position.loading} onPress={() => void position.refresh()} />
              <Button label="Start inspection" icon="play-outline" loading={busy} disabled={!position.fix} onPress={() => void doStart()} />
            </Row>
          </Card>
        </ToneScope>
      ) : null}

      {data.status === 'IN_PROGRESS' || data.status === 'SUBMITTED' ? (
        <Card style={{ marginBottom: 16 }}>
          <Overline style={{ marginBottom: 8 }}>Field data recorded</Overline>
          <Definition label="Position" value={data.latitude && data.longitude ? `${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}` : '—'} />
          <Definition label="Accuracy" value={data.locationAccuracyM ? `±${Math.round(Number(data.locationAccuracyM))} m` : '—'} />
          <Definition label="GPS source" value={data.gpsSource === 'DEVICE_GPS' ? 'Device GPS' : (data.gpsSource ?? '—')} />
          <Definition label="Distance from target" value={data.distanceFromTargetM ? `${Math.round(Number(data.distanceFromTargetM))} m` : '—'} />
          <Definition label="Started" value={data.startedAt ? formatDateTime(data.startedAt, language) : '—'} />
          <Definition label="Submitted" value={data.submittedAt ? formatDateTime(data.submittedAt, language) : '—'} />
        </Card>
      ) : null}

      <Section
        title="Checklist"
        action={
          <Pressable onPress={() => void attachPhoto()} accessibilityRole="button" accessibilityLabel="Attach photographic evidence">
            <Caption tone="primary" style={{ fontWeight: '700' }}>
              + Evidence
            </Caption>
          </Pressable>
        }
      >
        <Card>
          {effectiveChecklist.length === 0 ? (
            <Caption tone="muted">This inspection has no checklist items. The API creates them from the template used at scheduling.</Caption>
          ) : (
            effectiveChecklist.map((item, index) => {
              const editable = canSubmit;
              return (
                <View key={item.code} style={{ marginBottom: index === effectiveChecklist.length - 1 ? 0 : 14 }}>
                  <Row justify="space-between" style={{ marginBottom: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: '600' }}>{item.label}</Body>
                      <Tiny tone="faint">{item.code}</Tiny>
                    </View>
                    <Badge
                      label={checklistResultLabel(item.result, language)}
                      tone={item.result === 'PASS' ? 'success' : item.result === 'FAIL' ? 'danger' : 'neutral'}
                    />
                  </Row>
                  {editable ? (
                    <>
                      <Row gap={8} style={{ marginBottom: notes[item.id ?? item.code] !== undefined ? 8 : 0 }}>
                        {CHECKLIST_RESULTS.map((option) => (
                          <Pressable
                            key={option.value}
                            onPress={() => setChecklist((current) => ({ ...current, [item.id ?? item.code]: option.value }))}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: item.result === option.value }}
                            accessibilityLabel={`${item.label}: ${option.label}`}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 12,
                              borderRadius: theme.radii.pill,
                              borderWidth: StyleSheet.hairlineWidth * 2,
                              borderColor: item.result === option.value ? theme.colors.primary : theme.colors.border,
                              backgroundColor: item.result === option.value ? theme.colors.primarySoft : theme.colors.surface,
                            }}
                          >
                            <Tiny style={{ color: item.result === option.value ? theme.colors.primary : theme.colors.textMuted, fontWeight: '600' }}>
                              {option.label}
                            </Tiny>
                          </Pressable>
                        ))}
                      </Row>
                      {item.result === 'FAIL' ? (
                        <TextField
                          label="What was found"
                          value={notes[item.id ?? item.code] ?? ''}
                          onChangeText={(text) => setNotes((current) => ({ ...current, [item.id ?? item.code]: text }))}
                          placeholder="Describe the non-compliance precisely — this text goes into the report"
                          multiline
                        />
                      ) : null}
                    </>
                  ) : item.notes ? (
                    <Caption tone="muted">{item.notes}</Caption>
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
      </Section>

      {canSubmit ? (
        <Section title="Submit the visit">
          <Card>
            <SelectSheet
              label="Outcome"
              required
              value={outcome}
              options={OUTCOMES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
              onChange={setOutcome}
            />
            <TextField label="Summary" multiline value={summary} onChangeText={setSummary} placeholder="What the visit established" />
            <TextField label="Recommendations" multiline value={recommendations} onChangeText={setRecommendations} placeholder="Corrective actions requested from the operator" />
            <Row gap={10}>
              <TextField
                label="Verified volume (m³)"
                keyboardType="numeric"
                value={verifiedVolume}
                onChangeText={setVerifiedVolume}
                style={{ flex: 1 }}
                help="Counter-check of the declared harvest"
              />
              <TextField label="Verified trees" keyboardType="numeric" value={verifiedTrees} onChangeText={setVerifiedTrees} style={{ flex: 1 }} />
            </Row>
            <TextField label="Discrepancies" multiline value={discrepancies} onChangeText={setDiscrepancies} placeholder="Differences between the register and what was found on site" />
            <Button label="Submit inspection" icon="send-outline" loading={busy} onPress={() => void doSubmit()} fullWidth />
          </Card>
        </Section>
      ) : null}

      {canReview ? (
        <Section title="Review">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              Reviewing confirms the checklist and your agreement (or adjustment) of the outcome. The API computes the compliance score from the checklist.
            </Caption>
            <Row gap={8} wrap>
              {['COMPLIANT', 'MINOR_NON_COMPLIANCE', 'MAJOR_NON_COMPLIANCE'].map((value) => (
                <Button
                  key={value}
                  label={`Confirm ${inspectionOutcomeLabel(value as never, language)}`}
                  size="sm"
                  variant="secondary"
                  loading={review.isPending}
                  onPress={() =>
                    void review
                      .mutateAsync({ outcome: value, notes: summary.trim() || undefined })
                      .then(() => toast.success('Inspection reviewed'))
                      .catch((error) => toast.error('Review refused', error instanceof ApiError ? error.message : undefined))
                  }
                />
              ))}
            </Row>
          </Card>
        </Section>
      ) : null}

      {canClose ? (
        <Section title="Close the case">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              Closing is refused while a case opened by this inspection is still open — resolve or dismiss them from the case register first.
            </Caption>
            <Button
              label="Close inspection"
              icon="checkmark-done-outline"
              loading={close.isPending}
              onPress={() =>
                void close
                  .mutateAsync({})
                  .then(() => toast.success('Inspection closed'))
                  .catch((error) => toast.error('Close refused', error instanceof ApiError ? error.message : undefined))
              }
              fullWidth
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Evidence">
        {data.evidences && data.evidences.length > 0 ? (
          <Card padded={false}>
            {data.evidences.map((evidence, index) => (
              <View key={evidence.id} style={{ padding: 14, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                    {evidence.title ?? evidence.fileKey}
                  </Body>
                  <Badge label={evidence.type} tone="info" />
                </Row>
                <Caption tone="muted">
                  {evidence.source ? `${evidence.source} · ` : ''}
                  {Math.max(1, Math.round(evidence.sizeBytes / 1024))} KB
                  {evidence.latitude ? ` · ${Number(evidence.latitude).toFixed(5)}, ${Number(evidence.longitude).toFixed(5)}` : ''}
                </Caption>
                {evidence.caption ? <Caption tone="faint">{evidence.caption}</Caption> : null}
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">
              No evidence attached. Photographs taken from here are stored by the backend with their position, the inspector and the capture time.
            </Caption>
          </Card>
        )}
        <View style={{ marginTop: 10 }}>
          <Button label="Take a photo" icon="camera-outline" variant="secondary" loading={busy} onPress={() => void attachPhoto()} />
        </View>
      </Section>

      <Section title="Record">
        <Card>
          <Definition label="Forest" value={data.forest ? `${data.forest.name} (${data.forest.code})` : '—'} />
          <Definition label="Zone" value={data.zone?.name ?? '—'} />
          <Definition label="Protected area" value={data.protectedArea?.name ?? '—'} />
          <Definition label="Company" value={data.company?.name ?? '—'} />
          <Definition label="Permit" value={data.permit?.permitNumber ?? '—'} />
          <Definition label="Activity" value={data.activity?.reference ?? '—'} />
          <Definition label="Scheduled for" value={data.scheduledFor ? formatDateTime(data.scheduledFor, language) : '—'} />
          <Definition label="Reviewed" value={data.reviewedAt ? formatDateTime(data.reviewedAt, language) : '—'} />
        </Card>
      </Section>

      {canCancel ? (
        <Section title="Cancel">
          <Card>
            <Caption tone="muted" style={{ marginBottom: 10 }}>
              Cancelling records the reason in the inspection history; the visit stops counting towards coverage.
            </Caption>
            <Button
              label="Cancel inspection"
              variant="danger"
              icon="close-circle-outline"
              loading={cancel.isPending}
              onPress={() =>
                void cancel
                  .mutateAsync('Cancelled from the mobile app — the field visit could not be carried out.')
                  .then(() => toast.info('Inspection cancelled'))
                  .catch((error) => toast.error('Cancel refused', error instanceof ApiError ? error.message : undefined))
              }
            />
          </Card>
        </Section>
      ) : null}

      <Caption tone="faint" style={{ textAlign: 'center' }}>
        {data._count ? `${data._count.evidences ?? 0} evidence · ${data._count.violations ?? 0} cases · ` : ''}record created{' '}
        {formatRelative(data.createdAt ?? new Date().toISOString(), language)}
      </Caption>
      <Divider style={{ marginTop: 12 }} />
      <Tiny tone="faint" style={{ textAlign: 'center', marginTop: 8 }}>
        AI assistance is advisory: the outcome recorded here is the reviewer's decision, not a model's.
      </Tiny>
    </ScrollView>
  );
}
