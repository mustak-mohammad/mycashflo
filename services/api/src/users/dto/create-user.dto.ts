import { IsEmail, IsString, IsOptional, IsEnum, MinLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  PASSWORD_COMPLEXITY_MESSAGE,
  PASSWORD_COMPLEXITY_REGEX,
  PASSWORD_LENGTH_MESSAGE,
  PASSWORD_MIN_LENGTH,
} from '../../common/password-policy.js';

export class CreateUserDto {
  @ApiProperty({ example: 'agent@democorp.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Pooja Verma' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'SecurePass123!',
    description: 'Password (minimum 8 characters with uppercase, lowercase, and at least one number or symbol)',
    minLength: PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_LENGTH_MESSAGE })
  @Matches(PASSWORD_COMPLEXITY_REGEX, { message: PASSWORD_COMPLEXITY_MESSAGE })
  password: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.AGENT })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole = UserRole.AGENT;
}
