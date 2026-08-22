import type { Metadata } from 'next';
import * as React from 'react';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage(): React.ReactElement {
  return (
    <PhasePlaceholder
      title="Contacts"
      phase="Phase 8"
      description="Hiring contacts published by companies through permitted public sources."
      willInclude={[
        'Name, role, company and public profile link with a recorded source',
        'A confidence score and provenance badge on every field',
        'Business emails only where a company published them — never guessed',
        '“No verified public contact found” shown when nothing legitimate exists',
      ]}
    />
  );
}
