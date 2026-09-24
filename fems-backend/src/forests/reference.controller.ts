import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ForestsService } from './forests.service';
import {
  CreateInventoryDto,
  CreateProtectedAreaDto,
  CreateSpeciesDto,
  InventoryQueryDto,
  ProtectedAreaQueryDto,
  SpeciesQueryDto,
  UpdateInventoryDto,
  UpdateProtectedAreaDto,
  UpdateSpeciesDto,
} from './dto/reference.dto';
import { CurrentUser, Public, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('protected-areas')
@Controller('protected-areas')
export class ProtectedAreasController {
  constructor(private readonly forests: ForestsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List protected areas (public reference data)' })
  async list(@Query() query: ProtectedAreaQueryDto) {
    const { items, total } = await this.forests.listProtectedAreas(query);
    return paginate(items, total, query.page, query.limit);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Protected area detail with linked forests and violation counts' })
  get(@Param('id') id: string) {
    return this.forests.getProtectedArea(id);
  }

  @Post()
  @ApiBearerAuth('bearer')
  @RequirePermissions('protected-areas:create')
  @ApiOperation({ summary: 'Create a protected area' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProtectedAreaDto) {
    return this.forests.createProtectedArea(user, dto);
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('protected-areas:update')
  @ApiOperation({ summary: 'Update a protected area' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProtectedAreaDto) {
    return this.forests.updateProtectedArea(user, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('protected-areas:delete')
  @ApiOperation({ summary: 'Archive a protected area' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forests.deleteProtectedArea(user, id);
  }
}

@ApiTags('tree-species')
@Controller('tree-species')
export class TreeSpeciesController {
  constructor(private readonly forests: ForestsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Timber species catalogue (public reference data)' })
  async list(@Query() query: SpeciesQueryDto) {
    const { items, total } = await this.forests.listSpecies(query);
    return paginate(items, total, query.page, query.limit);
  }

  @Post()
  @ApiBearerAuth('bearer')
  @RequirePermissions('tree-species:create')
  @ApiOperation({ summary: 'Add a species to the catalogue' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSpeciesDto) {
    return this.forests.createSpecies(user, dto);
  }

  @Patch(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('tree-species:update')
  @ApiOperation({ summary: 'Update a species' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSpeciesDto) {
    return this.forests.updateSpecies(user, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @RequirePermissions('tree-species:delete')
  @ApiOperation({ summary: 'Archive a species' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forests.deleteSpecies(user, id);
  }
}

@ApiTags('inventory')
@ApiBearerAuth('bearer')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly forests: ForestsService) {}

  @Get()
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: 'List timber inventory plots' })
  async list(@Query() query: InventoryQueryDto) {
    const { items, total } = await this.forests.listInventory(query);
    return paginate(items, total, query.page, query.limit);
  }

  @Post()
  @RequirePermissions('inventory:create')
  @ApiOperation({
    summary: 'Record an inventory plot',
    description: 'Coordinates come from the field device; the plot is validated against the selected forest and zone.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInventoryDto) {
    return this.forests.createInventory(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('inventory:update')
  @ApiOperation({ summary: 'Correct an inventory record' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateInventoryDto) {
    return this.forests.updateInventory(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('inventory:delete')
  @ApiOperation({ summary: 'Remove an inventory record' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.forests.deleteInventory(user, id);
  }
}
