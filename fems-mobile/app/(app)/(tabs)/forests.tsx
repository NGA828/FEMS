/**
 * Forests tab — the public catalogue of the national forest estate.
 *
 * Available to every signed-in role (the API serves forest listings without a
 * permission gate because they are public regulatory data). Cards show the real
 * area, the managing body, the protected-area overlap and the demo flag coming
 * from the database, and open the map centred on the feature.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForestStatistics, useForests, useProtectedAreas } from '../../../src/api/queries';
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
  Row,
  SearchBar,
  Section,
  SegmentedControl,
  SkeletonList,
  StatTile,
  Tiny,
  Title,
} from '../../../src/ui';
import { forestStatusLabel, forestTypeLabel, formatArea, formatVolume, protectedAreaTypeLabel } from '../../../src/lib/format';

const TYPE_FILTERS: import('../../../src/api/types').ForestType[] = ['PRODUCTION', 'PROTECTION', 'COMMUNITY', 'REGENERATION', 'PLANTATION', 'MIXED'];

export default function ForestsTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [view, setView] = useState<'forests' | 'protected'>('forests');
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const forests = useForests({ type: type ?? undefined, search: search.trim() || undefined, page, limit: 12 });
  const protectedAreas = useProtectedAreas({ page, limit: 12 });
  const statistics = useForestStatistics();

  const active = view === 'forests' ? forests : protectedAreas;
  const forestItems = forests.data?.items ?? [];
  const protectedItems = protectedAreas.data?.items ?? [];
  const items = view === 'forests' ? forestItems : protectedItems;

  const totals = useMemo(
    () => ({
      totalArea: forestItems.reduce((sum: number, forest) => sum + Number(forest.totalAreaHa ?? 0), 0),
      demo: forestItems.filter((forest) => forest.isDemo).length,
    }),
    [forestItems],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items as (typeof forestItems[number] | typeof protectedItems[number])[]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 48 }}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching}
            onRefresh={() => {
              void forests.refetch();
              void protectedAreas.refetch();
              void statistics.refetch();
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Title>Forest estate</Title>
                <Caption tone="muted">Catalogue of classified forests, community forests and protected areas</Caption>
              </View>
              <Button label="Map" size="sm" variant="secondary" icon="map-outline" onPress={() => router.push('/map')} />
            </Row>

            {statistics.data ? (
              <Row gap={10} wrap style={{ marginBottom: 14 }}>
                <StatTile label="Forests" value={statistics.data.total ?? forestItems.length} icon="leaf-outline" />
                <StatTile
                  label="Classified area"
                  value={formatArea(statistics.data.totalAreaHa ?? totals.totalArea, language)}
                  icon="resize-outline"
                />
                <StatTile
                  label="Annual cut"
                  value={formatVolume(statistics.data.totalAnnualAllowableCutM3 ?? 0, language)}
                  icon="cut-outline"
                />
                <StatTile label="Protected areas" value={protectedItems.length} icon="shield-checkmark-outline" />
              </Row>
            ) : null}

            <SegmentedControl
              value={view}
              options={[
                { value: 'forests', label: 'Forests' },
                { value: 'protected', label: 'Protected areas' },
              ]}
              onChange={(value: string) => {
                setView(value === 'protected' ? 'protected' : 'forests');
                setPage(1);
              }}
            />

            {view === 'forests' ? (
              <>
                <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, code or region" onSubmit={() => setPage(1)} />
                <Row gap={8} wrap style={{ marginTop: 12, marginBottom: 12 }}>
                  <Chip label="All types" selected={!type} onPress={() => setType(null)} />
                  {TYPE_FILTERS.map((entry) => (
                    <Chip key={entry} label={forestTypeLabel(entry, language)} selected={type === entry} onPress={() => setType(entry)} />
                  ))}
                </Row>
              </>
            ) : (
              <View style={{ height: 12 }} />
            )}

            {totals.demo > 0 && view === 'forests' ? (
              <Card style={{ marginBottom: 12 }}>
                <Row gap={10}>
                  <Ionicons name="flask-outline" size={18} color={theme.colors.info} />
                  <Caption tone="muted" style={{ flex: 1 }}>
                    {totals.demo} of the forests on this page are seeded demonstration records. They are labelled DEMO and their coordinates fall inside
                    Cameroon but they do not replace the official register.
                  </Caption>
                </Row>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          active.isLoading ? (
            <SkeletonList rows={4} />
          ) : active.isError ? (
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          ) : (
            <EmptyState icon="leaf-outline" title="Nothing matches" description="Try another region, type or search term." />
          )
        }
        renderItem={({ item }) =>
          view === 'forests' ? (
            <ForestCard
              forest={item as (typeof forestItems)[number]}
              language={language}
              onOpen={(forestId) => router.push({ pathname: '/map', params: { forestId } })}
            />
          ) : (
            <ProtectedAreaCard
              area={item as (typeof protectedItems)[number]}
              language={language}
              onOpen={(latitude, longitude, name) =>
                router.push({ pathname: '/map', params: { latitude: String(latitude), longitude: String(longitude), label: name } })
              }
            />
          )
        }
        ListFooterComponent={
          items.length > 0 && active.data?.meta?.hasNextPage ? (
            <Section>
              <Button label="Load more" variant="secondary" icon="chevron-down" onPress={() => setPage((current) => current + 1)} />
            </Section>
          ) : null
        }
      />
    </View>
  );
}

/**
 * One forest in the catalogue. The card is a real link: opening it centres the
 * map on the forest's own coordinates from the database.
 */
function ForestCard({
  forest,
  language,
  onOpen,
}: {
  forest: import('../../../src/api/types').Forest;
  language: 'en' | 'fr';
  onOpen: (forestId: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(forest.id)}
      accessibilityRole="button"
      accessibilityLabel={`Forest ${forest.name}, open on the map`}
      style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
    >
      <Card>
        <Row justify="space-between" style={{ marginBottom: 6 }}>
          <Row gap={6} style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{forest.name}</Body>
            {forest.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
          <Badge label={forestTypeLabel(forest.type, language)} tone="primary" />
        </Row>
        <Caption tone="muted" style={{ marginBottom: 8 }}>
          {forest.code} · {forest.region}
          {forest.division ? ` · ${forest.division}` : ''}
        </Caption>
        <Row gap={10} wrap>
          <Badge label={formatArea(forest.totalAreaHa, language)} tone="neutral" icon="resize-outline" />
          {forest.exploitableAreaHa ? <Badge label={`${formatArea(forest.exploitableAreaHa, language)} exploitable`} tone="neutral" /> : null}
          <Badge label={forestStatusLabel(forest.status, language)} tone={forest.status === 'ACTIVE' ? 'success' : 'warning'} />
        </Row>
        <Row gap={10} wrap style={{ marginTop: 8 }}>
          {forest._count?.zones !== undefined ? <Tiny tone="faint">{forest._count.zones} zones</Tiny> : null}
          {forest._count?.permits !== undefined ? <Tiny tone="faint">· {forest._count.permits} permits</Tiny> : null}
          {forest._count?.activities !== undefined ? <Tiny tone="faint">· {forest._count.activities} activities</Tiny> : null}
          {forest.protectedArea ? <Tiny tone="faint">· overlaps {forest.protectedArea.name}</Tiny> : null}
        </Row>
        {forest.managedBy ? (
          <Row gap={6} style={{ marginTop: 8 }}>
            <Ionicons name="business-outline" size={14} color="#8A968D" />
            <Tiny tone="faint">{forest.managedBy.name}</Tiny>
          </Row>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** One protected area; opening it centres the map on the recorded coordinate. */
function ProtectedAreaCard({
  area,
  language,
  onOpen,
}: {
  area: import('../../../src/api/types').ProtectedArea;
  language: 'en' | 'fr';
  onOpen: (latitude: number, longitude: number, name: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(Number(area.latitude), Number(area.longitude), area.name)}
      accessibilityRole="button"
      accessibilityLabel={`Protected area ${area.name}, open on the map`}
      style={({ pressed }) => ({ marginBottom: 12, opacity: pressed ? 0.85 : 1 })}
    >
      <Card>
        <Row justify="space-between" style={{ marginBottom: 6 }}>
          <Row gap={6} style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{area.name}</Body>
            {area.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
          <Badge label={protectedAreaTypeLabel(area.type, language)} tone="success" icon="shield-checkmark-outline" />
        </Row>
        <Caption tone="muted" style={{ marginBottom: 8 }}>
          {area.code} · {area.region}
        </Caption>
        <Row gap={10} wrap>
          <Badge label={formatArea(area.areaHa, language)} tone="neutral" />
          {area.managingAuthority ? <Badge label={area.managingAuthority} tone="neutral" /> : null}
        </Row>
        {area.encroachmentRisk ? (
          <Caption tone="muted" style={{ marginTop: 8 }}>
            Encroachment risk: {area.encroachmentRisk}
          </Caption>
        ) : null}
        {area._count ? (
          <Row gap={10} wrap style={{ marginTop: 8 }}>
            <Tiny tone="faint">{area._count.forests ?? 0} forests</Tiny>
            <Tiny tone="faint">· {area._count.observations ?? 0} observations</Tiny>
            <Tiny tone="faint">· {area._count.violations ?? 0} cases</Tiny>
          </Row>
        ) : null}
      </Card>
    </Pressable>
  );
}
