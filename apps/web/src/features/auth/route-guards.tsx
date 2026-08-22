'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useAuth } from './auth-provider';

function FullPageSpinner({ label }: { label: string }): React.ReactElement {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </div>
    </div>
  );
}

/**
 * Client-side gate for the signed-in area.
 *
 * This is a UX guard, not a security boundary: every protected resource is
 * authorised again on the server, so a user who defeats this sees an empty
 * shell and 401s rather than anyone else's data.
 */
export function RequireAuth({ children }: { children: React.ReactNode }): React.ReactElement {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  if (isLoading) return <FullPageSpinner label="Restoring your session…" />;
  if (!user) return <FullPageSpinner label="Redirecting to sign in…" />;

  return <>{children}</>;
}

/** Keeps a signed-in user off the login and register screens. */
export function RedirectIfAuthenticated({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && user) router.replace('/dashboard');
  }, [isLoading, user, router]);

  if (isLoading) return <FullPageSpinner label="Checking your session…" />;
  if (user) return <FullPageSpinner label="Taking you to your dashboard…" />;

  return <>{children}</>;
}
