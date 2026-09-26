/**
 * Public forest catalogue for signed-out visitors.
 *
 * A searchable, filterable, image-led listing of the public forest register and
 * protected areas. Tapping a card opens the public forest detail. No session is
 * required — the underlying endpoints are `@Public()`.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForests, useMediaCovers, useProtectedAreas } from '../../src/api/queries';
import { useTheme } from '../../src/theme/theme';
import { MediaCover } from '../../src/components/media/MediaCover';
import { Badge, Body, Caption, Chip, EmptyState, ErrorState, PageHeader, Row, SearchBar, SegmentedControl, SkeletonList } from '../../src/ui';
import { forestTypeLabel, formatArea, protectedAreaTypeLabel } from '../../src/lib/format';
import type { Forest, MediaDescriptor, ProtectedArea } from '../../src/api/types';

const TYPE_FILTERS: Forest['type'][] = ['PRODUCTION', 'PROTECTION', 'COMMUNITY', 'REGENERATION', 'PLANTATION', 'MIXED'];

export default function ExploreScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [view, setView] = useState<'forests' | 'protected'>('forests');
  const [type, setType] = useState<Forest['type'] | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const forests = useForests({ type: type ?? undefined, search: search.trim() || undefined, page, limit: 20 });
  const protectedAreas = useProtectedAreas({ page, limit: 20 });
  const active = view === 'forests' ? forests : protectedAreas;

  const forestItems = (forests.data?.items ?? []) as Forest[];
  const areaItems = (protectedAreas.data?.items ?? []) as ProtectedArea[];
  const forestIds = useMemo(() => forestItems.map((forest) => String(forest.id)), [forestItems]);
  const areaIds = useMemo(() => areaItems.map((area) => String(area.id)), [areaItems]);
  const forestCovers = useMediaCovers('FOREST', view === 'forests' ? forestIds : []);
  const areaCovers = useMediaCovers('PROTECTED_AREA', view === 'protected' ? areaIds : []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList<Forest | ProtectedArea>
        data={view === 'forests' ? forestItems : areaItems}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 16 }}>
            <PageHeader
              title="Explore the forest estate"
              subtitle="Public catalogue of classified forests and protected areas"
              onBack={() => router.back()}
              compact
            />
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
              <View style={{ gap: 12 }}>
                <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, code or region" onSubmit={() => setPage(1)} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label="All types" selected={!type} onPress={() => setType(null)} />
                  {TYPE_FILTERS.map((entry) => (
                    <Chip key={entry} label={forestTypeLabel(entry)} selected={type === entry} onPress={() => setType(entry)} />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          active.isLoading ? (
            <SkeletonList rows={5} />
          ) : active.isError ? (
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          ) : (
            <EmptyState icon="leaf-outline" title="Nothing matches" description="Try another region, type or search term." />
          )
        }
        renderItem={({ item }) =>
          view === 'forests' ? (
            <ExploreForestCard
              forest={item as Forest}
              cover={forestCovers.data?.[String((item as Forest).id)] ?? null}
              onPress={() => router.push({ pathname: '/forest/[id]', params: { id: String((item as Forest).id) } })}
            />
          ) : (
            <ExploreAreaCard area={item as ProtectedArea} cover={areaCovers.data?.[String((item as ProtectedArea).id)] ?? null} />
          )
        }
      />
    </View>
  );
}

function ExploreForestCard({ forest, cover, onPress }: { forest: Forest; cover: MediaDescriptor | null; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Forest ${forest.name}`} style={{ marginBottom: 14 }}>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.card }}>
        <MediaCover descriptor={cover} fallbackLabel={forest.name} height={160} borderRadius={0} />
        <View style={{ padding: 14, gap: 6 }}>
          <Row justify="space-between" align="center">
            <Body style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
              {forest.name}
            </Body>
            <Badge label={forestTypeLabel(forest.type)} tone="primary" compact />
          </Row>
          <Caption tone="muted">
            {forest.code} · {forest.region}
            {forest.division ? ` · ${forest.division}` : ''}
          </Caption>
          <Row gap={8} wrap>
            <Badge label={formatArea(forest.totalAreaHa)} tone="neutral" icon="resize-outline" compact />
            {forest.exploitableAreaHa ? <Badge label={`${formatArea(forest.exploitableAreaHa)} exploitable`} tone="neutral" compact /> : null}
            {forest.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
        </View>
      </View>
    </Pressable>
  );
}

function ExploreAreaCard({ area, cover }: { area: ProtectedArea; cover: MediaDescriptor | null }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 14, backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.card }}>
      <MediaCover descriptor={cover} fallbackLabel={area.name} height={160} borderRadius={0} />
      <View style={{ padding: 14, gap: 6 }}>
        <Row justify="space-between" align="center">
          <Body style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {area.name}
          </Body>
          <Badge label={protectedAreaTypeLabel(area.type)} tone="success" icon="shield-checkmark-outline" compact />
        </Row>
        <Caption tone="muted">
          {area.code} · {area.region}
        </Caption>
        <Row gap={8}>
          <Badge label={formatArea(area.areaHa)} tone="neutral" compact />
          {area.encroachmentRisk ? <Badge label={`Risk ${area.encroachmentRisk}`} tone="warning" compact /> : null}
        </Row>
      </View>
    </View>
  );
}
