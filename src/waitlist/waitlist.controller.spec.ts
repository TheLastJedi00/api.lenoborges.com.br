import { Test, TestingModule } from '@nestjs/testing';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistReceiptDto } from './dto/waitlist-receipt.dto';

describe('WaitlistController', () => {
  let controller: WaitlistController;
  let service: WaitlistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WaitlistController],
      providers: [
        {
          provide: WaitlistService,
          useValue: {
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WaitlistController>(WaitlistController);
    service = module.get<WaitlistService>(WaitlistService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call service and return receipt on POST', async () => {
    const dto = { name: 'Test', phone: '11999998888', email: 'test@test.com', consent: true };
    const receipt: WaitlistReceiptDto = { id: 'uuid', receivedAt: new Date() };

    jest.spyOn(service, 'create').mockResolvedValue(receipt);

    const result = await controller.create(dto);
    expect(result).toEqual(receipt);
    expect(service.create).toHaveBeenCalledWith(dto);
  });
});
