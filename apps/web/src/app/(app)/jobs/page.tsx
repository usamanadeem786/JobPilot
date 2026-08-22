import type { Metadata } from 'next';
import * as React from 'react';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: 'Jobs' };

export default function JobsPage(): React.ReactElement {
  return (
    <PhasePlaceholder
      title="Jobs"
      phase="Phase 4"
      description="Every role discovered from your configured sources, in one table."
      willInclude={[
        'A sortable, filterable table of discovered jobs with saved views',
        'Match score, recruiter contact and application status per row',
        'Bulk selection for CV generation, status changes and export',
        'CSV and Excel export of the current view',
      ]}
    />
  );
}
