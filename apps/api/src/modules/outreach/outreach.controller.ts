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
  GenerateOutreachSchema,
  UpdateOutreachSchema,
  type GenerateOutreachInput,
  type OutreachDraftDto,
  type OutreachStatus,
  type UpdateOutreachInput,
} from '@jobpilot/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { OutreachService } from './outreach.service';

const SetStatusSchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED', 'SENT', 'RESPONDED', 'BOUNCED', 'FOLLOW_UP_DUE', 'CLOSED']),
});

@Controller('outreach')
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<OutreachDraftDto[]> {
    return this.outreach.list(user.id);
  }

  /** Whether this deployment can send email at all. */
  @Get('transport')
  transport(): { configured: boolean; note: string } {
    const configured = this.outreach.transportConfigured();

    return {
      configured,
      note: configured
        ? 'Email sending is configured. Every message still requires explicit approval.'
        : 'No email transport is configured, so JobPilot cannot send messages. Approve a draft, copy it, and send it from your own mail client.',
    };
  }

  @Post()
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(GenerateOutreachSchema)) body: GenerateOutreachInput,
  ): Promise<OutreachDraftDto> {
    return this.outreach.generate(user.id, body);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutreachDraftDto> {
    return this.outreach.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateOutreachSchema)) body: UpdateOutreachInput,
  ): Promise<OutreachDraftDto> {
    return this.outreach.update(user.id, id, body);
  }

  /**
   * Records that a person read and approved this exact text.
   *
   * Separate from sending on purpose. Approval is the human act the whole
   * feature is built around, and folding it into "send" would make it a
   * formality rather than a decision.
   */
  @Post(':id/approve')
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutreachDraftDto> {
    return this.outreach.approve(user.id, id);
  }

  /** Records that the user sent the message from their own mail client. */
  @Post(':id/sent')
  async markSent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OutreachDraftDto> {
    return this.outreach.markSent(user.id, id);
  }

  @Post(':id/status')
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(SetStatusSchema)) body: { status: OutreachStatus },
  ): Promise<OutreachDraftDto> {
    return this.outreach.setStatus(user.id, id, body.status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.outreach.remove(user.id, id);
  }
}
