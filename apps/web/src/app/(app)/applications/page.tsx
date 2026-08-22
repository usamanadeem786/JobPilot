import type { Metadata } from 'next';
import * as React from 'react';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: 'Applications' };

export default function ApplicationsPage(): React.ReactElement {
  return (
    <PhasePlaceholder
      title="Applications"
      phase="Phase 7"
      description="Track what you applied to, when, and what happened next."
      willInclude={[
        'Status pipeline from draft through interview to offer',
        'Interview dates, notes and a full event history per application',
        'Apply manually via the employer’s official application page',
        'Automated submission only where a platform explicitly permits it',
      ]}
    />
  );
}
