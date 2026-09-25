/**
 * Schedule an inspection.
 *
 * The officer picks the forest (and optionally a zone, a company, a permit and an
 * activity), chooses the inspection type and assigns an inspector from the real
 * user directory. The checklist starts from the standard template for the chosen
 * type and stays editable; the API stores exactly the items that are sent.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import { useCreateInspection, useForests, useForestZones, useUsers } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Body,
  Button,
  Caption,
  Card,
  Notice,
  Overline,
  Row,
  Section,
  SelectSheet,
  TextField,
  Title,
  Tiny,
  useToast,
} from '../../../src/ui';
import { checklistResultLabel, inspectionTypeLabel } from '../../../src/lib/format';

const TYPES = ['ROUTINE', 'COMPLIANCE', 'ENVIRONMENTAL', 'POST_ACTIVITY', 'INCIDENT', 'VERIFICATION'] as const;

/**
 * Standard checklist templates per inspection type. They are a starting point the
 * officer edits before scheduling — the wording of a checklist is a regulatory
 * decision, not something the app decides on its own.
 */
const TEMPLATES: Record<string, string[]> = {
  ROUTINE: [
    'Permit and documents available on site',
    'Boundary marks and cutting area respected',
    'Harvest register up to date',
    'Stump heights and diameters within rules',
    'Safety equipment present in the camp',
  ],
  COMPLIANCE: [
    'Declared volumes match the register',
    'Approved species only',
    'Buffer zones along water courses respected',
    'Road and skid trail standards met',
    'Follow-up on previous corrective actions',
  ],
  ENVIRONMENTAL: [
    'Protected area boundary respected',
    'No illegal dumping of waste or fuel',
    'Waterways and riparian forest intact',
    'Wildlife corridors preserved',
    'Soil erosion control in place',
  ],
  POST_ACTIVITY: [
    'Cutting area closed and left clean',
    'Replanting obligations started',
    'Equipment removed from the site',
    'Access tracks closed or stabilised',
    'Final volumes reconciled with the permit',
  ],
  INCIDENT: [
    'Incident site secured',
    'Witnesses and parties identified',
    'Damages measured and photographed',
    'Third-party risk assessed',
    'Immediate corrective instruction issued',
  ],
  VERIFICATION: [
    'Counter-check of the declared harvested volume',
    'Tree count verified against the register',
    'Species breakdown verified',
    'Equipment usage consistent with the volume',
    'Discrepancies documented',
  ],
};

export default function NewInspectionScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const forests = useForests({ limit: 50, status: 'ACTIVE' });
  const createInspection = useCreateInspection();

  const [type, setType] = useState<(typeof TYPES)[number] | null>('ROUTINE');
  const [forestId, setForestId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(user?.id ?? null);
  const [title, setTitle] = useState('');
  const [scheduledFor, setScheduledFor] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [checklist, setChecklist] = useState<string[]>(TEMPLATES.ROUTINE);
  const [customItem, setCustomItem] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [inspectorSearch, setInspectorSearch] = useState('');

  const zones = useForestZones(forestId);
  const inspectors = useUsers({ search: inspectorSearch || undefined, limit: 20 });

  useEffect(() => {
    if (type) setChecklist(TEMPLATES[type] ?? TEMPLATES.ROUTINE);
  }, [type]);

  useEffect(() => {
    if (forestId && !title) {
      const forest = forests.data?.items.find((entry) => entry.id === forestId);
      if (forest) setTitle(`${inspectionTypeLabel(type ?? 'ROUTINE')} — ${forest.name}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forestId, type]);

  const inspectorOptions = useMemo(() => {
    const items = inspectors.data?.items ?? [];
    return items.map((entry) => ({
      value: entry.id,
      label: `${entry.firstName} ${entry.lastName}`,
      description: `${entry.roles.map((role) => role.label).join(', ')}${entry.company ? ` · ${entry.company.name}` : ''}`,
    }));
  }, [inspectors.data]);

  const canSubmit = Boolean(type && forestId && title.trim() && inspectorId && checklist.length > 0);

  const submit = async () => {
    setFailure(null);
    setServerFields({});
    if (!canSubmit || !type || !forestId || !inspectorId) return;
    try {
      const inspection = await createInspection.mutateAsync({
        type,
        title: title.trim(),
        forestId,
        zoneId: zoneId ?? undefined,
        inspectorId,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
        checklist: checklist.map((label, index) => ({
          code: `CHK-${String(index + 1).padStart(2, '0')}`,
          label,
          result: 'NOT_APPLICABLE' as const,
          sortOrder: index,
        })),
      });
      toast.success('Inspection scheduled', `${inspection.reference} — assigned to the inspector.`);
      router.replace({ pathname: '/inspection/[id]', params: { id: inspection.id } });
    } catch (error) {
      if (error instanceof ApiError) {
        setServerFields(fieldErrors(error));
        setFailure(error.message);
      } else {
        setFailure(error instanceof Error ? error.message : 'The inspection could not be scheduled.');
      }
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Title>Schedule an inspection</Title>
          <Caption tone="muted">The inspector sees it in the field hub and can start it on site with the device GPS.</Caption>
        </View>
        <Button label="Cancel" variant="ghost" size="sm" onPress={() => router.back()} />
      </Row>

      {failure ? (
        <View style={{ marginBottom: 14 }}>
          <Notice tone="danger" title="The inspection was refused">
            {failure}
          </Notice>
        </View>
      ) : null}

      <Section title="Visit">
        <Card>
          <SelectSheet
            label="Inspection type"
            required
            value={type}
            options={TYPES.map((entry) => ({ value: entry, label: inspectionTypeLabel(entry) }))}
            onChange={setType}
          />
          <TextField label="Title" required value={title} onChangeText={setTitle} placeholder="Compliance visit — assiette 3, UFA 10-012" error={serverFields.title} />
          <TextField label="Scheduled for" value={scheduledFor} onChangeText={setScheduledFor} placeholder="YYYY-MM-DD" />
          <SelectSheet
            label="Forest"
            required
            value={forestId}
            options={(forests.data?.items ?? []).map((forest) => ({
              value: forest.id,
              label: `${forest.name} (${forest.code})`,
              description: forest.region,
            }))}
            onChange={(value) => {
              setForestId(value);
              setZoneId(null);
            }}
            placeholder={forests.isLoading ? 'Loading forests…' : 'Choose a forest'}
          />
          <SelectSheet
            label="Zone"
            value={zoneId}
            options={(zones.data ?? []).map((zone) => ({ value: zone.id, label: `${zone.name} (${zone.code})` }))}
            onChange={setZoneId}
            placeholder={forestId ? 'Optional — whole forest by default' : 'Choose a forest first'}
            disabled={!forestId}
          />
        </Card>
      </Section>

      <Section title="Inspector">
        <Card>
          {inspectorOptions.length > 6 ? (
            <TextField label="Search the directory" value={inspectorSearch} onChangeText={setInspectorSearch} placeholder="Name, email or role" icon="search-outline" />
          ) : null}
          <SelectSheet
            label="Assigned inspector"
            required
            value={inspectorId}
            options={inspectorOptions}
            onChange={setInspectorId}
            placeholder={inspectors.isLoading ? 'Loading accounts…' : 'Choose an inspector'}
          />
          <Caption tone="faint">
            The list is the live user directory: only accounts the API returns for your scope can be assigned.
          </Caption>
        </Card>
      </Section>

      <Section title="Checklist">
        <Card>
          <Row justify="space-between" style={{ marginBottom: 10 }}>
            <Overline>Items from the {inspectionTypeLabel(type ?? 'ROUTINE')} template</Overline>
            <Tiny tone="faint">{checklist.length} item(s)</Tiny>
          </Row>
          {checklist.map((item, index) => (
            <View key={`${item}-${index}`} style={{ marginBottom: 8 }}>
              <Row gap={10}>
                <Ionicons name="ellipse-outline" size={16} color={theme.colors.primary} style={{ marginTop: 2 }} />
                <Body style={{ flex: 1 }}>{item}</Body>
                <Pressable
                  onPress={() => setChecklist((current) => current.filter((_, position) => position !== index))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove checklist item: ${item}`}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle-outline" size={18} color={theme.colors.textFaint} />
                </Pressable>
              </Row>
            </View>
          ))}
          <Row gap={8} style={{ marginTop: 6 }}>
            <TextField
              label="Add an item"
              value={customItem}
              onChangeText={setCustomItem}
              placeholder="e.g. Fuel storage bunding verified"
              style={{ flex: 1 }}
            />
            <View style={{ paddingTop: 22 }}>
              <Button
                label="Add"
                size="sm"
                variant="secondary"
                disabled={customItem.trim().length < 4}
                onPress={() => {
                  setChecklist((current) => [...current, customItem.trim()]);
                  setCustomItem('');
                }}
              />
            </View>
          </Row>
          <Caption tone="faint">
            Items are stored with the inspection and ticked in the field. A failing item requires a written finding before submission.
          </Caption>
        </Card>
      </Section>

      <Card>
        <Row gap={10}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.info} />
          <Caption tone="muted" style={{ flex: 1 }}>
            The compliance score is computed by the API from the checklist results and the recorded outcome — it is never typed in by hand.
            Currently {checklistResultLabel('NOT_APPLICABLE')} until the visit is carried out.
          </Caption>
        </Row>
      </Card>

      <View style={{ height: 16 }} />
      <Button label="Schedule inspection" icon="calendar-outline" size="lg" fullWidth loading={createInspection.isPending} disabled={!canSubmit} onPress={submit} />
    </ScrollView>
  );
}
