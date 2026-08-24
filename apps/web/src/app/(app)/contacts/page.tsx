import type { Metadata } from 'next';
import * as React from 'react';
import { ContactsWorkspace } from '@/features/contacts/contacts-workspace';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage(): React.ReactElement {
  return <ContactsWorkspace />;
}
