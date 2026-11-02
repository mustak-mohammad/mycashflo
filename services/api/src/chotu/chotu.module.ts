import { Module } from '@nestjs/common';
import { ChotuController } from './chotu.controller.js';
import { ChotuService } from './chotu.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [ChotuController],
  providers: [ChotuService],
  exports: [ChotuService],
})
export class ChotuModule {}
