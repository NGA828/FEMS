/**
 * Native map canvas — react-native-maps.
 *
 * Same props as the web canvas, so the GIS screen is written once. Markers are
 * rendered as pins in the layer colour with a short code, the device position is
 * drawn with its accuracy circle, and a tap reports the feature id back to React.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, UrlTile, type Region } from 'react-native-maps';
import { DEFAULT_TILE_URL, deltasForZoom, type MapCanvasProps, type MapPoint } from './types';

/** `{z}/{x}/{y}` is a Leaflet template; react-native-maps expects `{z}/{x}/{y}` too. */
const TILE_TEMPLATE = DEFAULT_TILE_URL;

export function MapCanvas({
  center,
  zoom,
  points,
  userPosition,
  onSelectPoint,
  onRegionChange,
  style,
  tone = 'dark',
}: MapCanvasProps & { tone?: 'light' | 'dark' }) {
  const mapRef = useRef<MapView | null>(null);
  const { latitudeDelta, longitudeDelta } = useMemo(() => deltasForZoom(zoom), [zoom]);

  // Follow the host centre when it changes (deep links, "my position", nearby results).
  useEffect(() => {
    mapRef.current?.animateToRegion({ latitude: center.latitude, longitude: center.longitude, latitudeDelta, longitudeDelta }, 450);
  }, [center.latitude, center.longitude, latitudeDelta, longitudeDelta]);

  const initialRegion = useMemo<Region>(
    () => ({ latitude: center.latitude, longitude: center.longitude, latitudeDelta, longitudeDelta }),
    // The initial region must not change after mount, or the map fights the user's pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View style={[styles.container, style as object]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChangeComplete={(region) => onRegionChange?.(region)}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass
        toolbarEnabled={false}
        rotateEnabled={false}
        mapType={tone === 'dark' ? 'standard' : 'standard'}
        loadingEnabled
        loadingBackgroundColor={tone === 'dark' ? '#05120E' : '#EDF3EC'}
        loadingIndicatorColor="#16653F"
      >
        {TILE_TEMPLATE === DEFAULT_TILE_URL ? null : <UrlTile urlTemplate={TILE_TEMPLATE} maximumZ={19} />}

        {userPosition ? (
          <>
            <Circle
              center={{ latitude: userPosition.latitude, longitude: userPosition.longitude }}
              radius={userPosition.accuracyM ?? 25}
              strokeColor="rgba(29,111,165,0.4)"
              fillColor="rgba(29,111,165,0.18)"
            />
            <Marker
              coordinate={{ latitude: userPosition.latitude, longitude: userPosition.longitude }}
              title="Your position"
              description={
                userPosition.accuracyM
                  ? `Accuracy ±${Math.round(userPosition.accuracyM)} m, captured by this device`
                  : 'Captured by this device'
              }
              pinColor="#1D6FA5"
              zIndex={1000}
            />
          </>
        ) : null}

        {points.map((point: MapPoint) => (
          <Marker
            key={point.id}
            coordinate={{ latitude: point.latitude, longitude: point.longitude }}
            title={point.label}
            description={point.detail}
            onCalloutPress={() => onSelectPoint?.(point)}
            onPress={() => onSelectPoint?.(point)}
          >
            <View style={[styles.pin, { backgroundColor: point.color }]}>
              <Text style={styles.pinText}>{point.code ?? ''}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 240, overflow: 'hidden' },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  pinText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
});

export default MapCanvas;
