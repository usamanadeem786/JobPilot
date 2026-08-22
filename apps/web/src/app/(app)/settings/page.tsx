'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateProfileSchema, type UpdateProfileInput, type UserProfileDto } from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, ApiError } from '@/lib/api-client';

/** Comma-separated text in the UI, string[] on the wire. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export default function SettingsPage(): React.ReactElement {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<UserProfileDto>('/users/me/profile'),
  });

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    values: profileQuery.data
      ? {
          fullName: profileQuery.data.fullName,
          headline: profileQuery.data.headline,
          phone: profileQuery.data.phone,
          locationCity: profileQuery.data.locationCity,
          locationCountry: profileQuery.data.locationCountry,
        }
      : undefined,
  });

  const [skillsText, setSkillsText] = React.useState('');
  const [rolesText, setRolesText] = React.useState('');

  React.useEffect(() => {
    if (!profileQuery.data) return;
    setSkillsText(profileQuery.data.skills.join(', '));
    setRolesText(profileQuery.data.desiredRoles.join(', '));
  }, [profileQuery.data]);

  const mutation = useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiFetch<UserProfileDto>('/users/me/profile', { method: 'PATCH', body: input }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['profile'], updated);
      toast.success('Profile saved.');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.fieldErrorMap())) {
          form.setError(path as keyof UpdateProfileInput, { type: 'server', message });
        }
        toast.error(error.message);
        return;
      }
      toast.error('Could not save your profile.');
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate({
      ...values,
      skills: splitList(skillsText),
      desiredRoles: splitList(rolesText),
    });
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your profile feeds job matching and CV tailoring.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your phone number is encrypted before it is stored and is never sent to a job source.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profileQuery.isPending ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Full name" id="fullName" error={form.formState.errors.fullName?.message}>
                <Input id="fullName" {...form.register('fullName')} />
              </Field>

              <Field label="Headline" id="headline" error={form.formState.errors.headline?.message}>
                <Input
                  id="headline"
                  placeholder="Python Backend Developer"
                  {...form.register('headline')}
                />
              </Field>

              <Field label="Phone" id="phone" error={form.formState.errors.phone?.message}>
                <Input id="phone" type="tel" autoComplete="tel" {...form.register('phone')} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" id="locationCity" error={form.formState.errors.locationCity?.message}>
                  <Input id="locationCity" {...form.register('locationCity')} />
                </Field>
                <Field
                  label="Country"
                  id="locationCountry"
                  error={form.formState.errors.locationCountry?.message}
                >
                  <Input id="locationCountry" {...form.register('locationCountry')} />
                </Field>
              </div>

              <Field label="Skills (comma separated)" id="skills">
                <Input
                  id="skills"
                  value={skillsText}
                  onChange={(event) => setSkillsText(event.target.value)}
                  placeholder="Python, Django, FastAPI, PostgreSQL"
                />
              </Field>

              <Field label="Target roles (comma separated)" id="desiredRoles">
                <Input
                  id="desiredRoles"
                  value={rolesText}
                  onChange={(event) => setRolesText(event.target.value)}
                  placeholder="Backend Engineer, Django Developer"
                />
              </Field>

              <div>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
