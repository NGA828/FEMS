import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService, type RequestMeta } from './auth.service';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/decorators';
import { appConfig } from '../config/configuration';
import { ChangePasswordDto, LoginDto, LogoutDto, RefreshTokenDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/register.dto';
import {
  RegisterDeviceTokenDto,
  UpdateNotificationPreferenceDto,
  UpdateProfileDto,
} from './dto/profile.dto';

/**
 * Per-route rate limits for the authentication surface. Read once at module load
 * from the same configuration the global throttle uses, so an environment that
 * must absorb a burst (a load test, the end-to-end suite) raises the numbers
 * instead of switching the guard off.
 */
const AUTH_THROTTLE_LIMIT = appConfig().security.authThrottleLimit;
const AUTH_STRICT_THROTTLE_LIMIT = appConfig().security.authStrictThrottleLimit;

function metaFrom(request: Request, ip: string): RequestMeta {
  return {
    ipAddress: ip ?? request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a Forest Explorer or Company Representative account',
    description:
      'Self-service registration only. The account starts as PENDING_VERIFICATION; sign-in is blocked until the emailed code is confirmed. When SMTP is not configured the response reports the real delivery status and (outside production) returns the code so the flow can still be completed.',
  })
  @ApiResponse({ status: 201, description: 'Account created; verification code dispatched or reported as undelivered.' })
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })
  async register(@Body() dto: RegisterDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.register(dto, metaFrom(request, ip));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in and receive an access/refresh token pair',
    description:
      'Accounts lock after MAX_LOGIN_ATTEMPTS consecutive failures. Every failure and success is written to the audit trail.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated — returns tokens plus the full permission set.' })
  @ApiResponse({ status: 401, description: 'AUTH_INVALID_CREDENTIALS' })
  @ApiResponse({ status: 403, description: 'AUTH_EMAIL_NOT_VERIFIED | AUTH_ACCOUNT_LOCKED | AUTH_ACCOUNT_SUSPENDED' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.login(dto, metaFrom(request, ip));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Refresh tokens are single-use. Reusing a rotated token revokes the entire token family (stolen-token defence) and is recorded as a critical audit event.',
  })
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.refresh(dto, metaFrom(request, ip));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Sign out of one session (pass refreshToken) or every session (omit it)',
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.auth.logout(user.id, dto, metaFrom(request, ip));
  }

  @Public()
  @Post('email-verification/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm an email address with the emailed code',
    description: 'Activates the account and immediately returns a token pair so the app can continue sign-in.',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.verifyEmail(dto, metaFrom(request, ip));
  }

  @Public()
  @Post('email-verification/resend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_STRICT_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Re-send the email verification code (invalidates previous codes)' })
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.resendVerification(dto.email, metaFrom(request, ip));
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_STRICT_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password reset code',
    description: 'Always returns the same message to prevent account enumeration.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.forgotPassword(dto, metaFrom(request, ip));
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Complete a password reset',
    description: 'The reset code is single-use and every active session is revoked on success.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request, @Ip() ip: string) {
    return this.auth.resetPassword(dto, metaFrom(request, ip));
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Change the current password (revokes other sessions)' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.auth.changePassword(user, dto, metaFrom(request, ip));
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Current profile, roles and effective permissions',
    description: 'The app uses this to render the correct experience per role; the API still enforces permissions independently.',
  })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.buildProfile(user.id);
  }

  @Patch('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Update the current profile' })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.auth.updateProfile(user, dto, metaFrom(request, ip));
  }

  @Get('sessions')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List active sessions (one row per refresh-token family)' })
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Delete('sessions/:sessionId')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke a session by id' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
    @Ip() ip: string,
  ) {
    return this.auth.revokeSession(user.id, sessionId, metaFrom(request, ip));
  }

  @Post('devices')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Register an Expo/FCM/APNs push token for this device' })
  async registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceTokenDto) {
    return this.auth.registerDeviceToken(user.id, dto);
  }

  @Delete('devices')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Unregister a push token (used on sign-out)' })
  async removeDevice(@CurrentUser() user: AuthenticatedUser, @Query('token') token: string) {
    return this.auth.removeDeviceToken(user.id, token);
  }

  @Get('notification-preferences')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Notification preferences for every event type' })
  async notificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listNotificationPreferences(user.id);
  }

  @Put('notification-preferences')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Enable/disable in-app, push and email delivery for an event type' })
  async updateNotificationPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.auth.updateNotificationPreference(user.id, dto);
  }
}
