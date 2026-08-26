import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRecord } from 'firebase-admin/auth';
import { ProfileRepository } from '../profile/profile.repository';
import { Profile } from '../profile/entities/profile.entity';
import { cannotReceiveEmailReason } from '../emails/email-eligibility';
import { AdminUserDetailDto } from './dto/admin-user-detail.dto';
import { roleOf } from '../auth/role';
import { normalizeSearchText } from '../common/normalize';
import { AdminUserDto } from './dto/admin-user.dto';
import { AdminUserPageDto } from './dto/admin-user-page.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  LIST_USERS_DEFAULT_LIMIT,
  LIST_USERS_MAX_LIMIT,
  ListUsersQueryDto,
} from './dto/list-users-query.dto';
import {
  DirectoryMember,
  MemberDirectoryService,
} from './member-directory.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly directory: MemberDirectoryService,
  ) {}

  /**
   * A base inteira, recortada por busca e filtros, paginada por `offset`.
   *
   * **A ordem das quatro etapas é o desenho inteiro** (spec 015, decisão 1):
   * varrer, filtrar, ordenar, fatiar. Filtrar depois de fatiar é filtrar uma
   * página — com 213 membros e um filtro de "onboarding pendente", uma página de
   * 50 devolveria os pendentes que por acaso caíram nos primeiros 50 `uid`s, e a
   * tela diria "3 membros" com toda a confiança do mundo, sem nada denunciar.
   *
   * **`total` é o tamanho do recorte, e não da base** (decisão 2). Ele só existe
   * porque a varredura é completa; o `pageToken` do Auth nunca soube dizer
   * quantos faltavam, porque era cursor de uma lista que ele mesmo montava.
   */
  async list(query: ListUsersQueryDto): Promise<AdminUserPageDto> {
    if (
      query.gradeMin != null &&
      query.gradeMax != null &&
      query.gradeMin > query.gradeMax
    ) {
      // Faixa invertida e engano de digitacao. Um recorte vazio em silencio
      // esconderia isso, e o admin procuraria o defeito na base.
      throw new BadRequestException(
        'A insígnia mínima não pode ser maior que a máxima.',
      );
    }

    const recorte = (await this.directory.loadAll())
      .filter((membro) => this.matchesSearch(membro, query.q))
      .filter((membro) => this.matchesOnboarding(membro, query.onboarding))
      .filter((membro) => this.matchesTier(membro, query.tiers))
      .filter((membro) => this.matchesGrade(membro, query));

    // Os mais recentes primeiro (decisao 3): e a ordem da pergunta que o admin
    // faz mais vezes, "quem entrou esta semana". Ela so e possivel agora, porque
    // ordenar a base inteira exige ter a base inteira.
    recorte.sort((a, b) => criadoEm(b.user) - criadoEm(a.user));

    // Acima do teto e fixado no teto, sem erro: e paginacao, e nao pedido de
    // dados.
    const limit = Math.min(
      query.limit ?? LIST_USERS_DEFAULT_LIMIT,
      LIST_USERS_MAX_LIMIT,
    );
    const offset = query.offset ?? 0;

    return {
      users: recorte
        .slice(offset, offset + limit)
        .map((membro) => this.toDto(membro.user, membro.profile)),
      total: recorte.length,
      offset,
      limit,
    };
  }

  /**
   * Um membro inteiro (spec 015, decisão 8).
   *
   * Duas leituras por caminho: `getUser` do Auth e `profiles/{uid}`. Nenhuma
   * consulta, nenhum índice.
   *
   * **Usuário sem documento de perfil responde 200 com os campos nulos, e nunca
   * 404.** Ele existe — é justamente quem o filtro de onboarding pendente
   * encontra —, e um 404 aqui faria a tela dizer "não existe" sobre a pessoa que
   * ela acabou de listar. O 404 fica reservado para o `uid` que o Auth não
   * conhece, que é a única ausência real.
   */
  async getUser(userId: string): Promise<AdminUserDetailDto> {
    const membro = await this.directory.loadOne(userId);
    if (!membro) {
      throw new NotFoundException('Esse membro não existe.');
    }

    const { user, profile } = membro;

    // A pergunta "pode receber e-mail" tem uma implementacao so, e e a mesma que
    // corta a audiencia (decisao 12). Duas seriam como a tela passa a oferecer
    // um envio que a API recusa com 422, depois de o admin escrever o recado
    // inteiro.
    const cannotReceiveReason = cannotReceiveEmailReason(user, profile);

    return {
      ...this.toDto(user, profile),
      phone: profile?.phone ?? null,
      bio: profile?.bio ?? null,
      linkedin: profile?.linkedin ?? null,
      instagram: profile?.instagram ?? null,
      // O motivo e a data do descadastro **so aparecem aqui**, e e o oposto do
      // que Meu Perfil faz (spec 014, decisao 12). A diferenca e quem le: para o
      // membro, "seu provedor recusou nossos e-mails" nao o ajuda a fazer nada;
      // para o admin, e a unica informacao que explica o "nao chegou para o
      // fulano" — e ele e quem pode conferir o endereco e falar com a pessoa por
      // outro caminho.
      emailOptOutReason: profile?.emailOptOutReason ?? null,
      emailOptOutAt: profile?.emailOptOutAt?.toISOString() ?? null,
      waitlistEntryId: profile?.waitlistEntryId ?? null,
      profileCreatedAt: profile?.createdAt.toISOString() ?? null,
      profileUpdatedAt: profile?.updatedAt.toISOString() ?? null,
      canReceiveEmail: cannotReceiveReason === null,
      cannotReceiveReason,
    };
  }

  async updateUser(userId: string, dto: UpdateUserDto): Promise<void> {
    // O patch é montado campo a campo justamente para nunca escrever um ao
    // mexer no outro. `tier` é acesso e `grade` é conquista: são independentes,
    // e a spec 008 inteira depende de os dois não se contaminarem.
    const patch: { grade?: number; tier?: UpdateUserDto['tier'] } = {};
    if (dto.grade !== undefined) {
      patch.grade = dto.grade;
    }
    if (dto.tier !== undefined) {
      patch.tier = dto.tier;
    }

    if (Object.keys(patch).length === 0) {
      // PATCH sem campo nenhum não é erro: é um pedido que não pediu nada.
      return;
    }

    try {
      await this.profileRepository.update(userId, patch);
    } catch {
      // O repository levanta erro cru quando o documento não existe. Para o
      // admin isso é "esse usuário não tem perfil ainda", não uma falha de
      // servidor.
      throw new NotFoundException(
        'Esse usuário ainda não tem perfil — ele precisa concluir o onboarding antes.',
      );
    }
  }

  /**
   * `contains` sobre nome e e-mail, com os dois lados normalizados (decisão 5).
   *
   * **Prefixo não serve**, e é por isso que a comparação é `includes`: quem
   * procura um membro pelo sobrenome, ou pelo domínio do e-mail, digita o meio
   * da string. É a vantagem que a varredura em memória comprou.
   *
   * **Telefone não entra.** Não é a chave pela qual alguém procura uma pessoa, e
   * transformar o telefone de todo mundo em índice de busca é ampliar o uso de
   * um dado pessoal para ganhar um caso que não acontece.
   */
  private matchesSearch(membro: DirectoryMember, q?: string): boolean {
    const alvo = normalizeSearchText(q);
    if (alvo === '') {
      return true;
    }

    return (
      normalizeSearchText(membro.profile?.name).includes(alvo) ||
      normalizeSearchText(membro.user.email).includes(alvo)
    );
  }

  /**
   * Onboarding pendente junta dois estados de propósito (decisão 6).
   *
   * **Não existe documento de perfil** e **existe documento com `completedAt`
   * nulo** são fatos diferentes com a mesma consequência. Para o admin a
   * pergunta é uma só — "quem criou conta e não terminou" — e separá-los em dois
   * filtros seria expor detalhe de implementação numa tela de gestão. O detalhe
   * do membro mostra a diferença para quem precisar dela.
   */
  private matchesOnboarding(
    membro: DirectoryMember,
    onboarding?: 'pendente' | 'concluido',
  ): boolean {
    if (!onboarding) {
      return true;
    }

    const concluido = membro.profile?.completedAt != null;
    return onboarding === 'concluido' ? concluido : !concluido;
  }

  /** Lista ausente ou vazia significa **todos os tiers**, e nunca nenhum. */
  private matchesTier(membro: DirectoryMember, tiers?: string[]): boolean {
    if (!tiers || tiers.length === 0) {
      return true;
    }

    // Sem documento nao ha tier: quem nao terminou o onboarding nao tem como
    // satisfazer um filtro sobre um campo que nao existe. Sem filtro nenhum ele
    // continua na lista, que e o caso que a spec inteira protege.
    return membro.profile != null && tiers.includes(membro.profile.tier);
  }

  /** Faixa ausente significa **sem piso e sem teto**, e nunca ninguém. */
  private matchesGrade(
    membro: DirectoryMember,
    { gradeMin, gradeMax }: ListUsersQueryDto,
  ): boolean {
    if (gradeMin == null && gradeMax == null) {
      return true;
    }

    if (!membro.profile) {
      return false;
    }

    if (gradeMin != null && membro.profile.grade < gradeMin) {
      return false;
    }

    return !(gradeMax != null && membro.profile.grade > gradeMax);
  }

  private toDto(user: UserRecord, profile: Profile | null): AdminUserDto {
    return {
      id: user.uid,
      email: user.email ?? null,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      role: roleOf(user),
      createdAt: user.metadata.creationTime,
      lastSignInAt: user.metadata.lastSignInTime || null,
      // Nulos aqui são informação, não ausência de dado: é o retrato de quem
      // criou conta e parou antes do onboarding.
      name: profile?.name ?? null,
      grade: profile?.grade ?? null,
      // A spec 010 fez o PATCH aceitar `tier` e nao fez o GET devolve-lo: o
      // seletor do editor abre vazio desde entao. O conserto entra aqui porque e
      // aqui que o campo passa a ser filtravel, e filtrar por um campo que a
      // linha nao mostra e uma tela que mente.
      tier: profile?.tier ?? null,
      profileCompleted: profile?.completedAt != null,
      // Sem isto, "nao chegou o e-mail para o fulano" vira investigacao sem
      // pista: o admin nao teria como ver que a pessoa saiu da lista.
      emailOptOut: profile?.emailOptOut ?? false,
    };
    // **`phone` NAO sai daqui** (decisao 8). Ele vive so em
    // `GET /admin/users/:id`, e a regra e da API e nao do CSS: uma listagem que
    // carrega o telefone de 200 pessoas para desenhar 200 linhas trafega dado
    // pessoal que ninguem pediu e o guarda no estado do navegador.
  }
}

/** `creationTime` do Auth é string RFC 1123; a ordenação precisa do número. */
function criadoEm(user: UserRecord): number {
  return new Date(user.metadata.creationTime).getTime();
}
