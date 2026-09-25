import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GisService } from './gis.service';
import { MapQueryDto, NearbyQueryDto, RecordPositionDto } from './dto/gis.dto';
import { CurrentUser, Public, RequirePermissions, type AuthenticatedUser } from '../common/decorators';

@ApiTags('gis')
@Controller('gis')
export class GisController {
  constructor(private readonly gis: GisService) {}

  @Public()
  @Get('map')
  @ApiOperation({
    summary: 'GeoJSON FeatureCollection for the map screen (public layers only)',
    description:
      'Public map data: forests, zones, protected areas and active activities. Field positions, AI alerts and violations are only returned to authenticated officers.',
  })
  async publicMap(@Query() query: MapQueryDto) {
    const publicLayers = ['FOREST', 'FOREST_ZONE', 'PROTECTED_AREA', 'EXPLOITATION_ACTIVITY'] as const;
    return this.gis.mapFeatures({
      ...query,
      featureTypes: query.featureTypes?.filter((type) => (publicLayers as readonly string[]).includes(type)),
    });
  }

  @Get('map/full')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:read')
  @ApiOperation({ summary: 'Full map data including alerts, violations and check-ins (officers)' })
  map(@Query() query: MapQueryDto) {
    return this.gis.mapFeatures(query);
  }

  @Get('layers')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:read')
  @ApiOperation({ summary: 'Layer legend with feature counts' })
  layers() {
    return this.gis.layerSummary();
  }

  @Get('nearby')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:read')
  @ApiOperation({
    summary: 'Features near a GPS position (Haversine distance computed in the database)',
    description:
      'The client sends the real device coordinates; the API validates the ranges and returns records ordered by true great-circle distance.',
  })
  nearby(@Query() query: NearbyQueryDto) {
    return this.gis.nearby(query);
  }

  @Post('positions')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:record_location')
  @ApiOperation({
    summary: 'Record a device GPS position (field check-in)',
    description:
      'Coordinates come from the device. Fixes with accuracy worse than 50 m are rejected unless the caller holds field-verification rights. Mocked locations are refused.',
  })
  recordPosition(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordPositionDto) {
    return this.gis.recordPosition(user, dto);
  }

  @Get('positions/mine')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:record_location')
  @ApiOperation({ summary: 'Recent field positions recorded by the current user' })
  myPositions(@CurrentUser() user: AuthenticatedUser) {
    return this.gis.checkinHistory(user.id);
  }

  @Get('statistics')
  @ApiBearerAuth('bearer')
  @RequirePermissions('gis:read')
  @ApiOperation({ summary: 'GIS coverage statistics' })
  statistics() {
    return this.gis.statistics();
  }
}
