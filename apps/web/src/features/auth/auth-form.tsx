'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, RegisterSchema, type LoginInput, type RegisterInput } from '@jobpilot/shared';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PASSWORD_MIN_LENGTH } from '@jobpilot/shared';
import { ApiError, ConfigurationError, NetworkError } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { OAuthButtons } from './oauth-buttons';

/**
 * Maps a failed request onto the form.
 *
 * Field-level problems the server reported are attached to their inputs; the
 * rest becomes a single message above the submit button. Nothing is swallowed,
 * so a user always sees why a submission did not go through.
 */
function applyApiError<TValues extends FieldValues>(
  error: unknown,
  form: UseFormReturn<TValues>,
  setFormError: (message: string) => void,
): void {
  // A deployment that cannot reach its API at all. Kept separate from a
  // network failure because "check your connection" sends the user chasing
  // their own wifi over a server-side misconfiguration.
  if (error instanceof ConfigurationError) {
    setFormError(error.message);
    return;
  }

  if (error instanceof ApiError) {
    // 400: the server rejected specific fields — show them on those fields.
    let attachedToField = false;
    for (const [path, message] of Object.entries(error.fieldErrorMap())) {
      form.setError(path as Path<TValues>, { type: 'server', message });
      attachedToField = true;
    }
    if (attachedToField) return;

    // 409 duplicate email is about a field even though the server reports it
    // at the top level, so it reads better attached to the input.
    if (error.code === 'EMAIL_ALREADY_REGISTERED' && 'email' in form.getValues()) {
      form.setError('email' as Path<TValues>, { type: 'server', message: error.message });
      return;
    }

    // 5xx: include the request id so a report can be traced to a log line.
    setFormError(
      error.status >= 500 && error.requestId
        ? `${error.message} (reference ${error.requestId})`
        : error.message,
    );
    return;
  }

  if (error instanceof NetworkError) {
    setFormError(error.message);
    return;
  }

  setFormError('Something went wrong. Please try again.');
}

function FieldError({ message }: { message?: string }): React.ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

function FormError({ message }: { message: string | null }): React.ReactElement | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

export function LoginForm(): React.ReactElement {
  const { login } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      router.replace('/dashboard');
    } catch (error) {
      applyApiError(error, form, setFormError);
    }
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back. Enter your details to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            No account yet?{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </p>
        </form>

        <div className="mt-4">
          <OAuthButtons />
        </div>
      </CardContent>
    </Card>
  );
}

export function RegisterForm(): React.ReactElement {
  const { register: registerUser } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { email: '', password: '', fullName: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerUser(values);
      router.replace('/dashboard');
    } catch (error) {
      applyApiError(error, form, setFormError);
    }
  });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Start tracking roles and tailoring your CV.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              autoComplete="name"
              aria-invalid={Boolean(form.formState.errors.fullName)}
              {...form.register('fullName')}
            />
            <FieldError message={form.formState.errors.fullName?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(form.formState.errors.password)}
              aria-describedby="password-hint"
              {...form.register('password')}
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters, with upper case, lower case and a number.
            </p>
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Create account
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already registered?{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
