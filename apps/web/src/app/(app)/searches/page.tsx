import type { Metadata } from 'next';
import * as React from 'react';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: 'Searches' };

export default function SearchesPage(): React.ReactElement {
  return (
    <PhasePlaceholder
      title="Searches"
      phase="Phase 3"
      description="Run keyword searches across the job sources this deployment has configured."
      willInclude={[
        'Keyword and filter entry, run as a background job',
        'Live progress while each source is queried and duplicates are removed',
        'Saved searches you can re-run or schedule',
        'A clear message naming any source that is not configured',
      ]}
    />
  );
}
