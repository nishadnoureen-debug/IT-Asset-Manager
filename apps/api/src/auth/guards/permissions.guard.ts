import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth-user';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user && required.some((key) => user.permissions.has(key))) return true;

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action',
    });
  }
}
