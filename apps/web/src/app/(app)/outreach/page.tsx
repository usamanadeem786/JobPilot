import type { Metadata } from 'next';
import * as React from 'react';
import { OutreachWorkspace } from '@/features/outreach/outreach-workspace';

export const metadata: Metadata = { title: 'Outreach' };

export default function OutreachPage(): React.ReactElement {
  return <OutreachWorkspace />;
}
