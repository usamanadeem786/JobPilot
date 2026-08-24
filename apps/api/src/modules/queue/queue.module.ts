import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Global so any module can enqueue work without importing a queue module
 * everywhere. There is one backend per process and it holds a connection.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
