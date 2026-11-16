import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  PASSWORD_COMPLEXITY_REGEX,
  PASSWORD_MIN_LENGTH,
} from '../../common/password-policy.js';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Existing account password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    description: 'New password (minimum 8 characters with uppercase, lowercase, and at least one number or symbol)',
    minLength: PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `New password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
  })
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message:
      'New password must contain at least one uppercase letter, one lowercase letter, and at least one number or special symbol',
  })
  newPassword: string;
}
