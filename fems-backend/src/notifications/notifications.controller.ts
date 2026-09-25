import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PaginationQueryDto, paginate } from '../common/dto/pagination.dto';

class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only return unread notifications' })
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;
}

class BroadcastDto {
  @ApiProperty({ example: 'Scheduled maintenance' })
  @IsString()
  @MaxLength(191)
  title!: string;

  @ApiProperty({ example: 'FEMS will be read-only on Sunday 02:00–04:00.' })
  @IsString()
  @MaxLength(500)
  message!: string;
}

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the current user’s notifications',
    description: 'Delivered in-app notifications, newest first, with an unread counter.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: NotificationQueryDto) {
    const result = await this.notifications.list(user.id, {
      unreadOnly: query.unreadOnly,
      type: query.type,
      page: query.page,
      limit: query.limit,
    });
    return { ...paginate(result.items, result.meta.total, query.page, query.limit), unreadCount: result.unreadCount };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count (used for the tab badge)' })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.remove(user.id, id);
  }

  @Post('broadcast')
  @RequirePermissions('settings:manage')
  @ApiOperation({
    summary: 'Broadcast a system announcement to every active account',
    description: 'Requires `settings:manage` (administrators).',
  })
  @ApiQuery({ name: 'audience', required: false, description: 'Optional role name filter' })
  async broadcast(
    @Body() dto: BroadcastDto,
    @Query('audience') audience?: string,
  ) {
    const input = {
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: dto.title,
      message: dto.message,
      entityType: 'SystemSetting',
    };
    if (audience) {
      return this.notifications.notifyRoles([audience], input);
    }
    return this.notifications.notifyAllActive(input);
  }
}
