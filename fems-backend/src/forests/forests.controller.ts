import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForestsService } from './forests.service';
import {
  CreateForestDto,
  CreateZoneDto,
  ForestQueryDto,
  UpdateForestDto,
  UpdateZoneDto,
  ZoneQueryDto,
} from './dto/forest.dto';
import { CurrentUser, Public, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';

@ApiTags('forests')
@Controller('forests')
export class ForestsController {
  constructor(private readonly forests: ForestsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List forests (public catalogue)',
    description:
      'Publicly listed forests are visible without a token (forest explorers, visitors). Officers see every forest, including non-public ones and drafts.',
  })
  async list(@OptionalAuth() user: AuthenticatedUser | undefined, @Query() query: ForestQueryDto) {
    const { items, total } = await this.forests.listForests(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Public()
  @Get('statistics')
  @ApiOperation({ summary: 'Forest coverage statistics (public)' })
  statistics() {
    return this.forests.statistics();
  }

  @Public()
  @Get('inventory/statistics')
  @ApiOperation({ summary: 'Timber inventory statistics, optionally scoped to one forest' })
  inventoryStatistics(@Query('forestId') forestId?: string) {
    return this.forests.inventoryStatistics(forestId);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Forest detail with zones, inventory summary and recent activities' })
  get(@OptionalAuth() user: AuthenticatedUser | undefined, @Param('id') id: string) {
    return this.forests.getForest(user, id);
  }

  @Post()
  @ApiBearerAuth('bearer')
  @RequirePermissions('forests:create')
  @ApiOperation({ summary: 'Register a forest or UFA (officers only)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateForestDto) {
    return this.forests.createForest(user, dto);
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('forests:update')
  @ApiOperation({ summary: 'Update a forest' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateForestDto) {
    return this.forests.updateForest(user, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('forests:delete')
  @ApiOperation({ summary: 'Archive a forest (rejected when active permits exist)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forests.deleteForest(user, id);
  }

  // ----------------------------------------------------------------- zones

  @Public()
  @Get(':forestId/zones')
  @ApiOperation({ summary: 'List the zones of a forest' })
  async zones(
    @OptionalAuth() user: AuthenticatedUser | undefined,
    @Param('forestId') forestId: string,
    @Query() query: ZoneQueryDto,
  ) {
    const { items, total } = await this.forests.listZones(user, forestId, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Post(':forestId/zones')
  @ApiBearerAuth('bearer')
  @RequirePermissions('zones:create')
  @ApiOperation({ summary: 'Create a zone inside a forest' })
  createZone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('forestId') forestId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.forests.createZone(user, forestId, dto);
  }
}

@ApiTags('zones')
@ApiBearerAuth('bearer')
@Controller('zones')
export class ZonesController {
  constructor(private readonly forests: ForestsService) {}

  @Patch(':id')
  @RequirePermissions('zones:update')
  @ApiOperation({ summary: 'Update a zone' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateZoneDto) {
    return this.forests.updateZone(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('zones:delete')
  @ApiOperation({ summary: 'Archive a zone (rejected when open activities exist)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forests.deleteZone(user, id);
  }
}
