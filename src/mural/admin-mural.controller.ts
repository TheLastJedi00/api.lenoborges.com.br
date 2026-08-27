import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MuralService } from './mural.service';
import { MuralQuestionDto } from './dto/mural-question.dto';
import { PromoteQuestionDto } from './dto/promote-question.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/mural')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminMuralController {
  constructor(private readonly mural: MuralService) {}

  @Delete('perguntas/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Moderar: remover uma pergunta',
    description:
      'Para pergunta ofensiva, duplicada ou fora de tema. **Apaga os votos ' +
      'junto** — subcoleção não desaparece com o pai no Firestore, e votos ' +
      'órfãos são invisíveis e cobrados.',
  })
  @ApiResponse({ status: 204, description: 'Removida.' })
  @ApiResponse({ status: 403, description: 'Não é administrador.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.mural.remove(id);
  }

  /**
   * Adiantar fica aqui, ao lado do `DELETE` que ja modera, e nao no controller
   * aberto do mural. A separacao vale por si: uma rota de admin no controller
   * aberto e uma rota que alguem protege com um `if` dentro do service um dia.
   */
  @Patch('perguntas/:id/fase')
  @ApiOperation({
    summary: 'Adiantar uma pergunta',
    description:
      '`votacao` abre o voto agora, sem esperar domingo; `encerrada` tira a ' +
      'pergunta do Mural e a poe na pauta, para gravar o vídeo hoje.\n\n' +
      '**A promoção é de mão única** — `coleta → votacao → encerrada`, e nunca ' +
      'o contrário. Não é rigidez: despromover deixaria a pergunta editável de ' +
      'novo **com votos em cima dela**, e quem votou votou naquele texto. O ' +
      'caminho de arrependimento é o `DELETE` desta mesma classe, que apaga os ' +
      'votos junto.\n\n' +
      '**Adianta uma pergunta só.** A votação das demais continua exatamente ' +
      'como estava e o ciclo da semana não se move: quem ficou na coleta ' +
      'continua na coleta até domingo, e a semana continua elegendo a ' +
      'vencedora dela entre as que sobraram.',
  })
  @ApiResponse({ status: 200, type: MuralQuestionDto })
  @ApiResponse({ status: 403, description: 'Não é administrador.' })
  @ApiResponse({ status: 404, description: 'Pergunta não encontrada.' })
  @ApiResponse({
    status: 409,
    description:
      'A pergunta já está nessa fase, ou já passou dela. A promoção não anda ' +
      'para trás',
  })
  async promote(
    @Param('id') id: string,
    @Body() dto: PromoteQuestionDto,
  ): Promise<MuralQuestionDto> {
    return this.mural.promote(id, dto.fase);
  }
}
