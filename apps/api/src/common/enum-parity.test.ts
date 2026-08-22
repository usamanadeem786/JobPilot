import { DOMAIN_ENUMS } from '@jobpilot/shared';
import * as database from '@jobpilot/database';
import { describe, expect, it } from 'vitest';

/**
 * The web app cannot import `@prisma/client`, so `@jobpilot/shared` keeps its
 * own copy of every domain enum. This test is what stops the two drifting: add
 * a value to the Prisma schema without updating shared and it fails here,
 * long before a mismatched string reaches a filter dropdown.
 */
describe('shared enums match the Prisma schema', () => {
  const prismaEnums = database as unknown as Record<string, Record<string, string> | undefined>;

  for (const [name, sharedEnum] of Object.entries(DOMAIN_ENUMS)) {
    it(`${name} has identical members`, () => {
      const prismaEnum = prismaEnums[name];
      expect(prismaEnum, `Prisma client does not export enum "${name}"`).toBeDefined();

      expect(Object.keys(sharedEnum).sort()).toEqual(Object.keys(prismaEnum ?? {}).sort());
      expect(Object.values(sharedEnum).sort()).toEqual(Object.values(prismaEnum ?? {}).sort());
    });
  }
});
