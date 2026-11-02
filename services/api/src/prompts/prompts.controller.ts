import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/current-user.decorator.js';
import type { Response } from 'express';
import {
  PromptsService,
  PromptQueryDto,
  CreatePromptDto,
  UpdatePromptDto,
} from './prompts.service.js';
import { UserRole } from '@prisma/client';

@ApiTags('Voice Prompts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  @ApiOperation({ summary: 'List saved voice prompts for the tenant' })
  async findAll(@CurrentUser() user: AuthUser, @Query() query: PromptQueryDto) {
    return this.promptsService.findAll(user, query);
  }

  @Get('export/zip')
  @ApiOperation({ summary: 'Download all authorized voice prompts as a ZIP archive' })
  async exportZip(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const prompts = await this.promptsService.findAll(user);
    const files = prompts.map((p) => ({
      name: `${p.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`,
      content: Buffer.from(
        `Prompt: ${p.name}\nCategory: ${p.category}\nLanguage: ${p.language}\nDescription: ${p.description ?? ''}\n\n${p.promptText}\n`,
        'utf-8',
      ),
    }));

    const zipBuffer = createZipBuffer(files);
    const filename = `mycashflo-prompts-${new Date().toISOString().slice(0, 10)}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single voice prompt' })
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.promptsService.findOne(id, user);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download an individual voice prompt as a .txt file' })
  async downloadTxt(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const prompt = await this.promptsService.findOne(id, user);
    const filename = `${prompt.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    const content = `Prompt: ${prompt.name}\nCategory: ${prompt.category}\nLanguage: ${prompt.language}\nDescription: ${prompt.description ?? ''}\n\n${prompt.promptText}\n`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new voice prompt (Admin/Manager only)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromptDto) {
    return this.promptsService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update an existing voice prompt (Admin/Manager only)' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromptDto,
  ) {
    return this.promptsService.update(id, user, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a voice prompt (Admin/Manager only)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.promptsService.remove(id, user);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview a prompt template with sample data' })
  async preview(@Body() dto: { template: string }) {
    return this.promptsService.preview(dto.template);
  }
}

/**
 * Pure Node.js zero-dependency uncompressed ZIP builder.
 * Generates standard PK\x03\x04 local headers and PK\x01\x02 central directory.
 */
function createZipBuffer(files: Array<{ name: string; content: Buffer }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf-8');
    const contentBuf = file.content;
    const crc = crc32(contentBuf);

    // Local file header (30 bytes + name + content)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0, 6);          // flags
    localHeader.writeUInt16LE(0, 8);          // compression (0 = store)
    localHeader.writeUInt16LE(0, 10);         // time
    localHeader.writeUInt16LE(0, 12);         // date
    localHeader.writeUInt32LE(crc, 14);       // crc32
    localHeader.writeUInt32LE(contentBuf.length, 18); // comp size
    localHeader.writeUInt32LE(contentBuf.length, 22); // uncomp size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // name length
    localHeader.writeUInt16LE(0, 28);         // extra length

    const fileBlock = Buffer.concat([localHeader, filenameBuf, contentBuf]);
    localHeaders.push(fileBlock);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4);          // version made by
    centralHeader.writeUInt16LE(20, 6);          // version needed
    centralHeader.writeUInt16LE(0, 8);           // flags
    centralHeader.writeUInt16LE(0, 10);          // compression
    centralHeader.writeUInt16LE(0, 12);          // time
    centralHeader.writeUInt16LE(0, 14);          // date
    centralHeader.writeUInt32LE(crc, 16);        // crc32
    centralHeader.writeUInt32LE(contentBuf.length, 20); // comp size
    centralHeader.writeUInt32LE(contentBuf.length, 24); // uncomp size
    centralHeader.writeUInt16LE(filenameBuf.length, 28); // name length
    centralHeader.writeUInt16LE(0, 30);          // extra length
    centralHeader.writeUInt16LE(0, 32);          // comment length
    centralHeader.writeUInt16LE(0, 34);          // disk start
    centralHeader.writeUInt16LE(0, 36);          // internal attrs
    centralHeader.writeUInt32LE(0, 38);          // external attrs
    centralHeader.writeUInt32LE(offset, 42);     // relative offset

    centralHeaders.push(Buffer.concat([centralHeader, filenameBuf]));
    offset += fileBlock.length;
  }

  const centralDirBuffer = Buffer.concat(centralHeaders);

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);              // signature
  eocd.writeUInt16LE(0, 4);                       // disk number
  eocd.writeUInt16LE(0, 6);                       // start disk
  eocd.writeUInt16LE(files.length, 8);            // records on disk
  eocd.writeUInt16LE(files.length, 10);           // total records
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16);                 // central dir offset
  eocd.writeUInt16LE(0, 20);                      // comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
