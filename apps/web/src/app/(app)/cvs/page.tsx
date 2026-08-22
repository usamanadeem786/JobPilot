import type { Metadata } from 'next';
import * as React from 'react';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: 'CVs' };

export default function CvsPage(): React.ReactElement {
  return (
    <PhasePlaceholder
      title="CVs"
      phase="Phase 2"
      description="Your master CV, and every tailored version generated from it."
      willInclude={[
        'PDF and DOCX upload with text extraction into a structured CV',
        'A section-by-section editor with autosave',
        'Tailored versions kept separate from the master, one per job',
        'PDF and DOCX download from five ATS-friendly templates',
      ]}
    />
  );
}
