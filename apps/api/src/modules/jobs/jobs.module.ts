import { Module } from '@nestjs/common';
import { JobIngestionService } from './job-ingestion.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  providers: [JobsService, JobIngestionService],
  exports: [JobsService, JobIngestionService],
})
export class JobsModule {}
