import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  JobBulkActionSchema,
  JobListQuerySchema,
  JobSearchRequestSchema,
  UpdateJobSchema,
  type JobBulkAction,
  type JobDetailDto,
  type JobListItemDto,
  type JobListQuery,
  type JobSearchInput,
  type JobSearchResultDto,
  type JobSourceStatusDto,
  type Paginated,
  type UpdateJobInput,
} from '@jobpilot/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { JobIngestionService } from './job-ingestion.service';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly ingestion: JobIngestionService,
  ) {}

  /**
   * The configured sources and their status.
   *
   * Declared before `:id` because Nest matches routes in order — otherwise
   * "sources" is read as a job id and the request fails UUID validation.
   */
  @Get('sources')
  sources(): JobSourceStatusDto[] {
    return this.ingestion.sources();
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(JobListQuerySchema)) query: JobListQuery,
  ): Promise<Paginated<JobListItemDto>> {
    return this.jobs.list(user.id, query);
  }

  /** Runs a discovery search and stores what it finds. */
  @Post('search')
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(JobSearchRequestSchema)) body: JobSearchInput,
  ): Promise<JobSearchResultDto> {
    return this.ingestion.search(
      user.id,
      {
        keywords: body.keywords,
        ...(body.location ? { location: body.location } : {}),
        ...(body.remoteOnly === undefined ? {} : { remoteOnly: body.remoteOnly }),
        ...(body.minSalary === undefined ? {} : { minSalary: body.minSalary }),
        limit: body.limit,
      },
      body.sources,
    );
  }

  @Post('bulk')
  async bulk(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(JobBulkActionSchema)) body: JobBulkAction,
  ): Promise<{ updated: number }> {
    return this.jobs.bulk(user.id, body);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobDetailDto> {
    return this.jobs.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateJobSchema)) body: UpdateJobInput,
  ): Promise<JobListItemDto> {
    return this.jobs.update(user.id, id, body);
  }

  /** Removes the job from this account. The posting itself is untouched. */
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ updated: number }> {
    return this.jobs.bulk(user.id, { action: 'delete', jobIds: [id] });
  }
}
