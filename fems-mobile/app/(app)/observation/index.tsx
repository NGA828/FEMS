/**
 * Field observation register.
 *
 * Reads `GET /observations` with the filters the API supports. Company accounts
 * see the observations recorded on their own operations; the forest service sees
 * everything in its scope — the scoping happens on the server, never here.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useObservations } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  RiskPill,
  Row,
  SearchBar,
  Section,
  SkeletonList,
  StatTile,
  Tiny,
  Title,
} from '../../../src/ui';
import { formatDateTime, formatRelative, observationCategoryLabel, severityLabel } from '../../../src/lib/format';

const CATEGORY_FILTERS = ['TREE_CONDITION', 'WILDLIFE', 'ENCROACHMENT', 'ILLEGAL_LOGGING', 'WATER_BODY', 'FIRE_DAMAGE', 'SOIL', 'OTHER'] as const;
const SEVERITY_FILTERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function ObservationRegisterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [category, setCategory] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({ category: category ?? undefined, severity: severity ?? undefined, page, limit: 15 }),
    [category, severity, page],
  );
  const observations = useObservations(query);
  const all = observations.data?.items ?? [];
  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((entry) => `${entry.title} ${entry.description} ${entry.forest?.name ?? ''}`.toLowerCase().includes(term));
  }, [all, search]);

  const counts = useMemo(() => {
    const bySeverity: Record<string, number> = {};
    all.forEach((entry) => {
      const key = entry.severity ?? 'UNRATED';
      bySeverity[key] = (bySeverity[key] ?? 0) + 1;
    });
    return bySeverity;
  }, [all]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl refreshing={observations.isRefetching} onRefresh={() => observations.refetch()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />
        }
        ListHeaderComponent={
          <View>
            <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Title>Field observations</Title>
                <Caption tone="muted">
                  {user?.company ? `${user.company.name} records` : 'What patrols, inspectors and communities reported'}
                </Caption>
              </View>
              {hasPermission('observations:create') ? (
                <Button label="Observe" icon="add" size="sm" onPress={() => router.push('/observation/new')} />
              ) : null}
            </Row>

            {all.length > 0 ? (
              <Row gap={10} wrap style={{ marginBottom: 14 }}>
                <StatTile label="Listed" value={all.length} icon="eye-outline" />
                <StatTile label="High + critical" value={(counts.HIGH ?? 0) + (counts.CRITICAL ?? 0)} icon="warning-outline" tone="danger" />
                <StatTile label="Unrated" value={counts.UNRATED ?? 0} icon="help-circle-outline" />
              </Row>
            ) : null}

            <SearchBar value={search} onChangeText={setSearch} placeholder="Search title, description or forest" onSubmit={() => setPage(1)} />
            <Row gap={8} wrap style={{ marginTop: 12 }}>
              <Chip label="All categories" selected={!category} onPress={() => setCategory(null)} />
              {CATEGORY_FILTERS.map((entry) => (
                <Chip key={entry} label={observationCategoryLabel(entry, language)} selected={category === entry} onPress={() => setCategory(entry)} />
              ))}
            </Row>
            <Row gap={8} wrap style={{ marginTop: 8, marginBottom: 12 }}>
              <Chip label="All severities" selected={!severity} onPress={() => setSeverity(null)} />
              {SEVERITY_FILTERS.map((entry) => (
                <Chip key={entry} label={severityLabel(entry, language)} selected={severity === entry} onPress={() => setSeverity(entry)} />
              ))}
            </Row>
          </View>
        }
        ListEmptyComponent={
          observations.isLoading ? (
            <SkeletonList rows={4} />
          ) : observations.isError ? (
            <ErrorState error={observations.error} onRetry={() => observations.refetch()} />
          ) : (
            <EmptyState
              icon="eye-outline"
              title="Nothing reported"
              description="Observations recorded in the field appear here with their position and the reporter's name."
              actionLabel={hasPermission('observations:create') ? 'File an observation' : undefined}
              onAction={hasPermission('observations:create') ? () => router.push('/observation/new') : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/observation/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Observation: ${item.title}`}
            style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Row justify="space-between" style={{ marginBottom: 6 }}>
                <Row gap={6} style={{ flex: 1 }}>
                  <Badge label={observationCategoryLabel(item.category, language)} tone="primary" />
                  {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                </Row>
                {item.severity ? <RiskPill level={item.severity} label={severityLabel(item.severity, language)} /> : <Badge label="unrated" tone="neutral" />}
              </Row>
              <Body style={{ fontWeight: '700', marginBottom: 4 }}>{item.title}</Body>
              <Caption tone="muted" style={{ marginBottom: 8 }} lines={2}>
                {item.description}
              </Caption>
              <Row gap={10} wrap>
                <Tiny tone="faint">{item.forest?.name ?? '—'}</Tiny>
                <Tiny tone="faint">· {formatDateTime(item.capturedAt, language)}</Tiny>
                {item.observedBy ? (
                  <Tiny tone="faint">
                    · {item.observedBy.firstName} {item.observedBy.lastName}
                  </Tiny>
                ) : null}
                {item.syncStatus && item.syncStatus !== 'SYNCED' ? <Badge label={item.syncStatus} tone="warning" compact /> : null}
                {item.aiProcessedAt ? <Badge label="analysed" tone="info" compact icon="sparkles-outline" /> : null}
              </Row>
              <Row justify="space-between" style={{ marginTop: 8 }}>
                <Tiny tone="faint">
                  {Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}
                </Tiny>
                <Tiny tone="faint">{formatRelative(item.createdAt ?? item.capturedAt, language)}</Tiny>
              </Row>
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          items.length > 0 && observations.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : null
        }
      />
    </View>
  );
}
