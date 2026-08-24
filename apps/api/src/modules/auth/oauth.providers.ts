/**
 * OAuth providers, described as data.
 *
 * Written against the raw authorization-code flow rather than Passport. The
 * flow is three HTTP calls and a state check; a strategy framework adds a
 * session abstraction this application does not use — it issues its own JWTs
 * — and hides the one part worth reading closely, which is what gets trusted
 * from the provider's response.
 */

export interface OAuthProfile {
  readonly providerAccountId: string;
  readonly email: string | null;
  readonly fullName: string | null;
  /**
   * Whether the PROVIDER states the address is verified.
   *
   * This decides whether an OAuth sign-in may attach to an existing
   * password account. Without it, anyone who can set an unverified address
   * at a provider could claim someone else's account by signing in with it.
   */
  readonly emailVerified: boolean;
}

export interface OAuthProviderConfig {
  readonly key: 'google' | 'github';
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scope: string;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

interface GoogleUserInfo {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

interface GitHubUser {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  login?: unknown;
}

interface GitHubEmail {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'JobPilot',
    },
  });

  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

export const GOOGLE: OAuthProviderConfig = {
  key: 'google',
  displayName: 'Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'openid email profile',

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const info = await getJson<GoogleUserInfo>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      accessToken,
    );

    return {
      providerAccountId: String(info.sub ?? ''),
      email: typeof info.email === 'string' ? info.email : null,
      fullName: typeof info.name === 'string' ? info.name : null,
      // Google returns this as a boolean or the string "true" depending on
      // the endpoint. Anything else is treated as unverified.
      emailVerified: info.email_verified === true || info.email_verified === 'true',
    };
  },
};

export const GITHUB: OAuthProviderConfig = {
  key: 'github',
  displayName: 'GitHub',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scope: 'read:user user:email',

  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    const user = await getJson<GitHubUser>('https://api.github.com/user', accessToken);

    // GitHub omits the address from /user when the account keeps it private,
    // so the verified-addresses endpoint is the reliable source.
    let email = typeof user.email === 'string' ? user.email : null;
    let emailVerified = false;

    try {
      const emails = await getJson<GitHubEmail[]>(
        'https://api.github.com/user/emails',
        accessToken,
      );

      const primary = emails.find((candidate) => candidate.primary === true && candidate.verified === true)
        ?? emails.find((candidate) => candidate.verified === true);

      if (primary && typeof primary.email === 'string') {
        email = primary.email;
        emailVerified = true;
      }
    } catch {
      // The scope may have been declined. An address from /user alone is not
      // known to be verified, so it stays marked unverified.
    }

    return {
      providerAccountId: String(user.id ?? ''),
      email,
      fullName:
        typeof user.name === 'string' && user.name
          ? user.name
          : typeof user.login === 'string'
            ? user.login
            : null,
      emailVerified,
    };
  },
};

export const OAUTH_PROVIDERS: readonly OAuthProviderConfig[] = [GOOGLE, GITHUB];

export function findProvider(key: string): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS.find((provider) => provider.key === key);
}
