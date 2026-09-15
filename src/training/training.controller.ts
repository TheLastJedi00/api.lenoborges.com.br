import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { TrainingService } from './training.service';
import { CreateTrainingCommentDto } from './dto/create-comment.dto';
import { CompleteTrainingDto } from './dto/complete-training.dto';
import { ResultImageDto } from './dto/result-image.dto';
import { MAX_UPLOAD_BYTES } from '../storage/storage.constants';
import {
  TrainingCommentDto,
  TrainingCommentListDto,
  TrainingCompletionDto,
  TrainingDto,
  TrainingListDto,
} from './dto/training.dto';

/**
 * A Arena de Treinamento, para o membro (spec 023).
 *
 * Exige sessão e **nada mais** na porta -- a regra de tier vale só para
 * escrever comentário, e mora no service, onde o perfil já é lido. Um guard de
 * tier no controller inteiro trancaria a leitura da Arena para o Dev Tier, que
 * é o contrário do que a decisão 3 pede: ele lê a conversa e não escreve.
 *
 * **Sem isenção do `LegalAcceptanceGuard`**: quem não aceitou os termos não
 * treina, não ganha XP e não comenta. É uma rota autenticada comum, e não
 * precisou de nenhuma linha para ser assim.
 */
@ApiTags('arena de treinamento')
@ApiBearerAuth()
@Controller()
@UseGuards(FirebaseAuthGuard)
export class TrainingController {
  constructor(private readonly trainings: TrainingService) {}

  @Get('badges/:badgeId/trainings')
  @ApiOperation({
    summary: 'Desafios de uma insígnia, na ordem',
    description:
      'Insígnia sem desafio responde 200 com lista vazia — é o estado normal ' +
      'do produto, não um erro. 404 só quando a insígnia não existe na trilha.\n\n' +
      '`completed` é de **quem pediu**, e é o único campo que muda de membro ' +
      'para membro: um cache colocado sem olhar isto serve o check de uma ' +
      'pessoa para outra sem falhar em nada.',
  })
  @ApiResponse({ status: 200, type: TrainingListDto })
  @ApiResponse({ status: 404, description: 'Insígnia inexistente.' })
  async list(
    @CurrentUser() user: CurrentUserData,
    @Param('badgeId') badgeId: string,
  ): Promise<TrainingListDto> {
    return this.trainings.listByBadge(user.id, badgeId);
  }

  @Get('trainings/:trainingId')
  @ApiOperation({
    summary: 'Um desafio, com o estado de conclusão de quem pediu',
  })
  @ApiResponse({ status: 200, type: TrainingDto })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async getOne(
    @CurrentUser() user: CurrentUserData,
    @Param('trainingId') trainingId: string,
  ): Promise<TrainingDto> {
    return this.trainings.getOne(user.id, trainingId);
  }

  @Post('trainings/:trainingId/complete')
  @ApiOperation({
    summary: 'Conclui o desafio e paga o XP',
    description:
      '**Idempotente**: concluir de novo responde 200 com `xpAwarded: 0` e o ' +
      '`xp` do perfil intacto. O XP é pago uma vez por desafio, para sempre — ' +
      'quem impede o segundo pagamento é o `ALREADY_EXISTS` derrubando o lote ' +
      'inteiro, e não um `if` antes da escrita.\n\n' +
      'O `xp` da resposta é **o do servidor**: a tela pinta este número em vez ' +
      'de somar localmente, senão ela acerta no primeiro clique de cada desafio ' +
      'e erra em todos os seguintes.\n\n' +
      'O valor pago depende das dicas reveladas: `xpAmount` menos 1 por dica, ' +
      'nunca abaixo de zero (spec 025). **O servidor não tem como conferir esse ' +
      'número** — o estado vive na tela, e quem quiser mandar `0` leva o prêmio ' +
      'cheio. O teto, no número de dicas do desafio, é a única defesa, e o ' +
      'corpo é opcional: ausente é zero, que é o que a tela anterior fazia.' +
      '\n\n' +
      '**A submissão entra aqui** (spec 027): `mainCode` para qualquer tier, ' +
      'e `resultImageUrl` só do Great Dev Tier para cima. A URL da foto ' +
      'precisa ser a que `POST /trainings/:trainingId/result-image` ' +
      'devolveu **para este membro e este desafio** — a rota de upload já barra ' +
      'o tier, mas ela e esta são duas chamadas.\n\n' +
      'Como a segunda conclusão não escreve nada, **a submissão gravada é a da ' +
      'primeira**: não existe reenviar a resposta.',
  })
  @ApiResponse({ status: 201, type: TrainingCompletionDto })
  @ApiResponse({
    status: 400,
    description:
      'Código acima de 20000 caracteres, ou foto que não é a que esta API devolveu para este desafio.',
  })
  @ApiResponse({
    status: 403,
    description: 'Dev Tier tentando enviar foto de resultado.',
  })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async complete(
    @CurrentUser() user: CurrentUserData,
    @Param('trainingId') trainingId: string,
    @Body() dto: CompleteTrainingDto,
  ): Promise<TrainingCompletionDto> {
    return this.trainings.complete(user.id, trainingId, dto);
  }

  /**
   * Sobe a foto do resultado (spec 027).
   *
   * **Rota separada da conclusao de proposito.** Um `complete` multipart
   * misturaria o corpo JSON com o arquivo e faria a conclusao -- que paga XP e e
   * idempotente -- depender de um upload que pode falhar no meio. Aqui o arquivo
   * sobe primeiro, a URL volta, e a conclusao segue sendo JSON.
   *
   * **A trava de tier de verdade esta aqui**, antes de o byte entrar no bucket. O
   * `complete` confere de novo, porque sao duas chamadas.
   */
  @Post('trainings/:trainingId/result-image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'A foto do resultado, no maximo 5 MB, jpeg/png/webp',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Enviar a foto do resultado do desafio (Great Dev Tier ou acima)',
    description:
      'Devolve a `resultImageUrl` para mandar no `complete`. ' +
      '**O tier é conferido antes de o arquivo entrar no bucket**: validar ' +
      'depois deixaria no Storage a foto de quem não tinha direito de mandá-la, ' +
      'cobrada e pública, para responder `403` em seguida.\n\n' +
      'O tipo sai dos bytes do arquivo, nunca do `Content-Type` da parte ' +
      'nem da extensão do nome.',
  })
  @ApiResponse({ status: 201, type: ResultImageDto })
  @ApiResponse({
    status: 400,
    description: 'Arquivo ausente, acima de 5 MB, ou que não é jpeg/png/webp.',
  })
  @ApiResponse({
    status: 403,
    description: 'Dev Tier. A mensagem diz como assinar.',
  })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async uploadResultImage(
    @CurrentUser() user: CurrentUserData,
    @Param('trainingId') trainingId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ResultImageDto> {
    const resultImageUrl = await this.trainings.uploadResultImage(
      user.id,
      trainingId,
      file,
    );

    return { resultImageUrl };
  }

  @Get('trainings/:trainingId/comments')
  @ApiOperation({
    summary: 'Comentários do desafio, mais recentes primeiro',
    description:
      'Lista plana, sem fios: cada comentário carrega no máximo uma resposta ' +
      'do admin, em `adminReply`. `nextCursor` vem nulo quando a página é a ' +
      'última — um "Mostrar mais" que devolve vazio é um botão que mente.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description:
      'Quantos comentários por página. Padrão 10, teto 50. Acima do teto é ' +
      'fixado no teto, **sem erro**: é paginação, não pedido de dados',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    description:
      'O `nextCursor` da página anterior. É o id do último comentário dela, e ' +
      'não uma data: um Timestamp formatado pelo cliente pula ou repete linha ' +
      'na primeira divergência de fuso',
  })
  @ApiResponse({ status: 200, type: TrainingCommentListDto })
  @ApiResponse({ status: 404, description: 'Treinamento inexistente.' })
  async listComments(
    @Param('trainingId') trainingId: string,
    @Query('limit') limit?: string,
    @Query('after') after?: string,
  ): Promise<TrainingCommentListDto> {
    return this.trainings.listComments(trainingId, {
      // A query string chega como texto. `Number('abc')` é `NaN`, e o service
      // recusa: um limite ilegível é engano de quem chamou, e devolver a página
      // padrão esconderia o erro em vez de mostrá-lo.
      limit: limit === undefined ? undefined : Number(limit),
      after,
    });
  }

  @Post('trainings/:trainingId/comments')
  @ApiOperation({
    summary: 'Comenta no desafio (Great Tier ou superior)',
    description:
      'O tier é validado no service, onde o perfil já é lido. O 403 do Dev ' +
      'Tier traz o caminho para assinar: um 403 sem saída é a forma mais cara ' +
      'de perder um upgrade.',
  })
  @ApiResponse({ status: 201, type: TrainingCommentDto })
  @ApiResponse({ status: 403, description: 'Dev Tier não comenta.' })
  @ApiResponse({
    status: 404,
    description: 'Treinamento ou perfil inexistente.',
  })
  async addComment(
    @CurrentUser() user: CurrentUserData,
    @Param('trainingId') trainingId: string,
    @Body() dto: CreateTrainingCommentDto,
  ): Promise<TrainingCommentDto> {
    return this.trainings.addComment(user.id, trainingId, dto);
  }
}
