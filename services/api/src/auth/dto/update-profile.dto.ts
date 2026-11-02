import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ description: 'User display name', example: 'Mustak Mohammad' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}

