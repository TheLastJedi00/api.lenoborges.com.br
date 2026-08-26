import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { AdminUsersService } from './admin-users.service';
import { AdminUserPageDto } from './dto/admin-user-page.dto';
import { AdminUserDetailDto } from './dto/admin-user-detail.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  LIST_USERS_DEFAULT_LIMIT,
  LIST_USERS_MAX_LIMIT,
  ListUsersQueryDto,
  ONBOARDING_FILTERS,
} from './dto/list-users-query.dto';
import { TIER_IDS } from '../billing/billing.tiers';
import { SendDirectEmailDto } from './dto/send-direct-email.dto';
import { EmailCampaignService } from '../emails/email-campaign.service';
import { CampaignResultDto } from '../emails/dto/campaign.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly campaigns: EmailCampaignService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Encontrar um membro na base inteira',
    description:
      'A BUSCA E OS FILTROS SÃO APLICADOS SOBRE A BASE INTEIRA, ANTES DA ' +
      'PAGINAÇÃO. Sem esta frase, quem lê a documentação supõe que o filtro age ' +
      'sobre a página — que é exatamente o erro que a spec 015 existe para não ' +
      'cometer: com 213 membros, um filtro sobre uma página de 50 devolveria os ' +
      'que por acaso caíram nos primeiros 50 uids e a tela diria "3 membros" com ' +
      'toda a confiança do mundo.\n\n' +
      'Junta a identidade do Firebase Auth com o perfil do Firestore. Quem ainda ' +
      'não concluiu o onboarding aparece com os campos de perfil nulos — e não ' +
      'pode sumir da lista, porque é quem o admin mais precisa ver.\n\n' +
      'Ordem: os mais recentes primeiro (`createdAt` decrescente). NÃO é a ordem ' +
      'da audiência de e-mail, que é por `uid` porque o cursor de retomada ' +
      'depende de uma ordem estável entre execuções.\n\n' +
      '`phone` NÃO sai aqui: ele vive só em `GET /admin/users/:id`.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    example: 'borges',
    description:
      'Trecho de nome ou e-mail, sem acento e sem caixa. É contains, e não ' +
      'prefixo. Telefone não é buscável',
  })
  @ApiQuery({
    name: 'onboarding',
    required: false,
    enum: ONBOARDING_FILTERS as unknown as string[],
    description:
      '`pendente` traz quem criou conta e não terminou, INCLUSIVE quem não tem ' +
      'documento de perfil nenhum. Ausente traz os dois',
  })
  @ApiQuery({
    name: 'tiers',
    required: false,
    isArray: true,
    enum: TIER_IDS as unknown as string[],
    description: 'Ausente significa TODOS os tiers, e nunca nenhum',
  })
  @ApiQuery({
    name: 'gradeMin',
    required: false,
    example: 1,
    description: 'Insígnia mínima, inclusiva. Maior que a máxima responde 400',
  })
  @ApiQuery({
    name: 'gradeMax',
    required: false,
    example: 8,
    description: 'Insígnia máxima, inclusiva',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: LIST_USERS_DEFAULT_LIMIT,
    description: `Padrão ${LIST_USERS_DEFAULT_LIMIT}. Acima de ${LIST_USERS_MAX_LIMIT} é fixado no teto, sem erro`,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    example: 0,
    description: 'Deslocamento DENTRO do recorte, e não dentro da base',
  })
  @ApiResponse({ status: 200, type: AdminUserPageDto })
  @ApiResponse({
    status: 400,
    description: 'A insígnia mínima é maior que a máxima.',
  })
  @ApiResponse({ status: 403, description: 'Não é administrador.' })
  async list(@Query() query: ListUsersQueryDto): Promise<AdminUserPageDto> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Um membro inteiro',
    description:
      'O ÚNICO lugar em que dado pessoal de terceiro sai desta API: telefone, ' +
      'bio e redes sociais. É rota própria, e não campos a mais na listagem, ' +
      'porque uma listagem que carrega isso de 200 pessoas trafega dado pessoal ' +
      'que ninguém pediu.\n\n' +
      'Usuário sem documento de perfil responde 200 com os campos de perfil ' +
      'nulos, e NUNCA 404: ele existe, é quem o filtro de onboarding pendente ' +
      'encontra, e um 404 aqui diria "não existe" sobre quem a lista acabou de ' +
      'mostrar.\n\n' +
      'ISTO NÃO É O PERFIL PÚBLICO DE MEMBRO que a spec 013 adiou — aquela ' +
      'decisão é sobre membro vendo membro, e continua valendo. Aqui é o admin ' +
      'vendo o cadastro, atrás do AdminGuard.',
  })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 404, description: 'Esse uid não existe no Auth.' })
  async detail(@Param('id') id: string): Promise<AdminUserDetailDto> {
    return this.users.getUser(id);
  }

  /**
   * Escreve um e-mail para aquele membro (spec 015, decisão 10).
   *
   * **A rota é do usuário, e não da campanha**, porque é sobre ele que a ação
   * fala: quem a chama está olhando para uma pessoa, e não montando uma
   * audiência. Por dentro, ela cria um `email_campaigns` com `kind: 'direto'` e
   * chama o **mesmo** `EmailCampaignService` — nenhum caminho de envio novo.
   */
  @Post(':id/email')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Escrever um e-mail para um membro',
    description:
      'Cria uma campanha `direto` e envia pelo MESMO caminho da campanha: o ' +
      'mesmo template, o mesmo lote, o mesmo rodapé de descadastro.\n\n' +
      'O DESCADASTRO VALE AQUI TAMBÉM. Não existe "e-mail que ignora o ' +
      'descadastro" neste código — nem o de vídeo, nem a campanha, nem este. ' +
      'Parece severo para uma mensagem a uma pessoa, e é a leitura errada do que ' +
      'esta rota é: ela manda um e-mail com o remetente, o template e o rodapé ' +
      'do produto. A conversa pessoal tem outro caminho, que é o cliente de ' +
      'e-mail de quem escreve.\n\n' +
      'Sem `ctaLabel` e sem `ctaUrl`: um recado para uma pessoa não tem para ' +
      'onde apontar.',
  })
  @ApiResponse({
    status: 201,
    description: 'Enviado.',
    type: CampaignResultDto,
  })
  @ApiResponse({ status: 404, description: 'Esse uid não existe no Auth.' })
  @ApiResponse({
    status: 409,
    description:
      'Já existe um disparo em andamento. O trinco de um disparo por vez vale ' +
      'aqui também: abrir exceção significaria uma segunda porta para o ' +
      'provedor no mesmo instante.',
  })
  @ApiResponse({
    status: 422,
    description:
      'O membro não pode receber. O corpo traz `reason` com um dos três ' +
      'valores: `desativado`, `email-nao-verificado`, `descadastrado`. A TELA ' +
      'ESCOLHE O TEXTO PELO CÓDIGO, e nunca por leitura da mensagem — texto de ' +
      'erro não é contrato.',
    schema: {
      example: {
        statusCode: 422,
        reason: 'descadastrado',
        message: 'Esse membro pediu para não receber e-mails.',
      },
    },
  })
  async sendEmail(
    @CurrentUser() admin: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SendDirectEmailDto,
  ): Promise<CampaignResultDto> {
    return this.campaigns.sendDirect({
      recipientUid: id,
      subject: dto.subject,
      body: dto.body,
      createdBy: admin.id,
    });
  }

  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Alterar o grade de um membro',
    description:
      'Só `grade`. Promover a admin é script de terminal, e apagar usuário não ' +
      'existe nesta spec.',
  })
  @ApiResponse({ status: 204, description: 'Alterado.' })
  @ApiResponse({ status: 404, description: 'Usuário sem perfil.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<void> {
    await this.users.updateUser(id, dto);
  }
}
