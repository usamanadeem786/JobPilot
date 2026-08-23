import type { Metadata } from 'next';
import * as React from 'react';
import { CvsWorkspace } from '@/features/cv/cvs-workspace';

export const metadata: Metadata = { title: 'CVs' };

export default function CvsPage(): React.ReactElement {
  return <CvsWorkspace />;
}
