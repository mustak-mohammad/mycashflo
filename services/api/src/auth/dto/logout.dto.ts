import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Optional refresh token to revoke specific session' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
