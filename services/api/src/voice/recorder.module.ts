import { Module } from '@nestjs/common';
import { RecorderService } from './recorder.service.js';

@Module({
  providers: [RecorderService],
  exports: [RecorderService],
})
export class RecorderModule {}
