/**
 * Web map canvas — Leaflet.
 *
 * The map runs inside a same-origin iframe. That is deliberate: Leaflet needs a
 * real DOM document and its own stylesheet, and loading it into an isolated
 * document keeps the app bundle free of global CSS while still using the exact
 * Leaflet build that ships in `node_modules` (served by the dev server, and by the
 * API in production — see the note in `docs/ARCHITECTURE.md`).
 *
 * The parent and the iframe talk over `postMessage` with a small, explicit
 * protocol so a marker tap can open the matching FEMS record in React:
 *
 *   parent → iframe   fems:data    replace the markers / recentre
 *                     fems:focus   fly to one marker
 *   iframe → parent   fems:ready   Leaflet finished loading
 *                     fems:select  a marker was tapped (feature id)
 *                     fems:move    the user panned or zoomed
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, type ViewStyle } from 'react-native';
import { DEFAULT_ATTRIBUTION, DEFAULT_TILE_URL, type MapCanvasProps, type MapPoint } from './types';

interface LeafletMessage {
  source: 'fems-map';
  type: 'ready' | 'select' | 'move' | 'error';
  id?: string;
  latitude?: number;
  longitude?: number;
  zoom?: number;
  message?: string;
}

/** Builds the iframe document. Kept as a string so it cannot be tree-shaken or hoisted. */
function buildDocument(tileUrl: string, attribution: string, dark: boolean): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="stylesheet" href="/node_modules/leaflet/dist/leaflet.css" />
    <style>
      html, body { margin: 0; height: 100%; background: ${dark ? '#05120E' : '#EDF3EC'}; }
      #map { position: absolute; inset: 0; background: ${dark ? '#05120E' : '#EDF3EC'}; }
      .leaflet-container { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .fems-label {
        background: ${dark ? 'rgba(11,31,25,.92)' : 'rgba(255,255,255,.94)'};
        color: ${dark ? '#EAF5EF' : '#10241B'};
        border: 1px solid ${dark ? '#2C5748' : '#C9D8CD'};
        border-radius: 6px; padding: 3px 7px; font-size: 11px; font-weight: 600; white-space: nowrap;
        box-shadow: 0 6px 18px rgba(0,0,0,.28);
      }
      .fems-label small { display: block; font-weight: 500; opacity: .72; }
      .leaflet-popup-content-wrapper, .leaflet-popup-tip {
        background: ${dark ? '#0B1F19' : '#FFFFFF'}; color: ${dark ? '#EAF5EF' : '#10241B'};
        border: 1px solid ${dark ? '#1C3B31' : '#E1E8DE'};
      }
      .leaflet-bar a { background: ${dark ? '#0B1F19' : '#FFFFFF'}; color: ${dark ? '#EAF5EF' : '#10241B'}; border-color: ${dark ? '#1C3B31' : '#E1E8DE'}; }
      .leaflet-control-attribution {
        background: ${dark ? 'rgba(5,18,14,.8)' : 'rgba(255,255,255,.82)'};
        color: ${dark ? '#86988C' : '#556B5F'}; font-size: 10px;
      }
      .leaflet-control-attribution a { color: ${dark ? '#86988C' : '#556B5F'}; }
      .pin {
        width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: 9px; font-weight: 800; letter-spacing: .2px;
        border: 2px solid ${dark ? '#05120E' : '#FFFFFF'}; box-shadow: 0 4px 12px rgba(0,0,0,.35);
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="/node_modules/leaflet/dist/leaflet.js"></script>
    <script>
      (function () {
        var post = function (payload) { parent.postMessage(Object.assign({ source: 'fems-map' }, payload), '*'); };
        if (!window.L) { post({ type: 'error', message: 'Leaflet could not be loaded.' }); return; }

        var map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
        L.tileLayer(${JSON.stringify(tileUrl)}, {
          attribution: ${JSON.stringify(attribution)},
          maxZoom: 19,
          crossOrigin: true
        }).addTo(map);

        // A neutral grid keeps the map readable if tiles cannot be fetched.
        var layer = L.layerGroup().addTo(map);
        var userLayer = L.layerGroup().addTo(map);
        var byId = {};

        function label(point) {
          var html = '<span class="fems-label">' + escapeHtml(point.label) +
            (point.detail ? '<small>' + escapeHtml(point.detail) + '</small>' : '') + '</span>';
          return L.divIcon({
            className: '',
            html: '<div class="pin" style="background:' + point.color + '">' + escapeHtml(point.code || '') + '</div>',
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          });
        }

        function escapeHtml(value) {
          return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
          });
        }

        map.on('moveend', function () {
          var c = map.getCenter();
          post({ type: 'move', latitude: c.lat, longitude: c.lng, zoom: map.getZoom() });
        });

        window.addEventListener('message', function (event) {
          var data = event.data;
          if (!data || data.source !== 'fems-host') return;

          if (data.type === 'data') {
            layer.clearLayers();
            byId = {};
            (data.points || []).forEach(function (point) {
              var marker = L.marker([point.latitude, point.longitude], { icon: label(point), title: point.label });
              marker.bindPopup('<strong>' + escapeHtml(point.label) + '</strong>' +
                (point.detail ? '<br/>' + escapeHtml(point.detail) : ''));
              marker.on('click', function () { post({ type: 'select', id: point.id }); });
              marker.addTo(layer);
              byId[point.id] = marker;
            });

            userLayer.clearLayers();
            if (data.userPosition) {
              L.circle([data.userPosition.latitude, data.userPosition.longitude], {
                radius: data.userPosition.accuracyM || 25,
                color: '#1D6FA5', weight: 1, fillColor: '#1D6FA5', fillOpacity: 0.18
              }).addTo(userLayer);
              L.circleMarker([data.userPosition.latitude, data.userPosition.longitude], {
                radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#1D6FA5', fillOpacity: 1
              }).addTo(userLayer);
            }

            if (data.bounds) {
              map.fitBounds([[data.bounds.south, data.bounds.west], [data.bounds.north, data.bounds.east]], { padding: [24, 24], maxZoom: 12 });
            } else if (data.center) {
              map.setView([data.center.latitude, data.center.longitude], data.zoom || map.getZoom());
            }
          }

          if (data.type === 'focus' && byId[data.id]) {
            var marker = byId[data.id];
            map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
            marker.openPopup();
          }

          if (data.type === 'invalidate') {
            setTimeout(function () { map.invalidateSize(); }, 60);
          }
        });

        // First message may arrive before this script runs; ask the host to resend.
        post({ type: 'ready' });
        map.whenReady(function () { setTimeout(function () { map.invalidateSize(); }, 40); });
      })();
    </script>
  </body>
</html>`;
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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const pendingFocus = useRef<string | null>(null);

  const document_ = useMemo(() => buildDocument(tileUrl, attribution, tone === 'dark'), [tileUrl, attribution, tone]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ source: 'fems-host', ...payload }, '*');
  }, []);

  const pushData = useCallback(() => {
    send({
      type: 'data',
      points: points.map((point: MapPoint) => ({
        id: point.id,
        latitude: point.latitude,
        longitude: point.longitude,
        label: point.label,
        detail: point.detail,
        color: point.color,
        code: point.code,
      })),
      center,
      zoom,
      userPosition: userPosition
        ? { latitude: userPosition.latitude, longitude: userPosition.longitude, accuracyM: userPosition.accuracyM ?? null }
        : null,
    });
  }, [send, points, center, zoom, userPosition]);

  // Push data whenever the host state changes (markers are diffed inside Leaflet).
  useEffect(() => {
    if (readyRef.current) pushData();
  }, [pushData]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<LeafletMessage>) => {
      const data = event.data;
      if (!data || data.source !== 'fems-map') return;

      if (data.type === 'ready') {
        readyRef.current = true;
        pushData();
        if (pendingFocus.current) {
          send({ type: 'focus', id: pendingFocus.current });
          pendingFocus.current = null;
        }
        return;
      }
      if (data.type === 'select' && data.id && onSelectPoint) {
        const point = points.find((candidate) => candidate.id === data.id);
        if (point) onSelectPoint(point);
        return;
      }
      if (data.type === 'move' && onRegionChange && data.latitude !== undefined && data.longitude !== undefined) {
        const span = 360 / 2 ** (data.zoom ?? zoom);
        onRegionChange({
          latitude: data.latitude,
          longitude: data.longitude,
          latitudeDelta: span,
          longitudeDelta: span * 1.6,
        });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelectPoint, onRegionChange, points, pushData, send, zoom]);

  const frameStyle: ViewStyle = {
    borderWidth: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  };

  // react-native-web renders a plain DOM node: an iframe keeps Leaflet's global
  // CSS and DOM assumptions out of the application document.
  return (
    <View style={[{ flex: 1, minHeight: 240, overflow: 'hidden' }, style as ViewStyle]}>
      {React.createElement('iframe', {
        ref: (node: HTMLIFrameElement | null) => {
          frameRef.current = node;
        },
        srcDoc: document_,
        title: 'FEMS map',
        style: frameStyle,
        sandbox: 'allow-scripts allow-same-origin',
        loading: 'eager',
      })}
    </View>
  );
}

export default MapCanvas;
