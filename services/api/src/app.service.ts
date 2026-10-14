import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  healthCheck() {
    return {
      status: 'ok',
      service: 'myCashflo API',
      timestamp: new Date().toISOString(),
    };
  }
}
