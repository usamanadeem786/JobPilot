'use client';

import type { UserProfileDto } from '@jobpilot/shared';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, FileText, Send, Users } from 'lucide-react';
import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-provider';
import { apiFetch, ApiError } from '@/lib/api-client';

interface StatCard {
  readonly key: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly phase: string;
}

/**
 * The dashboard's numbers come from features that land in later phases. Rather
 * than invent placeholder figures, each card states which phase fills it in —
 * a fake "0" would be indistinguishable from a real one.
 */
const PENDING_STATS: readonly StatCard[] = [
  { key: 'jobs', label: 'Jobs discovered', icon: Briefcase, phase: 'Phase 3' },
  { key: 'cvs', label: 'CVs generated', icon: FileText, phase: 'Phase 6' },
  { key: 'applications', label: 'Applications', icon: Send, phase: 'Phase 7' },
  { key: 'contacts', label: 'Contacts found', icon: Users, phase: 'Phase 8' },
];

export default function DashboardPage(): React.ReactElement {
  const { user } = useAuth();

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<UserProfileDto>('/users/me/profile'),
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {profileQuery.isPending ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            `Welcome, ${profileQuery.data?.fullName ?? user?.email ?? 'there'}`
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your account is set up. Job search and CV tailoring arrive in the next phases.
        </p>
      </header>

      {profileQuery.isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {profileQuery.error instanceof ApiError
            ? profileQuery.error.message
            : 'Could not load your profile.'}
        </div>
      )}

      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PENDING_STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums text-muted-foreground">—</p>
                <p className="mt-1 text-xs text-muted-foreground">Available in {stat.phase}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            Used to rank jobs and to fill in your details when tailoring a CV.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profileQuery.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : profileQuery.data ? (
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Detail label="Name" value={profileQuery.data.fullName} />
              <Detail label="Email" value={user?.email ?? null} />
              <Detail label="Headline" value={profileQuery.data.headline} />
              <Detail
                label="Location"
                value={
                  [profileQuery.data.locationCity, profileQuery.data.locationCountry]
                    .filter(Boolean)
                    .join(', ') || null
                }
              />
              <Detail
                label="Skills"
                value={
                  profileQuery.data.skills.length > 0 ? profileQuery.data.skills.join(', ') : null
                }
              />
              <Detail label="Remote preference" value={profileQuery.data.remotePreference} />
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">Not set</span>}</dd>
    </div>
  );
}
