import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { PublicMemberDto } from './dto/public-member.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

/**
 * O cartao de um membro, para os outros membros (spec 019, decisao 8).
 *
 * **Controller proprio**, porque o prefixo nao e `/me`: pendurar isto em
 * `/me/members/:uid` seria dizer que o cartao de outra pessoa e um recurso meu.
 *
 * **Exige sessao, e nao e publica.** Ler o cartao e ler o perfil de outra
 * pessoa; a landing nao precisa disso, e uma rota publica com `uid` na URL e uma
 * base de nomes e bios enumeravel por quem tiver a lista de uids.
 *
 * Passa pelo `LegalAcceptanceGuard` como qualquer rota autenticada, e nenhuma
 * linha precisou ser escrita para isso: quem nao aceitou os termos nao abre
 * cartao de ninguem.
 */
@ApiTags('membros')
@ApiBearerAuth()
@Controller('members')
@UseGuards(FirebaseAuthGuard)
export class MembersController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':uid')
  @ApiOperation({
    summary: 'O cartão público de um membro',
    description:
      'Nome, bio, etapa da trilha, XP e — **se o membro tiver ligado o ' +
      'interruptor** — as redes sociais. Nada além disso: sem e-mail, sem ' +
      'telefone, sem tier e sem papel.\n\n' +
      '404 quando o perfil não existe **ou quando o onboarding não terminou** — ' +
      'uma conta pela metade não tem nome nem bio, e responder 200 com um cartão ' +
      'vazio é pior do que responder que não há.',
  })
  @ApiResponse({ status: 200, type: PublicMemberDto })
  @ApiResponse({ status: 404, description: 'Membro não encontrado.' })
  async findMember(@Param('uid') uid: string): Promise<PublicMemberDto> {
    return this.profileService.findPublicMember(uid);
  }
}
