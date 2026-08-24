import type { Metadata } from 'next';
import * as React from 'react';
import { SearchHistory } from '@/features/jobs/search-history';

export const metadata: Metadata = { title: 'Searches' };

export default function SearchesPage(): React.ReactElement {
  return <SearchHistory />;
}
