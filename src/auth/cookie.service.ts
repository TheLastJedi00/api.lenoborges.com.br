import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response, CookieOptions } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'eduleno_rt';

@Injectable()
export class CookieService {
  private readonly secure: boolean;
  private readonly sameSite: 'lax' | 'strict' | 'none';
  private readonly maxAgeMs: number;

  constructor(private readonly configService: ConfigService) {
    this.secure =
      this.configService.get<string>('AUTH_COOKIE_SECURE') === 'true';
    this.sameSite = (this.configService.get<string>('AUTH_COOKIE_SAMESITE') ??
      'lax') as 'lax' | 'strict' | 'none';

    const maxAgeDays = Number(
      this.configService.get<string | number>('AUTH_COOKIE_MAX_AGE_DAYS') ?? 30,
    );
    this.maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  }

  getCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path: '/auth',
      maxAge: this.maxAgeMs,
    };
  }

  setRefreshToken(res: Response, token: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, this.getCookieOptions());
  }

  clearRefreshToken(res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path: '/auth',
    });
  }

  getRefreshToken(cookies?: Record<string, string>): string | undefined {
    return cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  }
}
