import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService, type LivenessResult, type ReadinessResult } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Public()
  @Get()
  live(): LivenessResult {
    return this.health.liveness();
  }

  /** Readiness: dependencies are reachable. Used by orchestrators. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResult> {
    const result = await this.health.readiness();
    // A degraded dependency must be a non-2xx so orchestrators stop routing
    // traffic here, while the body still explains which dependency is down.
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
