import type { Metadata } from 'next';
import * as React from 'react';
import { RegisterForm } from '@/features/auth/auth-form';
import { RedirectIfAuthenticated } from '@/features/auth/route-guards';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage(): React.ReactElement {
  return (
    <RedirectIfAuthenticated>
      <RegisterForm />
    </RedirectIfAuthenticated>
  );
}
