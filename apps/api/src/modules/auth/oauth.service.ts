import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthSession, Role } from '@jobpilot/shared';
import { AuditAction, AuditService } from '../audit/audit.service';
import type { AuthResult } from './auth.service';
import { AppException } from '../../common/errors/app-exception';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService, type IssueContext } from './token.service';
import { findProvider, OAUTH_PROVIDERS, type OAuthProfile } from './oauth.providers';

export interface OAuthProviderStatus {
  readonly key: string;
  readonly displayName: string;
  readonly configured: boolean;
}

/** How long an authorization attempt stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Sign-in with Google or GitHub.
 *
 * Two decisions worth stating.
 *
 * The `state` parameter is a signed, expiring token rather than a row in a
 * table or a server session. It has to survive a round trip through the
 * provider and come back proving this application started the flow — which is
 * the entire CSRF defence for OAuth — and an HMAC over a nonce and a
 * timestamp does that without shared state between instances.
 *
 * An OAuth identity attaches to an existing password account only when the
 * provider says the address is verified. Otherwise anyone able to set an
 * unverified address at a provider could sign in as an existing user.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  providers(): OAuthProviderStatus[] {
    return OAUTH_PROVIDERS.map((provider) => ({
      key: provider.key,
      displayName: provider.displayName,
      configured: this.credentialsFor(provider.key) !== null,
    }));
  }

  /** The URL to send the browser to, and the state to check on return. */
  authorizeUrl(providerKey: string): string {
    const provider = findProvider(providerKey);
    if (!provider) throw AppException.notFound('NOT_FOUND', 'Unknown sign-in provider.');

    const credentials = this.credentialsFor(provider.key);
    if (!credentials) {
      throw AppException.serviceUnavailable(
        'OAUTH_NOT_CONFIGURED',
        `${provider.displayName} sign-in is not configured on this deployment.`,
      );
    }

    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(provider.key));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider.scope);
    url.searchParams.set('state', this.createState(provider.key));

    return url.toString();
  }

  /** Completes the flow and issues this application's own tokens. */
  async complete(
    providerKey: string,
    code: string,
    state: string,
    context: IssueContext = {},
  ): Promise<AuthResult> {
    const provider = findProvider(providerKey);
    if (!provider) throw AppException.notFound('NOT_FOUND', 'Unknown sign-in provider.');

    if (!this.verifyState(state, provider.key)) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'That sign-in attempt has expired or did not start here. Try again.',
      );
    }

    const credentials = this.credentialsFor(provider.key);
    if (!credentials) {
      throw AppException.serviceUnavailable(
        'OAUTH_NOT_CONFIGURED',
        `${provider.displayName} sign-in is not configured on this deployment.`,
      );
    }

    const accessToken = await this.exchangeCode(provider.tokenUrl, {
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: this.redirectUri(provider.key),
      grant_type: 'authorization_code',
    });

    const profile = await provider.fetchProfile(accessToken);
    if (!profile.providerAccountId) {
      throw AppException.badRequest('VALIDATION_FAILED', 'The provider returned no account id.');
    }

    const user = await this.resolveUser(provider.key, profile);
    const issued = await this.tokens.issue(
      { id: user.id, email: user.email, role: user.role as Role },
      context,
    );

    await this.audit.record({
      userId: user.id,
      action: AuditAction.UserLoggedIn,
      metadata: { provider: provider.key },
    });

    // Same shape as a password sign-in, so the controller sets the refresh
    // cookie by exactly one code path rather than two that can diverge.
    return {
      session: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role as Role,
          status: user.status as AuthSession['user']['status'],
          emailVerified: user.emailVerified,
          fullName: user.fullName,
          createdAt: user.createdAt.toISOString(),
        },
        tokens: issued.tokens,
      },
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt,
    };
  }

  /**
   * Finds or creates the account behind an OAuth identity.
   *
   * Three cases, in order: the identity is already linked; a verified address
   * matches an existing account, so the identity is attached to it; or this
   * is a new person.
   */
  private async resolveUser(
    providerKey: string,
    profile: OAuthProfile,
  ): Promise<{
    id: string;
    email: string;
    role: string;
    status: string;
    emailVerified: boolean;
    fullName: string | null;
    createdAt: Date;
  }> {
    const existingLink = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: providerKey,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: { include: { profile: { select: { fullName: true } } } } },
    });

    if (existingLink) return flatten(existingLink.user);

    if (!profile.email) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'That provider did not share an email address, so no account can be created.',
      );
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { profile: { select: { fullName: true } } },
    });

    if (byEmail) {
      if (!profile.emailVerified) {
        // The critical refusal. Attaching on an unverified address would let
        // anyone who can set that address at a provider take over the account.
        throw AppException.forbidden(
          'FORBIDDEN',
          'An account already uses that email address, and the provider has not verified it belongs to you. Sign in with your password instead.',
        );
      }

      await this.prisma.oAuthAccount.create({
        data: {
          userId: byEmail.id,
          provider: providerKey,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
        },
      });

      return flatten(byEmail);
    }

    const created = await this.prisma.user.create({
      data: {
        email: profile.email,
        // No password is set. Sign-in is through the provider until the user
        // sets one; a random hash nobody knows would be worse, because a
        // reset flow would then appear to be available.
        passwordHash: null,
        emailVerified: profile.emailVerified,
        profile: { create: { fullName: profile.fullName ?? profile.email } },
        oauthAccounts: {
          create: {
            provider: providerKey,
            providerAccountId: profile.providerAccountId,
            email: profile.email,
          },
        },
      },
      include: { profile: { select: { fullName: true } } },
    });

    return flatten(created);
  }

  private async exchangeCode(tokenUrl: string, params: Record<string, string>): Promise<string> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    });

    const body = (await response.json()) as { access_token?: unknown; error_description?: unknown };

    if (!response.ok || typeof body.access_token !== 'string') {
      this.logger.warn(
        `Token exchange failed: HTTP ${response.status} ${String(body.error_description ?? '')}`,
      );
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'That sign-in could not be completed. Try again.',
      );
    }

    return body.access_token;
  }

  private credentialsFor(key: string): { clientId: string; clientSecret: string } | null {
    const clientId = key === 'google' ? this.env.GOOGLE_OAUTH_CLIENT_ID : this.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret =
      key === 'google' ? this.env.GOOGLE_OAUTH_CLIENT_SECRET : this.env.GITHUB_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  /**
   * The URL the provider returns the browser to.
   *
   * `OAUTH_CALLBACK_BASE_URL` already includes the API prefix and the auth
   * segment — the convention .env.example documents — so only the provider
   * path is appended. Appending the prefix again produced
   * ".../api/auth/api/auth/oauth/google/callback", which no provider would
   * ever have had registered.
   */
  private redirectUri(providerKey: string): string {
    const base = (this.env.OAUTH_CALLBACK_BASE_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      throw AppException.internal(
        'INTERNAL_ERROR',
        'OAUTH_CALLBACK_BASE_URL is not set, so the provider has nowhere to return to.',
      );
    }
    return `${base}/oauth/${providerKey}/callback`;
  }

  /** `<providerKey>.<issuedAt>.<nonce>.<hmac>` */
  private createState(providerKey: string): string {
    const payload = `${providerKey}.${Date.now()}.${randomBytes(16).toString('hex')}`;
    return `${payload}.${this.signState(payload)}`;
  }

  private verifyState(state: string, providerKey: string): boolean {
    const parts = state.split('.');
    if (parts.length !== 4) return false;

    const [key, issuedAt, , signature] = parts as [string, string, string, string];
    const payload = parts.slice(0, 3).join('.');

    const expected = this.signState(payload);
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);

    // Length-checked first: timingSafeEqual throws on a mismatch.
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return false;
    if (key !== providerKey) return false;

    const age = Date.now() - Number(issuedAt);
    return Number.isFinite(age) && age >= 0 && age < STATE_TTL_MS;
  }

  private signState(payload: string): string {
    // Keyed with the refresh secret, which never leaves the server and is
    // already required to be strong.
    return createHmac('sha256', this.env.JWT_REFRESH_SECRET).update(payload).digest('hex');
  }
}

function flatten(user: {
  id: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
  profile: { fullName: string } | null;
}): {
  id: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  fullName: string | null;
  createdAt: Date;
} {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    fullName: user.profile?.fullName ?? null,
    createdAt: user.createdAt,
  };
}
