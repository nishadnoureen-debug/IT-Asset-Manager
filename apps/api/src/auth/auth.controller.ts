import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.validation';
import type { AuthUser } from './auth-user';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto } from './auth.dto';
import { AuthService, type SessionTokens } from './auth.service';
import { CurrentUser, Public } from './decorators';

export const REFRESH_COOKIE = 'itam_rt';
const COOKIE_PATH = '/api/v1/auth';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { tokens, profile } = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: profile };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { tokens, profile } = await this.auth.refresh(this.readRefreshToken(req, dto));
      this.setRefreshCookie(res, tokens);
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: profile };
    } catch (error) {
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readRefreshToken(req, dto));
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Password updated. You can now sign in.' };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { message: 'Password changed' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  private readRefreshToken(req: Request, dto: RefreshDto): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
  }

  private setRefreshCookie(res: Response, tokens: SessionTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }
}
