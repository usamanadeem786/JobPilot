import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ChangePasswordSchema,
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  type AuthSession,
  type ChangePasswordInput,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
} from '@jobpilot/shared';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/errors/app-exception';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser, RequestWithUser } from '../../common/types/request';
import { ENV, type Env } from '../../config/config.module';
import { AuthService, type AuthResult } from './auth.service';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';

/** Tight limits on the endpoints an attacker would target with a script. */
const CREDENTIAL_THROTTLE = { auth: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(zodBody(RegisterSchema)) body: RegisterInput,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.register(body, contextFrom(request));
    return this.respondWithSession(result, response);
  }

  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(zodBody(LoginSchema)) body: LoginInput,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const result = await this.auth.login(body, contextFrom(request));
    return this.respondWithSession(result, response);
  }

  @Public()
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(zodBody(RefreshSchema)) body: RefreshInput,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    const presented = readRefreshToken(request, body.refreshToken);
    if (!presented) throw AppException.unauthorized('UNAUTHENTICATED');

    try {
      const result = await this.auth.refresh(presented, contextFrom(request));
      return this.respondWithSession(result, response);
    } catch (error) {
      // A refresh that fails leaves a stale cookie behind, which would make
      // every subsequent attempt fail the same way until it expires.
      clearRefreshCookie(response, this.env);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const presented = readRefreshToken(request);
    await this.auth.logout(presented, request.user?.id);
    clearRefreshCookie(response, this.env);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revoked: number }> {
    const result = await this.auth.logoutEverywhere(user.id);
    clearRefreshCookie(response, this.env);
    return result;
  }

  @Throttle(CREDENTIAL_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(ChangePasswordSchema)) body: ChangePasswordInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.changePassword(user.id, body);
    clearRefreshCookie(response, this.env);
  }

  private respondWithSession(result: AuthResult, response: Response): AuthSession {
    setRefreshCookie(response, this.env, result.refreshToken, result.refreshExpiresAt);
    // The refresh token is deliberately absent from the JSON body: it is
    // delivered as an httpOnly cookie and must never reach page JavaScript.
    return result.session;
  }
}

function contextFrom(request: RequestWithUser): { userAgent?: string; ipAddress?: string } {
  const userAgent = request.headers['user-agent'];
  return {
    ...(typeof userAgent === 'string' ? { userAgent: userAgent.slice(0, 500) } : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };
}
