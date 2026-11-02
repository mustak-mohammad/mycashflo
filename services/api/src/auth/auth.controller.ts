import { Controller, Post, Get, Patch, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { GoogleAuthDto } from './dto/google-auth.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from './current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns user info and JWT tokens' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue new token pair' })
  @ApiResponse({ status: 200, description: 'Returns new access token and rotated refresh token' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, revoked, or reused refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Returns authenticated user profile' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.userId, user.tenantId);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update authenticated user display name' })
  @ApiResponse({ status: 200, description: 'Profile display name updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error: display name cannot be empty' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, user.tenantId, dto);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update authenticated user display name (alias)' })
  @ApiResponse({ status: 200, description: 'Profile display name updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error: display name cannot be empty' })
  updateProfileMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, user.tenantId, dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke refresh token and terminate session' })
  @ApiResponse({ status: 200, description: 'Session successfully revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (cannot revoke session belonging to another user)' })
  logout(@CurrentUser() user: AuthUser, @Body() dto: LogoutDto) {
    return this.authService.logout(user.userId, dto?.refreshToken);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in or Sign up with Google OAuth ID token' })
  @ApiResponse({ status: 200, description: 'Returns user info and JWT tokens' })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  googleAuth(@Body() dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto);
  }
}


