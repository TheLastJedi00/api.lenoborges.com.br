import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { CookieService, REFRESH_TOKEN_COOKIE_NAME } from './cookie.service';

describe('CookieService', () => {
  let service: CookieService;
  let configService: ConfigService;
  let res: Response;
  let mockCookie: jest.Mock;
  let mockClearCookie: jest.Mock;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'AUTH_COOKIE_SECURE':
            return 'false';
          case 'AUTH_COOKIE_SAMESITE':
            return 'lax';
          case 'AUTH_COOKIE_MAX_AGE_DAYS':
            return 30;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    service = new CookieService(configService);

    mockCookie = jest.fn();
    mockClearCookie = jest.fn();
    res = {
      cookie: mockCookie,
      clearCookie: mockClearCookie,
    } as unknown as Response;
  });

  it('should set refresh token cookie with HttpOnly, lax, secure=false, path=/auth and 30 days maxAge', () => {
    service.setRefreshToken(res, 'test-refresh-token');

    expect(mockCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'test-refresh-token',
      {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/auth',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    );
  });

  it('should clear refresh token cookie with matching options', () => {
    service.clearRefreshToken(res);

    expect(mockClearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/auth',
    });
  });

  it('should extract refresh token from cookies object', () => {
    const cookies = {
      [REFRESH_TOKEN_COOKIE_NAME]: 'my-refresh-token',
      other: 'val',
    };
    expect(service.getRefreshToken(cookies)).toBe('my-refresh-token');
    expect(service.getRefreshToken({})).toBeUndefined();
    expect(service.getRefreshToken(undefined)).toBeUndefined();
  });
});
