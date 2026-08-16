import { Module } from '@nestjs/common';
import { WaitlistRepository } from './waitlist.repository';
import { WaitlistService } from './waitlist.service';
import { WaitlistController } from './waitlist.controller';

@Module({
  controllers: [WaitlistController],
  providers: [WaitlistRepository, WaitlistService],
  exports: [WaitlistService, WaitlistRepository],
})
export class WaitlistModule {}
