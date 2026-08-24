import { Module } from '@nestjs/common';
import { CvModule } from '../cv/cv.module';
import { JobAnalysisService } from './job-analysis.service';
import { JobIngestionService } from './job-ingestion.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [CvModule],
  controllers: [JobsController],
  providers: [JobsService, JobIngestionService, JobAnalysisService],
  exports: [JobsService, JobIngestionService, JobAnalysisService],
})
export class JobsModule {}
