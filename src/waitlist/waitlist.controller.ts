import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { WaitlistReceiptDto } from './dto/waitlist-receipt.dto';

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Entrar na lista de espera' })
  @ApiResponse({ status: 201, description: 'Inscrição recebida (ou já existente).', type: WaitlistReceiptDto })
  @ApiResponse({ status: 400, description: 'Erro de validação ou consentimento ausente.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  @ApiResponse({ status: 500, description: 'Erro interno no banco de dados.' })
  async create(@Body() createWaitlistDto: CreateWaitlistEntryDto): Promise<WaitlistReceiptDto> {
    return this.waitlistService.create(createWaitlistDto);
  }
}


