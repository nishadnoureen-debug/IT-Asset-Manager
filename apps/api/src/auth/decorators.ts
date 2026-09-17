import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@itam/shared';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'requiredPermissions';

/** Skip authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Require at least one of the given permissions (checked in the backend on every request). */
export const RequirePermissions = (...anyOf: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, anyOf);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
