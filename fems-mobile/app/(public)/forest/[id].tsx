/**
 * Public forest detail for signed-out visitors.
 *
 * Shows the seeded cover, the forest's statutory facts, its management zones and
 * a link onto the GIS map centred on the forest's real coordinates. All reads are
 * public; actions that require a role prompt the visitor to sign in.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForest, useForestZones, useMediaCovers } from '../../../src/api/queries';
import { useTheme } from '../../../src/theme/theme';
import { MediaCover } from '../../../src/components/media/MediaCover';
import { Badge, Body, Button, Caption, Definition, ErrorState, Overline, Row, Section, SkeletonList, StatTile, Title } from '../../../src/ui';
import { forestStatusLabel, forestTypeLabel, formatArea, formatVolume } from '../../../src/lib/format';

export default function PublicForestDetail() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const forest = useForest(id ?? null);
  const zones = useForestZones(id ?? null);
  const covers = useMediaCovers('FOREST', id ? [id] : []);
  const cover = covers.data?.[String(id)] ?? null;

  if (forest.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 20, paddingTop: insets.top + 20 }}>
        <SkeletonList rows={6} />
      </View>
    );
  }
  if (forest.isError || !forest.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 20, paddingTop: insets.top + 20 }}>
        <ErrorState error={forest.error} onRetry={() => forest.refetch()} />
      </View>
    );
  }

  const data = forest.data;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} showsVerticalScrollIndicator={false}>
      <View style={{ height: 260 }}>
        <MediaCover descriptor={cover} fallbackLabel={data.name} height={260} borderRadius={0} />
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(4,18,12,0.25)' }} />
        <View style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
          <Button label="Back" size="sm" variant="secondary" icon="arrow-back-outline" onPress={() => router.back()} />
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, marginTop: -46 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl, padding: 18, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.raised, gap: 10 }}>
          <Row justify="space-between" align="center">
            <Overline tone="muted">{data.code}</Overline>
            <Row gap={6}>
              <Badge label={forestTypeLabel(data.type)} tone="primary" compact />
              <Badge label={forestStatusLabel(data.status)} tone={data.status === 'ACTIVE' ? 'success' : 'warning'} compact />
              {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
            </Row>
          </Row>
          <Title>{data.name}</Title>
          <Caption tone="muted">
            {data.region}
            {data.division ? ` · ${data.division}` : ''}
            {data.subdivision ? ` · ${data.subdivision}` : ''}
          </Caption>
          {data.description ? <Body tone="muted">{data.description}</Body> : null}
          <Row gap={10} wrap style={{ marginTop: 4 }}>
            <Button label="View on map" size="sm" icon="map-outline" onPress={() => router.push({ pathname: '/map', params: { forestId: String(data.id) } })} />
            <Button label="Sign in to work here" size="sm" variant="secondary" icon="log-in-outline" onPress={() => router.push('/login')} />
          </Row>
        </View>
      </View>

      <Section title="Key figures" style={{ marginTop: 24, paddingHorizontal: 20 }}>
        <Row gap={10} wrap>
          <StatTile label="Total area" value={formatArea(data.totalAreaHa)} icon="resize-outline" />
          {data.exploitableAreaHa ? <StatTile label="Exploitable" value={formatArea(data.exploitableAreaHa)} icon="cut-outline" tone="accent" /> : null}
          {data.annualAllowableCutM3 ? <StatTile label="Annual cut" value={formatVolume(data.annualAllowableCutM3)} icon="stats-chart-outline" tone="success" /> : null}
          {data.elevationM ? <StatTile label="Elevation" value={`${data.elevationM} m`} icon="trending-up-outline" /> : null}
        </Row>
      </Section>

      <Section title="Details" style={{ paddingHorizontal: 20 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: 16, borderWidth: 1, borderColor: theme.colors.border }}>
          <Row wrap gap={12}>
            <Definition label="Region" value={data.region} />
            <Definition label="Type" value={forestTypeLabel(data.type)} />
            <Definition label="Zones" value={String(data._count?.zones ?? zones.data?.length ?? 0)} />
            <Definition label="Permits" value={String(data._count?.permits ?? 0)} />
          </Row>
        </View>
      </Section>

      <Section title="Management zones" style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        {zones.isLoading ? (
          <SkeletonList rows={3} />
        ) : (zones.data ?? []).length === 0 ? (
          <Caption tone="muted">No zones published for this forest yet.</Caption>
        ) : (
          <View style={{ gap: 10 }}>
            {(zones.data ?? []).map((zone) => (
              <Row key={String(zone.id)} gap={10} align="center" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="grid-outline" size={17} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Body style={{ fontWeight: '600' }} numberOfLines={1}>
                    {zone.name}
                  </Body>
                  <Caption tone="muted">
                    {zone.code} · {formatArea(zone.areaHa)}
                  </Caption>
                </View>
                <Badge label={zone.type.replace(/_/g, ' ')} tone="neutral" compact />
              </Row>
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}
