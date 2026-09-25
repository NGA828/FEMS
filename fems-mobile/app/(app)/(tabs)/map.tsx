/**
 * GIS map — "Mission Control".
 *
 * The map is the working surface: real coordinates from the FEMS register, drawn
 * from `GET /gis/map`, with the device's own position taken from the platform
 * location API (never a hardcoded city). Layer toggles, the feature list and the
 * "near me" search all read live data, and every result links to the record it
 * belongs to.
 *
 * The canvas is platform-split: `MapCanvas.web` draws with Leaflet, `MapCanvas`
 * draws with react-native-maps. Both take the same props.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../src/api/client';
import type { GisFeature } from '../../../src/api/types';
import { useGisLayers, useGisMap, useGisStatistics, useNearby, useRecordPosition } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { MapCanvas } from '../../../src/components/map/MapCanvas';
import { LAYER_CODES, LAYER_COLORS, LAYER_LABELS, type MapPoint } from '../../../src/components/map/types';
import { useDevicePosition, accuracyBand } from '../../../src/hooks/useDevicePosition';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  ErrorState,
  LoadingBlock,
  Notice,
  Overline,
  Row,
  Section,
  SegmentedControl,
  SkeletonList,
  StatTile,
  Tiny,
  Title,
  ToneScope,
  useToast,
} from '../../../src/ui';
import { formatDateTime, formatRelative, humanize } from '../../../src/lib/format';

/** Cameroon's centre — used only until a real position or deep link is known. */
const COUNTRY_VIEW = { latitude: 5.7, longitude: 12.7, zoom: 6 };
const NEARBY_RADII = [10, 25, 50, 100] as const;

export default function MapTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ forestId?: string; latitude?: string; longitude?: string; label?: string }>();
  const { user, hasPermission } = useAuth();

  const position = useDevicePosition();
  const layers = useGisLayers();
  const statistics = useGisStatistics();
  const recordPosition = useRecordPosition();

  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<'features' | 'nearby'>('features');
  const [radiusKm, setRadiusKm] = useState<number>(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [searchNearby, setSearchNearby] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const deepLinkCenter = useMemo(() => {
    const latitude = params.latitude ? Number(params.latitude) : null;
    const longitude = params.longitude ? Number(params.longitude) : null;
    if (latitude === null || longitude === null || Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    return { latitude, longitude };
  }, [params.latitude, params.longitude]);

  const mapQuery = useMemo(() => ({ limit: 400, forestId: params.forestId }), [params.forestId]);
  const map = useGisMap(mapQuery);

  const nearby = useNearby(
    searchNearby && position.fix
      ? { latitude: position.fix.latitude, longitude: position.fix.longitude, radiusKm, featureTypes: undefined }
      : null,
  );

  const features = map.data?.features ?? [];

  const points = useMemo<MapPoint[]>(
    () =>
      features
        .filter((feature) => !hiddenLayers.has(String(feature.properties.featureType)))
        .map((feature: GisFeature) => {
          const coordinates = feature.geometry.coordinates as number[];
          const type = String(feature.properties.featureType);
          return {
            id: feature.id,
            // GeoJSON is [longitude, latitude].
            latitude: coordinates[1],
            longitude: coordinates[0],
            label: feature.properties.label ?? type,
            detail:
              (feature.properties.description as string | undefined) ??
              [feature.properties.status, feature.properties.severity].filter(Boolean).join(' · '),
            color: LAYER_COLORS[type] ?? theme.colors.primary,
            layer: type,
            code: LAYER_CODES[type],
          };
        }),
    [features, hiddenLayers, theme.colors.primary],
  );

  const center = useMemo(() => {
    if (deepLinkCenter) return deepLinkCenter;
    if (position.fix) return { latitude: position.fix.latitude, longitude: position.fix.longitude };
    const first = features[0];
    if (first) {
      const [longitude, latitude] = first.geometry.coordinates as number[];
      return { latitude, longitude };
    }
    return { latitude: COUNTRY_VIEW.latitude, longitude: COUNTRY_VIEW.longitude };
  }, [deepLinkCenter, position.fix, features]);

  const zoom = useMemo(() => {
    if (deepLinkCenter) return 13;
    if (position.fix) return 11;
    return COUNTRY_VIEW.zoom;
  }, [deepLinkCenter, position.fix]);

  const selected = features.find((feature) => feature.id === selectedId) ?? null;

  const toggleLayer = (featureType: string) => {
    setHiddenLayers((current) => {
      const next = new Set(current);
      if (next.has(featureType)) next.delete(featureType);
      else next.add(featureType);
      return next;
    });
  };

  const openFeature = useCallback(
    (feature: GisFeature) => {
      const entityId = String(feature.properties.entityId ?? feature.id);
      const type = String(feature.properties.featureType);
      switch (type) {
        case 'EXPLOITATION_ACTIVITY':
          router.push({ pathname: '/activity/[id]', params: { id: entityId } });
          return true;
        case 'INSPECTION':
          router.push({ pathname: '/inspection/[id]', params: { id: entityId } });
          return true;
        case 'FIELD_OBSERVATION':
          router.push({ pathname: '/observation/[id]', params: { id: entityId } });
          return true;
        case 'AI_ALERT':
          router.push({ pathname: '/alert/[id]', params: { id: entityId } });
          return true;
        case 'ENVIRONMENTAL_VIOLATION':
          router.push({ pathname: '/violation/[id]', params: { id: entityId } });
          return true;
        default:
          return false;
      }
    },
    [router],
  );

  const checkIn = async () => {
    const fix = position.fix ?? (await position.refresh());
    if (!fix) {
      toast.error('No position', position.error?.message ?? 'The device could not provide a position.');
      return;
    }
    if (fix.mocked) {
      toast.error('Simulated position', 'FEMS does not record a mocked position as a field check-in.');
      return;
    }
    try {
      await recordPosition.mutateAsync({
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM ?? undefined,
        source: fix.source,
        mocked: fix.mocked,
        label: `${user?.firstName ?? 'Field'} ${user?.lastName ?? 'user'}`,
      });
      toast.success('Position recorded', `±${fix.accuracyM ? Math.round(fix.accuracyM) : '?'} m — visible to your service.`);
    } catch (error) {
      toast.error('Could not record', error instanceof ApiError ? error.message : undefined);
    }
  };

  const band = accuracyBand(position.accuracyM);

  return (
    <ToneScope tone="dark">
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {/* ------------------------------------------------------------ map */}
        <View style={{ height: '52%' }}>
          <MapCanvas
            center={center}
            zoom={zoom}
            points={points}
            tone="dark"
            userPosition={
              position.fix
                ? { latitude: position.fix.latitude, longitude: position.fix.longitude, accuracyM: position.fix.accuracyM }
                : null
            }
            onSelectPoint={(point) => setSelectedId(point.id)}
            onRegionChange={() => undefined}
          />

          <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12 }}>
            <Row justify="space-between" gap={8}>
              <Card style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10 }}>
                <Row gap={8}>
                  <Ionicons name="map-outline" size={16} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Tiny style={{ fontWeight: '700' }}>National forest register</Tiny>
                    <Tiny tone="faint">
                      {points.length} of {features.length} features · {layers.data?.total ?? '—'} in scope
                    </Tiny>
                  </View>
                </Row>
              </Card>
              <Pressable
                onPress={() => void position.refresh()}
                accessibilityRole="button"
                accessibilityLabel="Centre the map on my position"
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.pill,
                  padding: 10,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons name="locate-outline" size={18} color={position.fix ? theme.colors.success : theme.colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => setFiltersOpen((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel="Show or hide map layers"
                style={{
                  backgroundColor: filtersOpen ? theme.colors.primary : theme.colors.surface,
                  borderRadius: theme.radii.pill,
                  padding: 10,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons name="layers-outline" size={18} color={filtersOpen ? '#04170F' : theme.colors.textMuted} />
              </Pressable>
            </Row>

            {filtersOpen ? (
              <Card style={{ marginTop: 8 }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Overline>Layers</Overline>
                  <Pressable onPress={() => setHiddenLayers(new Set())} accessibilityRole="button" accessibilityLabel="Show every layer">
                    <Tiny tone="faint">show all</Tiny>
                  </Pressable>
                </Row>
                <Row gap={6} wrap>
                  {(layers.data?.layers ?? []).map((layer) => {
                    const type = String(layer.featureType);
                    const hidden = hiddenLayers.has(type);
                    return (
                      <Pressable
                        key={type}
                        onPress={() => toggleLayer(type)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: !hidden }}
                        accessibilityLabel={`${LAYER_LABELS[type] ?? type} layer, ${layer.count} features`}
                      >
                        <Row gap={6} style={{ opacity: hidden ? 0.4 : 1, marginBottom: 6 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LAYER_COLORS[type] ?? theme.colors.primary }} />
                          <Tiny>
                            {LAYER_LABELS[type] ?? humanize(type)} · {layer.count}
                          </Tiny>
                        </Row>
                      </Pressable>
                    );
                  })}
                </Row>
                <Caption tone="faint" style={{ marginTop: 4 }}>
                  Counts come from the API; a hidden layer is only hidden on this device.
                </Caption>
              </Card>
            ) : null}
          </View>

          {map.isLoading ? (
            <View style={{ position: 'absolute', bottom: 12, left: 12 }}>
              <Badge label="loading features…" tone="neutral" icon="sync-outline" />
            </View>
          ) : null}

          {params.label ? (
            <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
              <Card style={{ paddingVertical: 8 }}>
                <Tiny lines={1}>Centred on: {params.label}</Tiny>
              </Card>
            </View>
          ) : null}
        </View>

        {/* --------------------------------------------------------- panels */}
        <View style={{ flex: 1, backgroundColor: theme.colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
          <SegmentedControl
            value={panel}
            options={[
              { value: 'features', label: 'Features' },
              { value: 'nearby', label: 'Near me' },
            ]}
            onChange={(value: string) => setPanel(value === 'nearby' ? 'nearby' : 'features')}
          />

          {panel === 'features' ? (
            <FlatList
              data={points.filter((point) => !selectedId || point.id === selectedId)}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
              refreshControl={<RefreshControl refreshing={map.isRefetching} onRefresh={() => map.refetch()} tintColor={theme.colors.primary} />}
              ListHeaderComponent={
                selected ? (
                  <Card style={{ marginBottom: 10 }}>
                    <Row justify="space-between" style={{ marginBottom: 6 }}>
                      <Overline>{humanize(String(selected.properties.featureType))}</Overline>
                      <Pressable onPress={() => setSelectedId(null)} accessibilityRole="button" accessibilityLabel="Close the selected feature">
                        <Ionicons name="close-outline" size={16} color={theme.colors.textMuted} />
                      </Pressable>
                    </Row>
                    <Body style={{ fontWeight: '700', marginBottom: 4 }}>{selected.properties.label}</Body>
                    {selected.properties.description ? <Caption tone="muted">{String(selected.properties.description)}</Caption> : null}
                    <Row gap={8} wrap style={{ marginTop: 8 }}>
                      {selected.properties.status ? <Badge label={String(selected.properties.status)} tone="neutral" compact /> : null}
                      {selected.properties.severity ? <Badge label={String(selected.properties.severity)} tone="warning" compact /> : null}
                      {selected.properties.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                      {selected.properties.recordedAt ? (
                        <Tiny tone="faint">recorded {formatRelative(String(selected.properties.recordedAt), 'en')}</Tiny>
                      ) : null}
                    </Row>
                    <Row gap={8} style={{ marginTop: 10 }}>
                      <Button
                        label="Open record"
                        size="sm"
                        disabled={!['EXPLOITATION_ACTIVITY', 'INSPECTION', 'FIELD_OBSERVATION', 'AI_ALERT', 'ENVIRONMENTAL_VIOLATION'].includes(
                          String(selected.properties.featureType),
                        )}
                        onPress={() => {
                          if (!openFeature(selected)) toast.info('No detail screen', 'This feature type is shown on the map and in the forest register only.');
                        }}
                      />
                      <Button
                        label="Centre"
                        size="sm"
                        variant="secondary"
                        icon="locate-outline"
                        onPress={() => {
                          setFocusId(selected.id);
                          toast.info('Centred', selected.properties.label);
                        }}
                      />
                    </Row>
                    <Tiny tone="faint" style={{ marginTop: 8 }}>
                      {(() => {
                        const [longitude, latitude] = selected.geometry.coordinates as number[];
                        return `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · source ${String(selected.properties.source ?? 'register')}`;
                      })()}
                    </Tiny>
                  </Card>
                ) : null
              }
              ListEmptyComponent={
                map.isLoading ? (
                  <SkeletonList rows={4} />
                ) : map.isError ? (
                  <ErrorState error={map.error} onRetry={() => map.refetch()} />
                ) : (
                  <Card>
                    <Caption tone="muted">
                      No feature matches the current layers. Enable a layer above, or open the forest register for the full catalogue.
                    </Caption>
                  </Card>
                )
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setSelectedId(item.id);
                    setFocusId(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}, ${item.layer}`}
                  style={({ pressed }) => ({ marginBottom: 8, opacity: pressed ? 0.85 : 1 })}
                >
                  <Card>
                    <Row gap={10}>
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: item.color, alignItems: 'center', justifyContent: 'center' }}>
                        <Tiny style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 9 }}>{item.code}</Tiny>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontWeight: '600' }} lines={1}>
                          {item.label}
                        </Body>
                        <Tiny tone="faint">
                          {LAYER_LABELS[item.layer] ?? item.layer} · {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                        </Tiny>
                      </View>
                      <Ionicons name="chevron-forward-outline" size={16} color={theme.colors.textFaint} />
                    </Row>
                  </Card>
                </Pressable>
              )}
            />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }} refreshControl={<RefreshControl refreshing={position.loading} onRefresh={() => void position.refresh()} tintColor={theme.colors.primary} />}>
              <Card style={{ marginBottom: 10 }}>
                <Row justify="space-between" style={{ marginBottom: 8 }}>
                  <Overline>Your device position</Overline>
                  <Badge label={band.label} tone={band.tone === 'good' ? 'success' : band.tone === 'fair' ? 'warning' : 'danger'} />
                </Row>
                {position.fix ? (
                  <>
                    <Body style={{ fontWeight: '700', marginBottom: 4 }}>
                      {position.fix.latitude.toFixed(6)}, {position.fix.longitude.toFixed(6)}
                    </Body>
                    <Caption tone="muted">
                      Captured {formatDateTime(position.fix.capturedAt, 'en')} from {position.fix.source === 'DEVICE_GPS' ? 'device GPS' : position.fix.source}
                      {position.fix.mocked ? ' — flagged as simulated' : ''}.
                    </Caption>
                    <Row gap={8} wrap style={{ marginTop: 10 }}>
                      <Button label="Search near me" size="sm" icon="search-outline" loading={nearby.isFetching} onPress={() => setSearchNearby(true)} />
                      <Button label="Record check-in" size="sm" variant="secondary" icon="pin-outline" loading={recordPosition.isPending} onPress={() => void checkIn()} />
                    </Row>
                  </>
                ) : (
                  <>
                    <Notice tone="warning" title="Waiting for a position">
                      {position.error?.message ??
                        'FEMS uses the position the device reports. There is no default location — allow location access and try again.'}
                    </Notice>
                    <Button label="Get position" size="sm" icon="navigate-outline" loading={position.loading} onPress={() => void position.refresh()} />
                  </>
                )}
              </Card>

              <Row gap={8} wrap style={{ marginBottom: 10 }}>
                {NEARBY_RADII.map((radius) => (
                  <Chip
                    key={radius}
                    label={`${radius} km`}
                    selected={radiusKm === radius}
                    onPress={() => {
                      setRadiusKm(radius);
                      setSearchNearby(true);
                    }}
                  />
                ))}
              </Row>

              {nearby.isFetching ? <LoadingBlock label="Searching the register…" /> : null}

              {nearby.data ? (
                <>
                  <Row justify="space-between" style={{ marginBottom: 8 }}>
                    <Caption tone="muted">
                      {nearby.data.results.length} feature(s) within {nearby.data.radiusKm} km
                    </Caption>
                    {hasPermission('gis:read') ? (
                      <Pressable onPress={() => setSearchNearby(false)} accessibilityRole="button" accessibilityLabel="Clear the nearby search">
                        <Tiny tone="faint">clear</Tiny>
                      </Pressable>
                    ) : null}
                  </Row>
                  {nearby.data.results.length === 0 ? (
                    <Card>
                      <Caption tone="muted">Nothing recorded within {nearby.data.radiusKm} km of your position.</Caption>
                    </Card>
                  ) : (
                    nearby.data.results.map((entry) => (
                      <Card key={entry.id} style={{ marginBottom: 8 }}>
                        <Row gap={10}>
                          <View
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 13,
                              backgroundColor: LAYER_COLORS[entry.featureType] ?? theme.colors.primary,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Tiny style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 9 }}>{LAYER_CODES[entry.featureType]}</Tiny>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Body style={{ fontWeight: '600' }} lines={1}>
                              {entry.label}
                            </Body>
                            <Tiny tone="faint">
                              {LAYER_LABELS[entry.featureType] ?? entry.featureType} · {entry.distanceKm.toFixed(2)} km away
                              {entry.recordedAt ? ` · ${formatRelative(entry.recordedAt, 'en')}` : ''}
                            </Tiny>
                          </View>
                        </Row>
                      </Card>
                    ))
                  )}
                </>
              ) : (
                <Card>
                  <Caption tone="muted">
                    The nearby search asks the API for everything recorded around the device position — forests, zones, activities, inspections, observations,
                    cases and alerts — and returns the distance it computed on the server.
                  </Caption>
                </Card>
              )}
            </ScrollView>
          )}
        </View>

        {statistics.data ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8 }}>
            <Row gap={8} wrap>
              <StatTile label="Forests" value={statistics.data.forests} icon="leaf-outline" />
              <StatTile label="Zones" value={statistics.data.zones} icon="grid-outline" />
              <StatTile label="Check-ins" value={statistics.data.fieldCheckins} icon="pin-outline" />
              {statistics.data.forestsWithoutBoundary > 0 ? (
                <StatTile label="No boundary" value={statistics.data.forestsWithoutBoundary} icon="help-circle-outline" tone="warning" />
              ) : null}
            </Row>
          </View>
        ) : null}
      </View>
    </ToneScope>
  );
}
