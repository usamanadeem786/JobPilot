import { describe, expect, it } from 'vitest';
import {
  buildPageMeta,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQuerySchema,
  toSkipTake,
} from './pagination';

describe('PaginationQuerySchema', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('coerces the strings that arrive in a query string', () => {
    expect(PaginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('caps pageSize so a client cannot request the entire table', () => {
    expect(PaginationQuerySchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it.each([{ page: 0 }, { page: -1 }, { pageSize: 0 }, { page: 1.5 }])(
    'rejects %j',
    (input) => {
      expect(PaginationQuerySchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('buildPageMeta', () => {
  it('describes a middle page', () => {
    expect(buildPageMeta(2, 25, 120)).toEqual({
      page: 2,
      pageSize: 25,
      total: 120,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('has no next page on the last page', () => {
    expect(buildPageMeta(5, 25, 120)).toMatchObject({
      totalPages: 5,
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('handles an empty result set without reporting a previous page', () => {
    expect(buildPageMeta(1, 25, 0)).toEqual({
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('rounds a partial final page up', () => {
    expect(buildPageMeta(1, 25, 26).totalPages).toBe(2);
  });
});

describe('toSkipTake', () => {
  it('maps page 1 to no offset', () => {
    expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
  });

  it('offsets by whole pages', () => {
    expect(toSkipTake({ page: 4, pageSize: 10 })).toEqual({ skip: 30, take: 10 });
  });
});
