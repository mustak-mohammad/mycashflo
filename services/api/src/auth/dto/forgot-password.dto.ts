import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@company.com', description: 'Registered account email address' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
