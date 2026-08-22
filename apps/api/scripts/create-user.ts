/**
 * Creates (or resets the password of) a user account from the command line.
 *
 * Registration through the UI is the normal path; this exists for the cases it
 * cannot cover — seeding the first account on a fresh deployment, or resetting
 * a password before Phase 2 ships the email flow.
 *
 * It reuses `PasswordService` rather than calling argon2 directly, so the hash
 * is written with exactly the parameters the API verifies against and cannot
 * drift out of step with them.
 *
 *   pnpm --filter @jobpilot/api user:create -- --email you@example.com --password 'Str0ngPassword!23' --name 'Your Name'
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@jobpilot/database';
import { EmailSchema, PasswordSchema } from '@jobpilot/shared';
import { ZodError, type ZodTypeAny } from 'zod';
import { PasswordService } from '../src/modules/auth/password.service';

interface Args {
  email: string;
  password: string;
  name: string;
  admin: boolean;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  let admin = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--admin') {
      admin = true;
      continue;
    }
    if (token?.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      values.set(key, next);
      i += 1;
    }
  }

  const email = values.get('email');
  const password = values.get('password');
  if (!email || !password) {
    throw new Error(
      'Usage: --email <address> --password <password> [--name <full name>] [--admin]',
    );
  }

  return {
    email: check(EmailSchema, email, 'email'),
    password: check(PasswordSchema, password, 'password'),
    name: values.get('name') ?? 'JobPilot User',
    admin,
  };
}

/** Turns a Zod failure into one readable line instead of a JSON dump. */
function check<T extends ZodTypeAny>(schema: T, value: string, label: string): string {
  const result = schema.safeParse(value);
  if (result.success) return result.data as string;

  const reasons = result.error.issues.map((issue) => issue.message).join(' ');
  throw new Error(`Invalid ${label}: ${reasons}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const prisma = new PrismaClient();
  const passwords = new PasswordService();
  await passwords.onModuleInit();

  try {
    const passwordHash = await passwords.hash(args.password);
    const role = args.admin ? 'ADMIN' : 'USER';

    const user = await prisma.user.upsert({
      where: { email: args.email },
      create: {
        email: args.email,
        passwordHash,
        role,
        // No email-verification flow until Phase 2; an account made here is
        // explicitly trusted by whoever ran the command.
        emailVerified: true,
        profile: { create: { fullName: args.name } },
      },
      update: { passwordHash, role, emailVerified: true },
      include: { profile: { select: { fullName: true } } },
    });

    // Every live session is invalidated, so a password reset actually locks
    // out whoever was using the old one.
    const { count } = await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    console.log(`Account ready:
  email    ${user.email}
  name     ${user.profile?.fullName ?? '(none)'}
  role     ${user.role}
  sessions ${count} revoked`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    console.error(error.issues.map((issue) => issue.message).join(' '));
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
