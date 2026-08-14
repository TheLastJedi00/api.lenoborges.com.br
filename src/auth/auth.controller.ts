import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { SignupDto } from './dto/signup.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(@Body() dto: SetPasswordDto): Promise<void> {
    await this.authService.setPassword(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const { session, refreshToken } = await this.authService.login(dto);
    this.cookieService.setRefreshToken(res, refreshToken);
    return session;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const rawToken = this.cookieService.getRefreshToken(req.cookies);
    try {
      const { session, refreshToken } = await this.authService.refresh(rawToken);
      this.cookieService.setRefreshToken(res, refreshToken);
      return session;
    } catch (error) {
      this.cookieService.clearRefreshToken(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawToken = this.cookieService.getRefreshToken(req.cookies);
    await this.authService.logout(rawToken);
    this.cookieService.clearRefreshToken(res);
  }
}
