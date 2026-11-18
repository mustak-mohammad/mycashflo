import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token issued via recovery process' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'SecurePassword@123', description: 'New account password matching security policy' })
  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  newPassword!: string;
}
