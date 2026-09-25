/**
 * Observation detail.
 *
 * Renders one observation with its exact position, the reporter and any evidence.
 * Owners and reviewers may edit the classification or delete the record; the API
 * authorises both.
 */
import React, { useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../src/api/client';
import { useAttachEvidence, useDeleteObservation, useObservation, useUpdateObservation, useUploadFile } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useDevicePosition } from '../../../src/hooks/useDevicePosition';
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
  TextField,
  Tiny,
  Title,
  useConfirm,
  useToast,
} from '../../../src/ui';
import { formatDateTime, formatRelative, observationCategoryLabel, severityLabel } from '../../../src/lib/format';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const CATEGORIES = [
  'TREE_CONDITION',
  'WILDLIFE',
  'VEGETATION_COVER',
  'SOIL',
  'WATER_BODY',
  'ENCROACHMENT',
  'ILLEGAL_LOGGING',
  'INFRASTRUCTURE',
  'FIRE_DAMAGE',
  'WEATHER',
  'INCIDENT',
  'OTHER',
] as const;

export default function ObservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const position = useDevicePosition();
  const { user, hasPermission } = useAuth();

  const observation = useObservation(id ?? null);
  const update = useUpdateObservation(id ?? '');
  const remove = useDeleteObservation();
  const upload = useUploadFile();
  const attachEvidence = useAttachEvidence({ observationId: id });

  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const data = observation.data;
  const canEdit = hasPermission('observations:update');
  const canDelete = hasPermission('observations:delete');

  const beginEdit = () => {
    if (!data) return;
    setCategory(data.category);
    setSeverity(data.severity ?? 'LOW');
    setTitle(data.title);
    setDescription(data.description);
    setEditing(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await update.mutateAsync({ category, severity, title: title.trim(), description: description.trim() });
      toast.success('Observation updated', 'The revision is recorded with your account.');
      setEditing(false);
    } catch (error) {
      toast.error('Update refused', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const attachPhoto = async () => {
    setBusy(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true })
          : await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.length) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `observation-${Date.now()}.jpg`;
      const stored = await upload.mutateAsync({
        file: { uri: asset.uri, name, mimeType },
        folder: 'observations/captures',
      });
      await attachEvidence.mutateAsync({
        type: 'PHOTO',
        source: Platform.OS === 'web' ? 'UPLOAD' : 'DEVICE_CAMERA',
        fileKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        title: `Observation photo ${new Date().toLocaleTimeString()}`,
        observationId: id,
        latitude: data?.latitude,
        longitude: data?.longitude,
        capturedAt: new Date().toISOString(),
      });
      toast.success('Photo attached');
    } catch (error) {
      toast.error('Upload failed', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (observation.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <SkeletonDetail />
      </ScrollView>
    );
  }

  if (observation.isError || !data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <ErrorState error={observation.error} onRetry={() => observation.refetch()} />
        <Button label="Back to the register" variant="secondary" onPress={() => router.replace('/observation')} fullWidth />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      refreshControl={<RefreshControl refreshing={observation.isRefetching} onRefresh={() => observation.refetch()} tintColor={theme.colors.primary} />}
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
        <Caption tone="primary" style={{ fontWeight: '700' }}>
          ‹ Back
        </Caption>
      </Pressable>

      <Row justify="space-between" align="flex-start" style={{ marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Overline style={{ marginBottom: 4 }}>{observationCategoryLabel(data.category, language)}</Overline>
          <Title>{data.title}</Title>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {data.severity ? <RiskPill level={data.severity} label={severityLabel(data.severity, language)} /> : <Badge label="unrated" tone="neutral" />}
          {data.isDemo ? <Badge label="DEMO DATA" tone="info" compact /> : null}
        </View>
      </Row>

      <Row gap={8} wrap style={{ marginBottom: 14 }}>
        <Badge label={`${Number(data.latitude).toFixed(6)}, ${Number(data.longitude).toFixed(6)}`} tone="primary" icon="location-outline" />
        {data.locationAccuracyM ? <Badge label={`±${Math.round(Number(data.locationAccuracyM))} m`} tone="neutral" /> : null}
        <Badge label={data.gpsSource === 'DEVICE_GPS' ? 'device GPS' : (data.gpsSource ?? 'source unknown')} tone={data.gpsSource === 'DEVICE_GPS' ? 'success' : 'warning'} />
        {data.syncStatus && data.syncStatus !== 'SYNCED' ? <Badge label={`sync: ${data.syncStatus}`} tone="warning" /> : null}
        {data.aiProcessedAt ? <Badge label="AI analysed" tone="info" icon="sparkles-outline" /> : null}
      </Row>

      {editing ? (
        <Card style={{ marginBottom: 16 }}>
          <Overline style={{ marginBottom: 10 }}>Revise the record</Overline>
          <SelectSheet
            label="Category"
            value={category}
            options={CATEGORIES.map((entry) => ({ value: entry, label: observationCategoryLabel(entry, language) }))}
            onChange={setCategory}
          />
          <SelectSheet
            label="Severity"
            value={severity}
            options={SEVERITIES.map((entry) => ({ value: entry, label: severityLabel(entry, language) }))}
            onChange={setSeverity}
          />
          <TextField label="Title" value={title} onChangeText={setTitle} />
          <TextField label="Description" multiline value={description} onChangeText={setDescription} />
          <Row gap={8}>
            <Button label="Save revision" icon="checkmark-outline" loading={busy} onPress={() => void saveEdit()} />
            <Button label="Discard" variant="ghost" onPress={() => setEditing(false)} />
          </Row>
        </Card>
      ) : (
        <Card style={{ marginBottom: 16 }}>
          <Body style={{ marginBottom: 12 }}>{data.description}</Body>
          <Row gap={8} wrap>
            {canEdit ? <Button label="Revise" size="sm" variant="secondary" icon="create-outline" onPress={beginEdit} /> : null}
            {(hasPermission('observations:create') || canEdit) && (
              <Button label="Attach photo" size="sm" variant="secondary" icon="camera-outline" loading={busy} onPress={() => void attachPhoto()} />
            )}
            {hasPermission('ai:analysis_run') || hasPermission('ai:alerts_review') ? (
              <Button
                label="Analyse"
                size="sm"
                variant="ghost"
                icon="sparkles-outline"
                onPress={() => router.push({ pathname: '/assistant', params: { prompt: `Assess this field observation: ${data.title}` } })}
              />
            ) : null}
          </Row>
        </Card>
      )}

      <Section title="Record">
        <Card>
          <Definition label="Forest" value={data.forest ? `${data.forest.name} (${data.forest.code})` : '—'} />
          <Definition label="Zone" value={data.zone?.name ?? '—'} />
          <Definition label="Protected area" value={data.protectedArea?.name ?? '—'} />
          <Definition label="Activity" value={data.activityId ? String(data.activityId).slice(0, 8) : '—'} />
          <Definition label="Inspection" value={data.inspectionId ? String(data.inspectionId).slice(0, 8) : '—'} />
          <Definition label="Observed" value={formatDateTime(data.capturedAt, language)} />
          <Definition label="Reported by" value={data.observedBy ? `${data.observedBy.firstName} ${data.observedBy.lastName}` : '—'} />
          <Definition label="Recorded" value={formatRelative(data.createdAt ?? data.capturedAt, language)} />
          {data.clientRef ? <Definition label="Offline reference" value={data.clientRef} /> : null}
        </Card>
      </Section>

      <Section title="Evidence">
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
                  {Math.max(1, Math.round(evidence.sizeBytes / 1024))} KB · {formatDateTime(evidence.capturedAt ?? evidence.createdAt, language)}
                </Caption>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Caption tone="muted">No file attached yet.</Caption>
          </Card>
        )}
      </Section>

      {hasPermission('ai:analysis_run') ? (
        <Section title="Position checks">
          <Card>
            <Row gap={10}>
              <Ionicons name="navigate-outline" size={18} color={theme.colors.primary} />
              <Caption tone="muted" style={{ flex: 1 }}>
                Compare this position with your own reading: the coordinate is stored exactly as the capturing device reported it.
              </Caption>
            </Row>
            <Row gap={8} style={{ marginTop: 10 }} wrap>
              <Badge
                label={position.fix ? `${position.fix.latitude.toFixed(5)}, ${position.fix.longitude.toFixed(5)}` : 'current position unavailable'}
                tone={position.fix ? 'success' : 'neutral'}
              />
              {position.fix ? (
                <Badge
                  label={`${Math.round(distanceMeters(Number(data.latitude), Number(data.longitude), position.fix.latitude, position.fix.longitude))} m from this record`}
                  tone="info"
                />
              ) : null}
              <Button label="Read position" size="sm" variant="secondary" icon="navigate-outline" loading={position.loading} onPress={() => void position.refresh()} />
            </Row>
          </Card>
        </Section>
      ) : null}

      {canDelete ? (
        <Section title="Remove">
          <Card>
            <Notice tone="warning" title="Deleting is permanent">
              The record disappears from the register and from any map layer that reads it. Prefer revising the classification when the data is only partly
              wrong.
            </Notice>
            <Button
              label="Delete this observation"
              variant="danger"
              icon="trash-outline"
              loading={remove.isPending}
              onPress={async () => {
                const acceptance = await confirm({
                  title: 'Delete observation',
                  message: `“${data.title}” will be removed. This cannot be undone.`,
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (!acceptance.confirmed) return;
                try {
                  await remove.mutateAsync(data.id);
                  toast.success('Observation deleted');
                  router.replace('/observation');
                } catch (error) {
                  toast.error('Delete refused', error instanceof ApiError ? error.message : undefined);
                }
              }}
            />
          </Card>
        </Section>
      ) : null}

      <Divider style={{ marginVertical: 12 }} />
      <Tiny tone="faint" style={{ textAlign: 'center' }}>
        Record {data.id.slice(0, 8)} · stored by the FEMS API with the reporter's identity and the device position
      </Tiny>
    </ScrollView>
  );
}

/** Haversine distance in metres — the same formula the backend uses to validate positions. */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
