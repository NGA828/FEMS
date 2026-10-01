/**
 * Web map canvas — Leaflet bundled with the app.
 *
 * Keeping Leaflet in the application bundle avoids relying on the development
 * server to expose files under node_modules, which it does not do.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_ATTRIBUTION, DEFAULT_TILE_URL, type MapCanvasProps, type MapPoint } from './types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export function MapCanvas({
  center,
  zoom,
  points,
  userPosition,
  onSelectPoint,
  onRegionChange,
  tileUrl = DEFAULT_TILE_URL,
  attribution = DEFAULT_ATTRIBUTION,
  style,
  tone = 'dark',
}: MapCanvasProps & { tone?: 'light' | 'dark' }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pointsLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectPointRef = useRef(onSelectPoint);
  const onRegionChangeRef = useRef(onRegionChange);
  const [mapVersion, setMapVersion] = useState(0);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  onSelectPointRef.current = onSelectPoint;
  onRegionChangeRef.current = onRegionChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, { zoomControl: true, attributionControl: true, preferCanvas: true });
    mapRef.current = map;
    const background = tone === 'dark' ? '#05120E' : '#EDF3EC';
    container.style.backgroundColor = background;
    map.setView([center.latitude, center.longitude], zoom);

    const tiles = L.tileLayer(tileUrl, { attribution, maxZoom: 19, crossOrigin: true });
    tiles.on('tileerror', () => setTilesUnavailable(true));
    tiles.on('tileload', () => setTilesUnavailable(false));
    tiles.addTo(map);

    pointsLayerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const current = map.getCenter();
      const currentZoom = map.getZoom();
      const latitudeDelta = 360 / 2 ** currentZoom;
      onRegionChangeRef.current?.({
        latitude: current.lat,
        longitude: current.lng,
        latitudeDelta,
        longitudeDelta: latitudeDelta * 1.6,
      });
    });

    const invalidateSize = () => map.invalidateSize({ pan: false });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidateSize);
    resizeObserver?.observe(container);
    window.addEventListener('resize', invalidateSize);
    const resizeTimer = window.setTimeout(invalidateSize, 60);
    setMapVersion((version) => version + 1);

    return () => {
      window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', invalidateSize);
      map.remove();
      mapRef.current = null;
      pointsLayerRef.current = null;
      userLayerRef.current = null;
    };
    // The map is rebuilt only when its tile source or palette changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attribution, tileUrl, tone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([center.latitude, center.longitude], zoom);
  }, [center.latitude, center.longitude, mapVersion, zoom]);

  useEffect(() => {
    const layer = pointsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    points.forEach((point: MapPoint) => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:800;border:2px solid ${tone === 'dark' ? '#05120E' : '#FFFFFF'};box-shadow:0 4px 12px rgba(0,0,0,.35);background:${escapeHtml(point.color)}">${escapeHtml(point.code ?? '')}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const marker = L.marker([point.latitude, point.longitude], { icon, title: point.label });
      marker.bindPopup(
        `<strong>${escapeHtml(point.label)}</strong>${point.detail ? `<br/>${escapeHtml(point.detail)}` : ''}`,
      );
      marker.on('click', () => onSelectPointRef.current?.(point));
      marker.addTo(layer);
    });
  }, [mapVersion, points]);

  useEffect(() => {
    const layer = userLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!userPosition) return;

    L.circle([userPosition.latitude, userPosition.longitude], {
      radius: userPosition.accuracyM ?? 25,
      color: '#1D6FA5',
      weight: 1,
      fillColor: '#1D6FA5',
      fillOpacity: 0.18,
    }).addTo(layer);
    L.circleMarker([userPosition.latitude, userPosition.longitude], {
      radius: 6,
      color: '#FFFFFF',
      weight: 2,
      fillColor: '#1D6FA5',
      fillOpacity: 1,
    }).addTo(layer);
  }, [mapVersion, userPosition]);

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  };

  return (
    <View style={[{ flex: 1, minHeight: 240, overflow: 'hidden' }, style as ViewStyle]}>
      {React.createElement('div', { ref: containerRef, className: 'fems-map-container', style: containerStyle })}
      {tilesUnavailable ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 8,
            padding: 8,
            borderRadius: 8,
            backgroundColor: tone === 'dark' ? 'rgba(5,18,14,0.88)' : 'rgba(255,255,255,0.92)',
          }}
        >
          <span style={{ color: tone === 'dark' ? '#E8F5EE' : '#10241B', fontSize: 12 }}>
            Map tiles are unavailable. Feature locations are still listed below.
          </span>
        </View>
      ) : null}
    </View>
  );
}

export default MapCanvas;
