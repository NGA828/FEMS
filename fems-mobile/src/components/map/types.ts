/**
 * Shared contract for the two map canvases.
 *
 * `MapCanvas.web.tsx` renders the map with Leaflet inside the browser preview;
 * `MapCanvas.tsx` renders it with react-native-maps on iOS and Android. Both take
 * exactly the same props so the GIS screen is written once.
 */
export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  /** Sub-label shown in the callout: status, severity, date… */
  detail?: string;
  color: string;
  /** Layer key, used by the screen to toggle visibility. */
  layer: string;
  /** Rendered inside the marker (emoji-free: a short code such as "PER"). */
  code?: string;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapCanvasProps {
  /** Map centre. */
  center: { latitude: number; longitude: number };
  /** Leaflet zoom (web) / derived delta (native). */
  zoom: number;
  points: MapPoint[];
  /** Device position, drawn as an accuracy circle. */
  userPosition?: { latitude: number; longitude: number; accuracyM?: number | null } | null;
  onSelectPoint?: (point: MapPoint) => void;
  onRegionChange?: (region: MapRegion) => void;
  /** Tile template. Defaults to OpenStreetMap; override for a national tile server. */
  tileUrl?: string;
  attribution?: string;
  style?: { flex?: number; height?: number; borderRadius?: number } | object;
}

/** Tile source. Deployments serving their own tiles set EXPO_PUBLIC_MAP_TILE_URL. */
export const DEFAULT_TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const DEFAULT_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ?? '© OpenStreetMap contributors — FEMS forest register';

/** Colour per GIS feature type, shared by the map, the legend and the list rows. */
export const LAYER_COLORS: Record<string, string> = {
  FOREST: '#2F7D4F',
  FOREST_ZONE: '#5FA777',
  PROTECTED_AREA: '#1F7A8C',
  EXPLOITATION_ACTIVITY: '#C97B18',
  INSPECTION: '#4C6EF5',
  FIELD_OBSERVATION: '#8E44AD',
  AI_ALERT: '#E8590C',
  ENVIRONMENTAL_VIOLATION: '#C2255C',
  COMPANY_SITE: '#6B7280',
  USER_CHECKIN: '#0B7285',
};

export const LAYER_CODES: Record<string, string> = {
  FOREST: 'FOR',
  FOREST_ZONE: 'ZON',
  PROTECTED_AREA: 'PA',
  EXPLOITATION_ACTIVITY: 'ACT',
  INSPECTION: 'INS',
  FIELD_OBSERVATION: 'OBS',
  AI_ALERT: 'ALR',
  ENVIRONMENTAL_VIOLATION: 'VIO',
  COMPANY_SITE: 'CMP',
  USER_CHECKIN: 'GPS',
};

export const LAYER_LABELS: Record<string, string> = {
  FOREST: 'Forests',
  FOREST_ZONE: 'Zones',
  PROTECTED_AREA: 'Protected areas',
  EXPLOITATION_ACTIVITY: 'Activities',
  INSPECTION: 'Inspections',
  FIELD_OBSERVATION: 'Observations',
  AI_ALERT: 'AI alerts',
  ENVIRONMENTAL_VIOLATION: 'Cases',
  COMPANY_SITE: 'Company sites',
  USER_CHECKIN: 'Field check-ins',
};

/** Latitude/longitude deltas matching a Leaflet zoom level (Web Mercator). */
export function deltasForZoom(zoom: number): { latitudeDelta: number; longitudeDelta: number } {
  const scale = 360 / 2 ** zoom;
  return { latitudeDelta: scale, longitudeDelta: scale * 1.6 };
}

/** Inverse of {@link deltasForZoom}: the closest Web Mercator zoom for a delta. */
export function zoomForDelta(latitudeDelta: number): number {
  if (!latitudeDelta || latitudeDelta <= 0) return 6;
  return Math.max(2, Math.min(18, Math.round(Math.log2(360 / latitudeDelta))));
}
