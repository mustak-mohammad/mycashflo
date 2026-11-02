import { IsEmail, IsString, IsOptional, IsEnum, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'agent@democorp.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Pooja Verma' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.AGENT })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole = UserRole.AGENT;
}
