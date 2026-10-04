import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MapQueryDto, NearbyQueryDto } from './gis.dto';

describe('GIS query DTOs', () => {
  it('accepts comma-separated feature types used by the mobile client', () => {
    const query = plainToInstance(MapQueryDto, { featureTypes: 'FOREST,EXPLOITATION_ACTIVITY', limit: '20' });

    expect(query.featureTypes).toEqual(['FOREST', 'EXPLOITATION_ACTIVITY']);
    expect(validateSync(query)).toEqual([]);
  });

  it('accepts repeated featureTypes query parameters for nearby searches', () => {
    const query = plainToInstance(NearbyQueryDto, {
      latitude: '3.848',
      longitude: '11.5021',
      featureTypes: ['FOREST', 'EXPLOITATION_ACTIVITY'],
    });

    expect(query.featureTypes).toEqual(['FOREST', 'EXPLOITATION_ACTIVITY']);
    expect(validateSync(query)).toEqual([]);
  });
});
