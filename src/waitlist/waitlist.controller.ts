import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { WaitlistReceiptDto } from './dto/waitlist-receipt.dto';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createWaitlistDto: CreateWaitlistEntryDto): Promise<WaitlistReceiptDto> {
    return this.waitlistService.create(createWaitlistDto);
  }
}

