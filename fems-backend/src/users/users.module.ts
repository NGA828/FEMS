import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';

@Module({
  controllers: [UsersController, RolesController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
