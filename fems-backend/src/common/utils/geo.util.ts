import { BadRequestException } from '@nestjs/common';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Haversine great-circle distance in kilometres.
 * Used for "nearby" searches, inspection proximity checks and alert containment.
 */
export function haversineDistanceKm(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance in metres — used to compare a device fix with the target location. */
export function haversineDistanceMeters(from: Coordinate, to: Coordinate): number {
  return haversineDistanceKm(from, to) * 1000;
}

/**
 * SQL fragment (MySQL) implementing the Haversine formula with bound parameters.
 * Returns: `ROUND(6371.0088 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(<latColumn>)) * ...)), 2)`
 */
export function haversineSql(latColumn: string, lngColumn: string): string {
  return (
    `ROUND(6371.0088 * ACOS(LEAST(1, ` +
    `COS(RADIANS(?)) * COS(RADIANS(${latColumn})) * COS(RADIANS(${lngColumn}) - RADIANS(?)) + ` +
    `SIN(RADIANS(?)) * SIN(RADIANS(${latColumn}))` +
    `)), 2)`
  );
}

/** Bounding box for a radius query — used to pre-filter rows with an index. */
export function boundingBox(center: Coordinate, radiusKm: number) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(0.01, Math.cos(toRadians(center.latitude))));
  return {
    minLat: center.latitude - latDelta,
    maxLat: center.latitude + latDelta,
    minLng: center.longitude - lngDelta,
    maxLng: center.longitude + lngDelta,
  };
}

export function isValidLatitude(value: unknown): boolean {
  const latitude = Number(value);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

export function isValidLongitude(value: unknown): boolean {
  const longitude = Number(value);
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

/** Throws a 400 with a stable error code when coordinates are out of range. */
export function assertCoordinates(latitude: unknown, longitude: unknown, label = 'coordinates'): Coordinate {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    throw new BadRequestException({
      code: 'INVALID_COORDINATES',
      message: `${label}: latitude must be between -90 and 90 and longitude between -180 and 180.`,
      details: { latitude, longitude },
    });
  }
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

/**
 * Device GPS accuracy policy used by field operations:
 *  - <= MAX_ACCURACY_M          : accepted as-is
 *  - <= MAX_ACCURACY_WITH_WARN  : accepted, flagged
 *  - above                      : rejected, the operator must retry the fix
 */
export const GPS_MAX_ACCURACY_M = 50;
export const GPS_WARN_ACCURACY_M = 25;

export function evaluateGpsAccuracy(accuracyM: number | null | undefined): {
  accepted: boolean;
  warning: string | null;
} {
  if (accuracyM === null || accuracyM === undefined || Number.isNaN(Number(accuracyM))) {
    return { accepted: true, warning: 'GPS accuracy was not reported by the device.' };
  }
  const accuracy = Number(accuracyM);
  if (accuracy > GPS_MAX_ACCURACY_M) {
    return {
      accepted: false,
      warning: `GPS accuracy of ${accuracy.toFixed(1)} m is too low (maximum ${GPS_MAX_ACCURACY_M} m). Move to open sky and capture again.`,
    };
  }
  if (accuracy > GPS_WARN_ACCURACY_M) {
    return {
      accepted: true,
      warning: `GPS accuracy is ${accuracy.toFixed(1)} m — acceptable but not optimal.`,
    };
  }
  return { accepted: true, warning: null };
}

/** Ray-casting point-in-polygon test for GeoJSON boundaries stored on zones/areas. */
export function isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersects = yi > point.latitude !== yj > point.latitude
      && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Parses a stored GeoJSON boundary (`{"type":"Polygon","coordinates":[[[lng,lat],...]]}`). */
export function parseGeoJsonBoundary(raw: string | null | undefined): Coordinate[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      coordinates?: number[][][] | number[][];
    };
    const ring = parsed.type === 'Polygon' ? (parsed.coordinates as number[][][])?.[0] : undefined;
    if (!ring || !Array.isArray(ring)) return null;
    return ring.map(([longitude, latitude]) => ({ latitude: Number(latitude), longitude: Number(longitude) }));
  } catch {
    return null;
  }
}

/** For the notification/report layer: "12.4 km north-east of Mbalmayo". */
export function describeDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
