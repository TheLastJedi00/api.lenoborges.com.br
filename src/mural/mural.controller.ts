import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MuralService } from './mural.service';
import { VoteService } from './vote.service';
import { MuralStateDto } from './dto/mural-state.dto';
import { MuralQuestionDto } from './dto/mural-question.dto';
import { WinnerDto } from './dto/winner.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('mural')
@ApiBearerAuth()
@Controller('mural')
@UseGuards(FirebaseAuthGuard)
export class MuralController {
  constructor(
    private readonly mural: MuralService,
    private readonly votes: VoteService,
  ) {}

  /**
   * O `no-store` dos três GET desta classe: a resposta é por usuário e o
   * default da plataforma não é.
   *
   * Sem o header, a Vercel devolve `Cache-Control: public, max-age=0,
   * must-revalidate` e o Express carimba um ETag. O browser guarda o par
   * (validador, corpo) e passa a revalidar com `If-None-Match`, e a API
   * responde **304 sem corpo**. Quase sempre isso é transparente — o browser
   * serve o corpo do próprio cache —, mas quando o corpo é despejado e o
   * validador sobrevive, o 304 vazio chega na aplicação e o Mural abre em
   * branco. Foi o que aconteceu num celular em 27/08/2026, e limpar o cache do
   * browser resolveu, que é a assinatura do problema.
   *
   * O `public` era o segundo defeito, independente do primeiro: numa rota
   * atrás do `FirebaseAuthGuard`, ele autoriza cache compartilhado a guardar o
   * mural de um membro específico.
   *
   * Ver `fix.md` da spec 016.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Estado do ciclo semanal',
    description:
      'A virada é uma conta, não um job: o estado é derivado do relógio do ' +
      'servidor a cada leitura.',
  })
  @ApiResponse({ status: 200, type: MuralStateDto })
  async getState(@CurrentUser() user: CurrentUserData): Promise<MuralStateDto> {
    return this.mural.getState(user.id);
  }

  @Get('perguntas')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Perguntas de uma fase do ciclo' })
  @ApiQuery({ name: 'fase', enum: ['coleta', 'votacao'], required: false })
  @ApiQuery({
    name: 'ordem',
    enum: ['recentes'],
    required: false,
    description:
      'Só na coleta: `recentes` inverte para a mais nova primeiro, que é como ' +
      'o Mural abre para quem chegou por uma notificação de pergunta nova. ' +
      'Sem o parâmetro, a mais antiga primeiro, que é a ordem de quem entra ' +
      'pelo menu e lê a semana inteira.',
  })
  @ApiResponse({ status: 200, type: [MuralQuestionDto] })
  async list(
    @CurrentUser() user: CurrentUserData,
    @Query('fase') fase?: string,
    @Query('ordem') ordem?: string,
  ): Promise<MuralQuestionDto[]> {
    return this.mural.listQuestions(
      user.id,
      fase === 'coleta' ? 'coleta' : 'votacao',
      undefined,
      ordem === 'recentes',
    );
  }

  @Get('vencedoras')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Vencedoras das semanas encerradas',
    description:
      'Semana sem pergunta entra com `question: null` — é informação honesta, e ' +
      'esconder a semana faria o histórico parecer ter buracos.',
  })
  @ApiResponse({ status: 200, type: [WinnerDto] })
  async winners(@CurrentUser() user: CurrentUserData): Promise<WinnerDto[]> {
    return this.mural.listWinners(user.id);
  }

  /**
   * Escrever exige tier pago; **votar não**.
   *
   * Votar é o ato que dá valor ao mural — sem volume de voto, "a mais votada"
   * não significa nada — e é o mais barato de conceder. Quem vota lê as
   * perguntas dos outros e chega à decisão de assinar tendo visto o produto
   * funcionar. Ver a decisão 5 da spec 010.
   */
  @Post('perguntas')
  @ApiOperation({ summary: 'Escrever a pergunta da semana' })
  @ApiResponse({ status: 201, type: MuralQuestionDto })
  @ApiResponse({ status: 403, description: 'Dev Tier não escreve pergunta.' })
  @ApiResponse({ status: 409, description: 'Já perguntou nesta semana.' })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateQuestionDto,
  ): Promise<MuralQuestionDto> {
    return this.mural.createQuestion(user.id, dto);
  }

  @Put('perguntas/:id')
  @ApiOperation({
    summary: 'Reescrever a própria pergunta',
    description: 'Só enquanto a semana está em coleta.',
  })
  @ApiResponse({ status: 200, type: MuralQuestionDto })
  @ApiResponse({ status: 403, description: 'A pergunta não é sua.' })
  @ApiResponse({ status: 409, description: 'A semana já virou.' })
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
  ): Promise<MuralQuestionDto> {
    return this.mural.updateQuestion(user.id, id, dto);
  }

  @Post('perguntas/:id/voto')
  @HttpCode(204)
  @ApiOperation({ summary: 'Votar. Só na semana em votação' })
  @ApiResponse({ status: 204, description: 'Voto registrado.' })
  @ApiResponse({ status: 409, description: 'Fora da fase de votação.' })
  async vote(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<void> {
    await this.votes.vote(id, user.id);
  }

  @Delete('perguntas/:id/voto')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Desfazer o voto',
    description:
      'Idempotente: desvotar sem ter votado responde 204. Voto irreversível ' +
      'transformaria um clique errado num problema de suporte.',
  })
  @ApiResponse({ status: 204, description: 'Voto desfeito.' })
  async unvote(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<void> {
    await this.votes.unvote(id, user.id);
  }
}
