import { IsString, IsOptional, IsEnum, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Enterprise Ltd' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'acme-corp' })
  @IsString()
  slug: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Enterprise Solutions Ltd' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'acme-enterprise' })
  @IsOptional()
  @IsString()
  slug?: string;
}

export class UpdatePlatformUserRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdatePlatformUserStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}

export class UpdateTenantStatusDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}

export class PlatformAuditLogsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by action' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by tenant ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class PlatformUsersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by tenant ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Filter by role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

