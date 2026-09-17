import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';
import type { AuthUser } from '../auth-user';
import { IS_PUBLIC_KEY } from '../decorators';
import { UserAccessService } from '../user-access.service';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly access: UserAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw unauthorized('UNAUTHORIZED', 'Authentication required');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        algorithms: ['HS256'],
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) throw unauthorized('TOKEN_EXPIRED', 'Access token expired');
      throw unauthorized('UNAUTHORIZED', 'Invalid access token');
    }
    if (payload.typ !== 'access' || !payload.sub) throw unauthorized('UNAUTHORIZED', 'Invalid access token');

    const user = await this.access.get(payload.sub);
    if (!user) throw unauthorized('UNAUTHORIZED', 'Account is not active');
    req.user = user;
    return true;
  }
}

function unauthorized(code: string, message: string) {
  return new UnauthorizedException({ code, message });
}
