import type { Metadata } from 'next';
import * as React from 'react';
import { LoginForm } from '@/features/auth/auth-form';
import { RedirectIfAuthenticated } from '@/features/auth/route-guards';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage(): React.ReactElement {
  return (
    <RedirectIfAuthenticated>
      <LoginForm />
    </RedirectIfAuthenticated>
  );
}
