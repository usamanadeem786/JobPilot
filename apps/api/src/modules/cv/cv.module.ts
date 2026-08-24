import { Module } from '@nestjs/common';
import { CvController } from './cv.controller';
import { CvTailoringService } from './cv-tailoring.service';
import { CvService } from './cv.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [CvController],
  providers: [CvService, CvTailoringService],
  exports: [CvService, CvTailoringService],
})
export class CvModule {}
