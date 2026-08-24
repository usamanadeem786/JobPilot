import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/request';
import { ContactsService, type ContactDto, type DiscoverResult } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ContactDto[]> {
    return this.contacts.list(user.id);
  }

  /**
   * Reads any contact details the employer published in the job posting.
   *
   * Explicitly scoped to the posting. Nothing here crawls a company site,
   * scrapes a professional network, or constructs an address from a name.
   */
  @Post('discover/:jobId')
  async discover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<DiscoverResult> {
    return this.contacts.discoverForJob(user.id, jobId);
  }
}
