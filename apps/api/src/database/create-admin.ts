import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { PASSWORD_POLICY, ROLES } from '@itam/shared';
import { seedDatabase } from './seed';

/**
 * Bootstrap (or recover) a Super Admin account.
 *
 *   npm run user:create-admin -- --email admin@company.com --name "IT Admin" [--password '...'] [--reset-password]
 *
 * Without --password a strong random password is generated and printed once.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

function generatePassword(): string {
  // 18 random bytes → 24 base64url chars; append a digit/letter pair to satisfy the policy deterministically.
  return `${randomBytes(18).toString('base64url')}a7`;
}

async function main() {
  const email = (arg('email') ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const displayName = arg('name') || process.env.BOOTSTRAP_ADMIN_NAME || 'Super Admin';
  const resetPassword = process.argv.includes('--reset-password');
  let password = arg('password') || process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const generated = !password;
  if (generated) password = generatePassword();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Provide --email <address>');
  if (!PASSWORD_POLICY.pattern.test(password))
    throw new Error(`Password policy: ${PASSWORD_POLICY.description}`);

  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
    const existing = await prisma.user.findUnique({ where: { email } });
    const passwordHash = await hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });

    if (existing && !resetPassword) {
      console.log(`User ${email} already exists. Use --reset-password to set a new password.`);
      return;
    }

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            status: 'ACTIVE',
            failedLoginAttempts: 0,
            lockedUntil: null,
            deletedAt: null,
          },
        })
      : await prisma.user.create({
          data: { email, displayName, passwordHash, passwordChangedAt: new Date() },
        });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    if (existing)
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await prisma.activityLog.create({
      data: {
        actorId: user.id,
        action: existing ? 'user.bootstrap_reset' : 'user.bootstrap_create',
        entityType: 'user',
        entityId: user.id,
        newValues: { email, via: 'cli' },
      },
    });

    console.log(`${existing ? 'Password reset for' : 'Created Super Admin'} ${email}`);
    if (generated) console.log(`Generated password (shown once): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
