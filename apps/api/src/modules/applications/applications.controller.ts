import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateApplicationSchema,
  UpdateApplicationSchema,
  type ApplicationDto,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from '@jobpilot/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { ApplicationsService } from './applications.service';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ApplicationDto[]> {
    return this.applications.list(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(CreateApplicationSchema)) body: CreateApplicationInput,
  ): Promise<ApplicationDto> {
    return this.applications.create(user.id, body);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationDto> {
    return this.applications.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateApplicationSchema)) body: UpdateApplicationInput,
  ): Promise<ApplicationDto> {
    return this.applications.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.applications.remove(user.id, id);
  }
}
