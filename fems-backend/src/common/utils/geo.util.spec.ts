import { BadRequestException } from '@nestjs/common';
import {
  assertCoordinates,
  boundingBox,
  describeDistance,
  evaluateGpsAccuracy,
  haversineDistanceKm,
  haversineDistanceMeters,
  haversineSql,
  isPointInPolygon,
  isValidLatitude,
  isValidLongitude,
  parseGeoJsonBoundary,
} from './geo.util';

describe('geo.util — Haversine distance', () => {
  it('returns zero for identical points', () => {
    expect(haversineDistanceKm({ latitude: 3.848, longitude: 11.5021 }, { latitude: 3.848, longitude: 11.5021 })).toBe(0);
  });

  it('matches the known great-circle distance Yaoundé → Douala (~194 km)', () => {
    const distance = haversineDistanceKm(
      { latitude: 3.848, longitude: 11.5021 },
      { latitude: 4.0511, longitude: 9.7679 },
    );
    expect(distance).toBeGreaterThan(190);
    expect(distance).toBeLessThan(200);
  });

  it('matches the known distance Yaoundé → Mbalmayo (~40 km)', () => {
    const distance = haversineDistanceKm(
      { latitude: 3.848, longitude: 11.5021 },
      { latitude: 3.5167, longitude: 11.5 },
    );
    expect(distance).toBeGreaterThan(35);
    expect(distance).toBeLessThan(45);
  });

  it('is symmetric and never negative', () => {
    const yaounde = { latitude: 3.848, longitude: 11.5021 };
    const bertoua = { latitude: 4.5771, longitude: 13.6846 };
    const forward = haversineDistanceKm(yaounde, bertoua);
    const backward = haversineDistanceKm(bertoua, yaounde);
    expect(forward).toBeCloseTo(backward, 9);
    expect(forward).toBeGreaterThan(0);
  });

  it('handles antipodal and cross-equator pairs without floating-point NaN', () => {
    const antipodal = haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(Number.isFinite(antipodal)).toBe(true);
    expect(antipodal).toBeCloseTo(20015, 0);
    expect(haversineDistanceMeters({ latitude: -1, longitude: -1 }, { latitude: 1, longitude: 1 })).toBeGreaterThan(0);
  });

  it('exposes a SQL fragment using the same formula and three bound parameters', () => {
    const sql = haversineSql('latitude', 'longitude');
    expect(sql).toContain('RADIANS(latitude)');
    expect(sql).toContain('RADIANS(longitude)');
    expect(sql).toContain('ACOS(LEAST(1,');
    expect((sql.match(/\?/g) ?? []).length).toBe(3);
  });
});

describe('geo.util — coordinate validation', () => {
  it('accepts valid latitudes and longitudes, including the poles and antimeridian', () => {
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLatitude('3.848')).toBe(true);
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(-90.5)).toBe(false);
    expect(isValidLongitude(180.1)).toBe(false);
    expect(isValidLatitude('abc')).toBe(false);
    expect(isValidLongitude(Number.NaN)).toBe(false);
  });

  it('throws a 400 with INVALID_COORDINATES for bad input', () => {
    expect(() => assertCoordinates(120, 11)).toThrow(BadRequestException);
    try {
      assertCoordinates(3.8, 200, 'harvest point');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as { code: string; message: string };
      expect(response.code).toBe('INVALID_COORDINATES');
      expect(response.message).toContain('harvest point');
    }
  });

  it('returns numeric coordinates when valid', () => {
    expect(assertCoordinates('3.848', '11.5021')).toEqual({ latitude: 3.848, longitude: 11.5021 });
  });
});

describe('geo.util — device GPS accuracy policy', () => {
  it('accepts an accurate fix without warnings', () => {
    expect(evaluateGpsAccuracy(8)).toEqual({ accepted: true, warning: null });
  });

  it('accepts a marginal fix but warns', () => {
    const result = evaluateGpsAccuracy(35);
    expect(result.accepted).toBe(true);
    expect(result.warning).toContain('35.0 m');
  });

  it('rejects a fix that is too imprecise', () => {
    const result = evaluateGpsAccuracy(180);
    expect(result.accepted).toBe(false);
    expect(result.warning).toContain('too low');
  });

  it('flags a device that does not report accuracy', () => {
    const result = evaluateGpsAccuracy(null);
    expect(result.accepted).toBe(true);
    expect(result.warning).toMatch(/not reported/i);
  });
});

describe('geo.util — spatial helpers', () => {
  const polygon = [
    { latitude: 3.4, longitude: 11.4 },
    { latitude: 3.6, longitude: 11.4 },
    { latitude: 3.6, longitude: 11.7 },
    { latitude: 3.4, longitude: 11.7 },
  ];

  it('detects a point inside a polygon and rejects one outside', () => {
    expect(isPointInPolygon({ latitude: 3.5, longitude: 11.5 }, polygon)).toBe(true);
    expect(isPointInPolygon({ latitude: 3.9, longitude: 11.5 }, polygon)).toBe(false);
  });

  it('parses a stored GeoJSON polygon ring into coordinates', () => {
    const raw = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[11.4, 3.4], [11.7, 3.4], [11.7, 3.6], [11.4, 3.6], [11.4, 3.4]]],
    });
    const parsed = parseGeoJsonBoundary(raw);
    expect(parsed).toHaveLength(5);
    expect(parsed?.[1]).toEqual({ latitude: 3.4, longitude: 11.7 });
  });

  it('returns null for malformed boundaries instead of throwing', () => {
    expect(parseGeoJsonBoundary('not-json')).toBeNull();
    expect(parseGeoJsonBoundary(null)).toBeNull();
    expect(parseGeoJsonBoundary(JSON.stringify({ type: 'Point', coordinates: [11, 3] }))).toBeNull();
  });

  it('builds a bounding box that contains the search radius', () => {
    const box = boundingBox({ latitude: 3.848, longitude: 11.5021 }, 25);
    expect(box.minLat).toBeLessThan(3.848);
    expect(box.maxLat).toBeGreaterThan(3.848);
    expect(box.minLng).toBeLessThan(11.5021);
    expect(box.maxLng).toBeGreaterThan(11.5021);
    // One degree of latitude is ~111 km, so 25 km is at least 0.2 degrees.
    expect(3.848 - box.minLat).toBeGreaterThan(0.2);
  });

  it('formats distances for humans', () => {
    expect(describeDistance(0.35)).toBe('350 m');
    expect(describeDistance(4.26)).toBe('4.3 km');
    expect(describeDistance(42.4)).toBe('42 km');
  });
});
