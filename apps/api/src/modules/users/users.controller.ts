import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  UpdateProfileSchema,
  type AuthUser,
  type UpdateProfileInput,
  type UserProfileDto,
} from '@jobpilot/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUser> {
    return this.users.getAuthUser(user.id);
  }

  @Get('me/profile')
  async profile(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileDto> {
    return this.users.getProfile(user.id);
  }

  @Patch('me/profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(UpdateProfileSchema)) body: UpdateProfileInput,
  ): Promise<UserProfileDto> {
    return this.users.updateProfile(user.id, body);
  }
}
