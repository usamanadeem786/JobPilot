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
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  JobBulkActionSchema,
  JobListQuerySchema,
  JobSearchRequestSchema,
  UpdateJobSchema,
  type JobBulkAction,
  type JobAnalysisDto,
  type JobDetailDto,
  type JobListItemDto,
  type JobListQuery,
  type JobSearchHistoryDto,
  type JobSearchInput,
  type JobSearchResultDto,
  type JobSourceStatusDto,
  type Paginated,
  type UpdateJobInput,
} from '@jobpilot/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app-exception';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { JobAnalysisService, type AnalyseResult } from './job-analysis.service';
import { JobIngestionService } from './job-ingestion.service';
import { SearchRunnerService, type SearchProgress } from './search-runner.service';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly ingestion: JobIngestionService,
    private readonly analysis: JobAnalysisService,
    private readonly runner: SearchRunnerService,
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

  /** Searches already run, most recent first. */
  @Get('searches')
  async searchHistory(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobSearchHistoryDto[]> {
    return this.ingestion.history(user.id);
  }

  @Delete('searches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSearch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.ingestion.deleteFromHistory(user.id, id);
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

  /** Scores this account's unscored jobs against its default CV. */
  @Post('analyse')
  async analyseUnscored(@CurrentUser() user: AuthenticatedUser): Promise<AnalyseResult> {
    return this.analysis.analyseUnscored(user.id);
  }

  /**
   * Queues a search and returns immediately.
   *
   * Preferred over POST /jobs/search, which holds the request open for the
   * whole run. A search over several boards takes tens of seconds, which is
   * past the point where proxies cut the connection.
   */
  @Post('search/async')
  async searchAsync(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(JobSearchRequestSchema)) body: JobSearchInput,
  ): Promise<{ searchId: string }> {
    return this.runner.enqueue(
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

  /** Progress for a queued search, as a single reading. */
  @Get('search/:id/progress')
  async searchProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SearchProgress> {
    const progress = await this.runner.progressOf(user.id, id);
    if (!progress) throw AppException.notFound('NOT_FOUND', 'That search could not be found.');
    return progress;
  }

  /**
   * Progress as a stream.
   *
   * Server-sent events rather than WebSockets: the traffic is one-way and
   * short-lived, and SSE survives proxies and needs no separate protocol
   * upgrade. The stream ends itself once the search finishes, so a forgotten
   * tab does not hold a connection open indefinitely.
   */
  @Sse('search/:id/events')
  searchEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;

      const poll = async (): Promise<void> => {
        while (!stopped) {
          const progress = await this.runner.progressOf(user.id, id);

          if (!progress) {
            subscriber.error(new Error('That search could not be found.'));
            return;
          }

          subscriber.next({ data: progress } as MessageEvent);

          if (progress.status === 'completed' || progress.status === 'failed') {
            subscriber.complete();
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      };

      void poll();

      return () => {
        stopped = true;
      };
    });
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

  @Post(':id/analyse')
  async analyseOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobAnalysisDto> {
    return this.analysis.analyseOne(user.id, id);
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
