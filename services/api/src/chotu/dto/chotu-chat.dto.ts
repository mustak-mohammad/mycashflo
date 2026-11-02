import { IsString, IsNotEmpty, IsOptional, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChotuChatRequestDto {
  @ApiProperty({
    example: 'Which invoices are overdue?',
    description: 'The user conversational message (max 1000 characters)',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({
    example: 'conv_123456',
    description: 'Client conversation identifier for session continuity',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;

  @ApiPropertyOptional({
    example: '/invoices',
    description: 'Current client route or page identifier for contextual navigation guidance',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currentPage?: string;

  @ApiPropertyOptional({
    example: 'inv_abc123',
    description: 'Optional ID of the currently viewed customer or invoice record',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  selectedRecordId?: string;
}

export class ChotuChatResponseDto {
  @ApiProperty({ description: 'Chotu conversational assistant response' })
  reply: string;

  @ApiProperty({ description: 'Contextual suggested follow-up questions', type: [String] })
  suggestedQuestions: string[];

  @ApiProperty({ description: 'Conversation identifier' })
  conversationId: string;

  @ApiPropertyOptional({ description: 'Whether specific queried data was not found or unavailable' })
  dataUnavailable?: boolean;

  @ApiPropertyOptional({ description: 'Optional contextual metadata for client navigation' })
  suggestedRoute?: string;
}
