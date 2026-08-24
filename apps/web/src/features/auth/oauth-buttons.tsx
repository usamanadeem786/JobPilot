'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { API_URL, apiFetch } from '@/lib/api-client';

interface ProviderStatus {
  readonly key: string;
  readonly displayName: string;
  readonly configured: boolean;
}

/**
 * Third-party sign-in.
 *
 * A plain link, not a fetch. The browser has to leave for the provider, and
 * the API answers with a redirect carrying a signed `state` — the CSRF
 * defence for the whole flow. Fetching the URL and navigating to it by hand
 * invites a client to construct its own and drop that parameter.
 *
 * Providers that are not configured are not rendered. A button that always
 * fails is worse than no button.
 */
export function OAuthButtons(): React.ReactElement | null {
  const providers = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => apiFetch<ProviderStatus[]>('/auth/oauth/providers'),
    staleTime: Infinity,
    retry: false,
  });

  const available = (providers.data ?? []).filter((provider) => provider.configured);
  if (available.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {available.map((provider) => (
        <Button key={provider.key} asChild variant="outline" type="button">
          <a href={`${API_URL}/auth/oauth/${provider.key}`}>Continue with {provider.displayName}</a>
        </Button>
      ))}
    </div>
  );
}
