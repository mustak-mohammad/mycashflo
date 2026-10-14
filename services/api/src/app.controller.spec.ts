import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockPrisma = {
      invoice: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { outstanding: 0 }, _count: 0 }),
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      customer: {
        count: vi.fn().mockResolvedValue(0),
      },
      collectionCase: {
        count: vi.fn().mockResolvedValue(0),
      },
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status', () => {
      const res = appController.health();
      expect(res.status).toBe('ok');
      expect(res.service).toBe('myCashflo API');
    });
  });
});

