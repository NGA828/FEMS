/**
 * Field observation capture.
 *
 * Observations are what a patrol or a community reporter files about the forest
 * itself: a fallen tree, encroachment, a poached animal, a blocked water course.
 * The record carries the device position, is attached to a forest (and, where
 * relevant, a zone, an activity or an inspection) and can be queued offline.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import { useCreateObservation, useForests, useForestZones } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useDevicePosition, accuracyBand } from '../../../src/hooks/useDevicePosition';
import { useNetworkStatus } from '../../../src/hooks/useNetworkStatus';
import { offlineQueue, newObservationClientRef } from '../../../src/offline/queue';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Button,
  Caption,
  Card,
  Heading,
  Notice,
  Overline,
  Row,
  Section,
  SelectSheet,
  TextField,
  Tiny,
  Title,
  ToneScope,
  useToast,
} from '../../../src/ui';
import { humanize, observationCategoryLabel, severityLabel } from '../../../src/lib/format';

const CATEGORIES = [
  { value: 'TREE_CONDITION', label: 'Tree condition', description: 'Disease, dieback, storm damage' },
  { value: 'WILDLIFE', label: 'Wildlife', description: 'Sighting, carcass, trapping evidence' },
  { value: 'VEGETATION_COVER', label: 'Vegetation cover', description: 'Canopy gaps, regrowth state' },
  { value: 'SOIL', label: 'Soil', description: 'Erosion, compaction, landslides' },
  { value: 'WATER_BODY', label: 'Water body', description: 'Water courses, siltation, pollution' },
  { value: 'ENCROACHMENT', label: 'Encroachment', description: 'Farming or settlement inside the forest' },
  { value: 'ILLEGAL_LOGGING', label: 'Suspected illegal logging', description: 'Felled timber without a matching declaration' },
  { value: 'INFRASTRUCTURE', label: 'Infrastructure', description: 'Roads, bridges, culverts, camps' },
  { value: 'FIRE_DAMAGE', label: 'Fire damage', description: 'Burnt areas and fire traces' },
  { value: 'WEATHER', label: 'Weather', description: 'Storm, flooding, exceptional conditions' },
  { value: 'INCIDENT', label: 'Incident', description: 'Accident or safety event' },
  { value: 'OTHER', label: 'Other', description: 'Anything else worth recording' },
] as const;

const SEVERITIES = [
  { value: 'LOW', label: 'Low', description: 'Informational, no intervention needed' },
  { value: 'MEDIUM', label: 'Medium', description: 'Should be looked at during the next visit' },
  { value: 'HIGH', label: 'High', description: 'Requires attention from the forest service' },
  { value: 'CRITICAL', label: 'Critical', description: 'Immediate risk to the forest or to people' },
] as const;

export default function NewObservationScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ forestId?: string; activityId?: string; inspectionId?: string }>();
  const { user, hasPermission } = useAuth();
  const network = useNetworkStatus();
  const position = useDevicePosition();

  const forests = useForests({ limit: 50 });
  const createObservation = useCreateObservation();

  const [forestId, setForestId] = useState<string | null>(params.forestId ?? null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value'] | null>('TREE_CONDITION');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]['value'] | null>('LOW');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const zones = useForestZones(forestId);
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';
  const band = accuracyBand(position.accuracyM);

  useEffect(() => {
    void position.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = useMemo(() => {
    const map: Record<string, string> = { ...serverFields };
    if (!forestId) map.forestId = 'Choose the forest the observation belongs to.';
    if (!category) map.category = 'Choose a category.';
    if (title.trim().length < 4) map.title = 'Give the observation a short, descriptive title.';
    if (description.trim().length < 15) map.description = 'Describe what you actually saw — at least 15 characters.';
    return map;
  }, [serverFields, forestId, category, title, description]);

  const canSubmit = Boolean(forestId && category && title.trim().length >= 4 && description.trim().length >= 15) && !submitting;

  const submit = async () => {
    if (!forestId || !category) return;
    setFailure(null);
    setServerFields({});
    setSubmitting(true);

    const fix = position.fix ?? (await position.refresh());
    if (!fix) {
      setSubmitting(false);
      setFailure(
        position.error?.message ??
          'FEMS requires the real position of an observation. There is no default coordinate — enable location services or capture it from a device with a fix.',
      );
      return;
    }

    const clientRef = newObservationClientRef();
    const payload = {
      forestId,
      zoneId: zoneId ?? undefined,
      category,
      severity: severity ?? undefined,
      title: title.trim(),
      description: description.trim(),
      latitude: fix.latitude,
      longitude: fix.longitude,
      locationAccuracyM: fix.accuracyM ?? undefined,
      gpsSource: fix.source,
      capturedAt: fix.capturedAt,
      activityId: params.activityId,
      inspectionId: params.inspectionId,
      clientRef,
    };

    try {
      if (network.offline) {
        await offlineQueue.enqueueObservation(payload);
        toast.info('Queued on this device', 'The observation will be uploaded with its original position when the connection returns.');
        router.replace('/sync');
        return;
      }
      const observation = await createObservation.mutateAsync(payload);
      toast.success('Observation recorded', `${observation.title} — visible to the forest service.`);
      router.replace({ pathname: '/observation/[id]', params: { id: observation.id } });
    } catch (error) {
      if (error instanceof ApiError && error.isOffline) {
        await offlineQueue.enqueueObservation(payload);
        toast.info('Queued on this device', 'The API could not be reached; the record is stored locally.');
        router.replace('/sync');
        return;
      }
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The observation could not be saved.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasPermission('observations:create')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <Notice tone="warning" title="Not available for your role">
          Filing an observation requires the `observations:create` permission.
        </Notice>
        <View style={{ marginTop: 12 }}>
          <Button label="Read observations" variant="secondary" onPress={() => router.replace('/observation')} fullWidth />
        </View>
      </ScrollView>
    );
  }

  return (
    <ToneScope tone="dark">
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        keyboardShouldPersistTaps="handled"
      >
        <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Row gap={6}>
              <Ionicons name="eye-outline" size={18} color={theme.colors.primary} />
              <Overline>Field capture</Overline>
            </Row>
            <Title>Observation</Title>
            <Caption tone="muted">What you saw, where you saw it, when.</Caption>
          </View>
          <Button label="Close" variant="ghost" size="sm" onPress={() => router.back()} />
        </Row>

        <Card style={{ marginBottom: 14 }}>
          <Row justify="space-between" align="center" style={{ marginBottom: 10 }}>
            <Badge
              label={network.offline ? 'Offline — will queue' : 'Online'}
              tone={network.offline ? 'warning' : 'success'}
              icon={network.offline ? 'cloud-offline-outline' : 'cloud-done-outline'}
            />
            <Pressable onPress={() => void position.refresh()} accessibilityRole="button" accessibilityLabel="Refresh GPS position">
              <Row gap={4}>
                <Ionicons name="navigate-outline" size={14} color={theme.colors.primary} />
                <Tiny style={{ color: theme.colors.primary }}>Refresh GPS</Tiny>
              </Row>
            </Pressable>
          </Row>
          <Row gap={8} wrap>
            <Badge
              label={position.fix ? `${position.fix.latitude.toFixed(6)}, ${position.fix.longitude.toFixed(6)}` : 'Waiting for a fix…'}
              tone={position.fix ? 'success' : 'warning'}
              icon="location-outline"
            />
            <Badge label={band.label} tone={band.tone === 'good' ? 'success' : band.tone === 'fair' ? 'warning' : 'danger'} />
          </Row>
          <Caption tone="faint" style={{ marginTop: 8 }}>
            The coordinate above is what the device reported at capture time. It is stored as-is and can be cross-checked against the forest boundary.
          </Caption>
        </Card>

        {failure ? (
          <View style={{ marginBottom: 14 }}>
            <Notice tone="danger" title="Observation refused">
              {failure}
            </Notice>
          </View>
        ) : null}

        <Section title="Where">
          <Card>
            <SelectSheet
              label="Forest"
              required
              value={forestId}
              options={(forests.data?.items ?? []).map((forest) => ({ value: forest.id, label: `${forest.name} (${forest.code})`, description: forest.region }))}
              onChange={(value) => {
                setForestId(value);
                setZoneId(null);
              }}
              placeholder={forests.isLoading ? 'Loading forests…' : 'Choose a forest'}
              error={errors.forestId}
            />
            <SelectSheet
              label="Zone"
              value={zoneId}
              options={(zones.data ?? []).map((zone) => ({ value: zone.id, label: `${zone.name} (${zone.code})` }))}
              onChange={setZoneId}
              placeholder={forestId ? 'Optional' : 'Choose a forest first'}
              disabled={!forestId}
            />
          </Card>
        </Section>

        <Section title="What">
          <Card>
            <SelectSheet
              label="Category"
              required
              value={category}
              options={CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
              onChange={setCategory}
              error={errors.category}
            />
            <SelectSheet
              label="Perceived severity"
              value={severity}
              options={SEVERITIES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.description }))}
              onChange={setSeverity}
            />
            <TextField
              label="Title"
              required
              value={title}
              onChangeText={setTitle}
              placeholder="Wind-thrown ebony beside the N16 track"
              error={errors.title}
            />
            <TextField
              label="Description"
              required
              multiline
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the extent, the species involved and anything that helps the service act on it."
              error={errors.description}
              help={`${description.trim().length} characters — at least 15 required.`}
            />
          </Card>
        </Section>

        <Card style={{ marginBottom: 14 }}>
          <Row gap={10}>
            <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
            <Caption tone="muted" style={{ flex: 1 }}>
              An observation is a report, not a verdict. It never accuses anyone automatically; the forest service or the environmental officer decides what it
              means, and any AI analysis of it stays advisory.
            </Caption>
          </Row>
        </Card>

        <Heading style={{ marginBottom: 8 }}>
          {category ? observationCategoryLabel(category, language) : 'Observation'}
          {severity ? ` · ${severityLabel(severity, language)}` : ''}
        </Heading>
        <Caption tone="muted" style={{ marginBottom: 16 }}>
          {params.activityId ? `Linked to activity ${String(params.activityId).slice(0, 8)}. ` : ''}
          {params.inspectionId ? `Linked to inspection ${String(params.inspectionId).slice(0, 8)}. ` : ''}
          Category options: {CATEGORIES.length} · severity {severity ? humanize(severity).toLowerCase() : 'not set'}
        </Caption>

        <Button
          label={network.offline ? 'Queue the observation' : 'Submit observation'}
          icon={network.offline ? 'cloud-upload-outline' : 'send-outline'}
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </ScrollView>
    </ToneScope>
  );
}
