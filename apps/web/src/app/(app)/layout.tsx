import * as React from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth } from '@/features/auth/route-guards';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
