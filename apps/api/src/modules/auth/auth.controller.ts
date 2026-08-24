import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
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
import { OAuthService, type OAuthProviderStatus } from './oauth.service';
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from './refresh-cookie';

/** Tight limits on the endpoints an attacker would target with a script. */
const CREDENTIAL_THROTTLE = { auth: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
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

  /** Which third-party sign-ins this deployment offers. */
  @Public()
  @Get('oauth/providers')
  oauthProviders(): OAuthProviderStatus[] {
    return this.oauth.providers();
  }

  /**
   * Starts a third-party sign-in.
   *
   * A redirect rather than a JSON payload containing the URL: the browser has
   * to leave for the provider either way, and returning the URL invites a
   * client to build its own redirect and drop the signed `state` that is the
   * whole CSRF defence.
   */
  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Get('oauth/:provider')
  startOAuth(@Param('provider') provider: string, @Res() response: Response): void {
    response.redirect(this.oauth.authorizeUrl(provider));
  }

  /**
   * Where the provider sends the browser back to.
   *
   * Ends in a redirect to the web app, never a JSON body: this URL is opened
   * by the browser directly, so a JSON response would leave the user staring
   * at a token dump. The session cookie is set on the way through.
   */
  @Public()
  @Throttle(CREDENTIAL_THROTTLE)
  @Get('oauth/:provider/callback')
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: RequestWithUser,
    @Res() response: Response,
  ): Promise<void> {
    // Where the person should land, which is the site — not the auth routes.
    const appUrl = webAppUrl(this.env);

    // The user declined at the provider. Not an error worth a stack trace.
    if (error || !code || !state) {
      response.redirect(`${appUrl}/login?error=${encodeURIComponent(error ?? 'cancelled')}`);
      return;
    }

    try {
      const result = await this.oauth.complete(provider, code, state, contextFrom(request));
      setRefreshCookie(response, this.env, result.refreshToken, result.refreshExpiresAt);
      response.redirect(`${appUrl}/dashboard`);
    } catch (failure) {
      const message =
        failure instanceof AppException ? failure.message : 'That sign-in could not be completed.';
      response.redirect(`${appUrl}/login?error=${encodeURIComponent(message)}`);
    }
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

/**
 * The site to return to after a third-party sign-in.
 *
 * `WEB_APP_URL` when set. Otherwise derived by removing the API prefix from
 * the callback base, which is the documented convention — but derivation is
 * the fallback, not the design: reading the callback base as the site is what
 * produced redirects to "/api/auth/login".
 */
function webAppUrl(env: Env): string {
  const explicit = (env.WEB_APP_URL ?? '').replace(/\/+$/, '');
  if (explicit) return explicit;

  const callbackBase = (env.OAUTH_CALLBACK_BASE_URL ?? '').replace(/\/+$/, '');
  return callbackBase.replace(/\/api\/auth$/, '');
}

