import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_API_URL ??= 'http://localhost:4000/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
