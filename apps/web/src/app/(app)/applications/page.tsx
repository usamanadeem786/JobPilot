import type { Metadata } from 'next';
import * as React from 'react';
import { ApplicationsWorkspace } from '@/features/applications/applications-workspace';

export const metadata: Metadata = { title: 'Applications' };

export default function ApplicationsPage(): React.ReactElement {
  return <ApplicationsWorkspace />;
}
