import { Injectable, NotFoundException } from '@nestjs/common';
import { BadgeId } from '../track/track.constants';
import { isChallengeBadgeId } from './games.constants';
import { ChallengeConfigRepository } from './challenge-config.repository';
import { GymQuestionService } from './gym-question.service';
import { ChallengeConfigDto } from './dto/challenge-config.dto';

/**
 * A configuracao do desafio de cada insignia (spec 022, decisoes 5 e 11).
 *
 * Service proprio, e nao um metodo no `GymQuestionService`: o que ele guarda e o
 * XP minimo, que e regra do **desafio**, e nao do banco de questoes. Os dois
 * aparecem na mesma tela e sao duas perguntas diferentes -- e e por isso que a
 * resposta traz os dois juntos, para a tela nao precisar de duas requisicoes
 * para pintar um cabecalho.
 */
@Injectable()
export class ChallengeConfigService {
  constructor(
    private readonly repository: ChallengeConfigRepository,
    private readonly questions: GymQuestionService,
  ) {}

  private assertBadge(badgeId: string): BadgeId {
    if (!isChallengeBadgeId(badgeId)) {
      throw new NotFoundException('Insígnia não encontrada.');
    }

    return badgeId;
  }

  async get(badgeId: string): Promise<ChallengeConfigDto> {
    const badge = this.assertBadge(badgeId);

    // As duas leituras sao independentes e vao juntas: a contagem nao depende da
    // configuracao, e serializa-las custaria uma viagem a mais em toda abertura
    // da tela.
    const [{ found, entry }, counts] = await Promise.all([
      this.repository.get(badge),
      this.questions.counts(badge),
    ]);

    return {
      badgeId: badge,
      requiredXp: entry.requiredXp,
      configured: found,
      counts,
    };
  }

  async set(badgeId: string, requiredXp: number): Promise<ChallengeConfigDto> {
    const badge = this.assertBadge(badgeId);
    await this.repository.save(badge, requiredXp);

    // Relê pelo mesmo caminho do GET em vez de montar a resposta a mao: uma
    // segunda montagem divergiria da primeira no dia em que o DTO ganhasse um
    // campo, e o PUT passaria a responder diferente do GET da mesma coisa.
    return this.get(badge);
  }
}
