import { randomUUID } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ROLES } from '@itam/shared';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Errors } from '../common/errors';
import { RequestContext } from '../common/context/request-context';
import type { Env } from '../config/env.validation';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth-user';
import type { AccessTokenPayload } from './guards/jwt-auth.guard';
import { PasswordService } from './password.service';
import { UserAccessService } from './user-access.service';

/** Revoked tokens presented again within this window are treated as a benign race (parallel tabs). */
const ROTATION_GRACE_MS = 30_000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface SessionTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly passwords: PasswordService,
    private readonly access: UserAccessService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async registrationOptions(): Promise<{ enabled: boolean; requiresApproval: boolean }> {
    const settings = await this.settings.get();
    return {
      enabled: settings.allowSelfRegistration,
      requiresApproval: settings.registrationRequiresApproval,
    };
  }

  /**
   * Self-service registration. By default the account is active straight away with the Employee role, so
   * the person signs in with the details they registered. When `registrationRequiresApproval` is on, the
   * account is created PENDING with no roles and administrators approve it on the Users screen. If the
   * system has no active Super Admin (fresh install), the registrant becomes the Super Admin.
   */
  async register(input: { displayName: string; email: string; password: string }) {
    const options = await this.registrationOptions();
    if (!options.enabled) {
      throw new HttpException(
        {
          code: 'REGISTRATION_DISABLED',
          message: 'Registration is turned off. Ask an administrator for an account.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    this.passwords.assertPolicy(input.password);
    const emailTaken = () =>
      Errors.conflict(
        'EMAIL_TAKEN',
        'An account with this email already exists. Sign in, or reset your password if you forgot it.',
      );
    if (
      await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
    ) {
      throw emailTaken();
    }
    const passwordHash = await this.passwords.hash(input.password);

    const outcome = await this.prisma
      .$transaction(async (tx) => {
        const superAdmin = await tx.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
        const activeSuperAdmins = await tx.user.count({
          where: { deletedAt: null, status: 'ACTIVE', roles: { some: { roleId: superAdmin.id } } },
        });
        const kind: 'bootstrap' | 'pending' | 'active' =
          activeSuperAdmins === 0 ? 'bootstrap' : options.requiresApproval ? 'pending' : 'active';
        const roleId =
          kind === 'bootstrap'
            ? superAdmin.id
            : kind === 'active'
              ? (await tx.role.findUniqueOrThrow({ where: { name: ROLES.EMPLOYEE } })).id
              : undefined;
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            passwordChangedAt: new Date(),
            status: kind === 'pending' ? 'PENDING' : 'ACTIVE',
            roles: roleId ? { create: { roleId } } : undefined,
          },
        });
        await this.activity.record(
          {
            actorId: user.id,
            action: kind === 'bootstrap' ? 'auth.register_bootstrap_admin' : 'auth.register',
            entityType: 'user',
            entityId: user.id,
            newValues: { email: input.email, displayName: input.displayName, status: user.status },
          },
          tx,
        );
        if (kind !== 'bootstrap') {
          const admins = await this.notifications.usersWithPermission(tx, 'user.create');
          await this.notifications.notifyUsers(
            tx,
            admins,
            kind === 'pending'
              ? {
                  type: 'SYSTEM',
                  title: 'New account request',
                  message: `${input.displayName} (${input.email}) asked for access. Approve and choose roles on the Users screen.`,
                  entityType: 'user',
                  entityId: user.id,
                  link: '/users?status=PENDING',
                }
              : {
                  type: 'SYSTEM',
                  title: 'New user registered',
                  message: `${input.displayName} (${input.email}) registered and has the Employee role. Change their roles or link them to an employee record on the Users screen.`,
                  entityType: 'user',
                  entityId: user.id,
                  link: `/users?search=${encodeURIComponent(input.email)}`,
                },
          );
        }
        return kind;
      })
      .catch((error: { code?: string }) => {
        // A concurrent request registered the same email first.
        if (error?.code === 'P2002') throw emailTaken();
        throw error;
      });

    switch (outcome) {
      case 'bootstrap':
        return {
          status: 'ACTIVE' as const,
          message: 'You are the first administrator of this system. You can sign in now.',
        };
      case 'active':
        return {
          status: 'ACTIVE' as const,
          message: 'Your account is ready. You can sign in now.',
        };
      default:
        return {
          status: 'PENDING' as const,
          message:
            'Request received. An administrator will review it; you can sign in once it is approved.',
        };
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const now = new Date();

    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.activity.recordSafely({
        actorId: user.id,
        action: 'auth.login_locked',
        entityType: 'user',
        entityId: user.id,
      });
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again later.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const valid = await this.passwords.verify(
      user?.deletedAt ? null : user?.passwordHash,
      password,
    );
    if (!user || user.deletedAt || !valid) {
      if (user && !user.deletedAt)
        await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      await this.activity.recordSafely({
        actorId: user?.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id,
        newValues: { email },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (user.status === 'PENDING') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_PENDING',
        message: 'Your account request is waiting for approval by an administrator.',
      });
    }
    if (user.status !== 'ACTIVE') {
      await this.activity.recordSafely({
        actorId: user.id,
        action: 'auth.login_disabled',
        entityType: 'user',
        entityId: user.id,
      });
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'This account is disabled',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });
    const tokens = await this.issueSession(user.id, randomUUID());
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
    });
    return { tokens, profile: await this.profile(user.id) };
  }

  async refresh(rawToken: string | undefined) {
    if (!rawToken) throw invalidRefresh();
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: CryptoService.sha256(rawToken) },
    });
    if (!token) throw invalidRefresh();

    const now = Date.now();
    if (token.revokedAt) {
      // Only a *rotated* token replayed after the grace window indicates theft. Tokens revoked by logout
      // or by an earlier family revocation are simply rejected.
      const replayedRotation =
        !!token.replacedAt && now - token.replacedAt.getTime() >= ROTATION_GRACE_MS;
      if (replayedRotation) {
        // A rotated token was replayed: assume theft and kill the whole session family.
        await this.prisma.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.activity.recordSafely({
          actorId: token.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'user',
          entityId: token.userId,
        });
        throw invalidRefresh();
      }
      // Rotated moments ago by a parallel request (another tab): the browser already holds the new cookie.
      if (token.replacedAt) throw refreshRace();
      throw invalidRefresh();
    }
    if (token.expiresAt.getTime() <= now) throw invalidRefresh();

    const user = await this.access.get(token.userId);
    if (!user) throw invalidRefresh();

    // Rotate: the conditional update guarantees only one concurrent request wins.
    const rotated = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedAt: new Date() },
    });
    if (rotated.count !== 1) throw refreshRace();

    const tokens = await this.issueSession(token.userId, token.familyId);
    return { tokens, profile: await this.profile(token.userId) };
  }

  async logout(rawToken: string | undefined, actorId?: string): Promise<void> {
    if (!rawToken) return;
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: CryptoService.sha256(rawToken) },
    });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.activity.recordSafely({
      actorId: actorId ?? token.userId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: token.userId,
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: 'ACTIVE' },
    });
    if (!user) return; // Same response either way — never reveal whether an account exists.

    const raw = CryptoService.randomToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: CryptoService.sha256(raw),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: user.id,
    });

    const link = `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/reset-password?token=${raw}`;
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      // No mail provider is configured yet; never log the secret link in production.
      this.logger.warn(
        `Password reset requested for user ${user.id}, but email delivery is not configured`,
      );
    } else {
      this.logger.warn(`[dev] Password reset link for ${email}: ${link}`);
    }
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    this.passwords.assertPolicy(password);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: CryptoService.sha256(rawToken) },
    });
    if (!token || token.usedAt || token.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This reset link is invalid or has expired',
      });
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.access.invalidate(token.userId);
    await this.activity.recordSafely({
      actorId: token.userId,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: token.userId,
    });
  }

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(record.passwordHash, currentPassword))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }
    this.passwords.assertPolicy(newPassword, 'newPassword');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: new Date() },
    });
    await this.activity.record({
      actorId: user.id,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
    });
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        employeeId: true,
        lastLoginAt: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            department: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        },
      },
    });
    const access = await this.access.get(userId);
    return {
      ...user,
      roles: access?.roles ?? [],
      permissions: [...(access?.permissions ?? [])].sort(),
    };
  }

  private async registerFailedAttempt(userId: string, previous: number): Promise<void> {
    const attempts = previous + 1;
    const max = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    const lockMinutes = this.config.get('LOGIN_LOCK_MINUTES', { infer: true });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts >= max ? 0 : attempts,
        lockedUntil: attempts >= max ? new Date(Date.now() + lockMinutes * 60_000) : undefined,
      },
    });
  }

  private async issueSession(userId: string, familyId: string): Promise<SessionTokens> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const payload: AccessTokenPayload = { sub: userId, sid: familyId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn,
      algorithm: 'HS256',
    });
    const refreshToken = CryptoService.randomToken();
    const refreshExpiresAt = new Date(
      Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
    );
    const ctx = RequestContext.get();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: CryptoService.sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { accessToken, expiresIn, refreshToken, refreshExpiresAt };
  }
}

/** A concurrent refresh already rotated this token; the client should retry with the newer cookie. */
function refreshRace() {
  return new UnauthorizedException({
    code: 'REFRESH_RACE',
    message: 'Session was refreshed by another request. Retry.',
  });
}

function invalidRefresh() {
  return new UnauthorizedException({
    code: 'INVALID_REFRESH_TOKEN',
    message: 'Session expired. Please sign in again.',
  });
}
