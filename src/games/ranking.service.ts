import { BadRequestException, Injectable } from '@nestjs/common';
import { RankingRepository } from './ranking.repository';
import type { RankingCursor } from './ranking.repository';
import type { RankingEntry } from './entities/ranking-entry.entity';
import type { RankingEntryDto, RankingPageDto } from './dto/ranking.dto';

/** O teto de uma pagina. Acima disso a tela nao esta paginando, esta baixando. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

@Injectable()
export class RankingService {
  constructor(private readonly repository: RankingRepository) {}

  /**
   * Uma pagina do placar, mais a posicao de quem esta olhando.
   *
   * **A posicao do membro logado aparece mesmo que ele esteja na pagina 3**, e e
   * a linha fixa do topo da tela. Ela e calculada contando quantos estao acima
   * dele -- e nao lida do `currentPosition`, que e cache do snapshot diario e
   * estaria errado desde o ultimo XP ganho por qualquer pessoa.
   */
  async page({
    uid,
    limit,
    after,
  }: {
    uid: string;
    limit?: number;
    after?: string;
  }): Promise<RankingPageDto> {
    const size = this.normalizeLimit(limit);
    const cursor = this.decodeCursor(after);

    const [{ entries }, mine] = await Promise.all([
      this.repository.page({ limit: size + 1, after: cursor }),
      this.repository.findByUid(uid),
    ]);

    // Pede um a mais para saber se ha proxima pagina sem uma segunda consulta.
    // Um `nextCursor` sempre presente faria a tela mostrar "Carregar mais" no
    // fim da lista, e o clique traria vazio.
    const hasMore = entries.length > size;
    const page = hasMore ? entries.slice(0, size) : entries;

    const offset = await this.offsetOf(cursor);
    const myPosition = mine.found ? await this.positionOf(mine.entry!) : null;

    return {
      entries: page.map((entry, index) =>
        this.toDto(entry, offset + index + 1),
      ),
      myPosition,
      myEntry:
        mine.found && myPosition !== null
          ? this.toDto(mine.entry!, myPosition)
          : null,
      nextCursor: hasMore
        ? this.encodeCursor({
            xp: page[page.length - 1].xp,
            uid: page[page.length - 1].uid,
          })
        : null,
    };
  }

  /**
   * A posicao de uma linha: quantos estao acima dela, mais um.
   *
   * Le a colecao inteira, e isso e o custo aceito enquanto a base cabe numa
   * leitura. **A alternativa e pior do que parece**: usar o `currentPosition`
   * gravado faria a linha do topo dizer "#47" enquanto a lista abaixo mostra a
   * pessoa em 43, porque o cache e de ontem e a lista e de agora. Duas verdades
   * na mesma tela e o defeito que ninguem reporta e todo mundo nota.
   */
  private async positionOf(mine: RankingEntry): Promise<number> {
    const { entries } = await this.repository.listAll();

    return (
      entries.findIndex((entry) => entry.uid === mine.uid) + 1 || entries.length
    );
  }

  /** Quantas linhas o cursor ja deixou para tras, para numerar a pagina. */
  private async offsetOf(cursor?: RankingCursor): Promise<number> {
    if (!cursor) {
      return 0;
    }

    const { entries } = await this.repository.listAll();
    const index = entries.findIndex((entry) => entry.uid === cursor.uid);

    return index === -1 ? 0 : index + 1;
  }

  private toDto(entry: RankingEntry, position: number): RankingEntryDto {
    return {
      position,
      uid: entry.uid,
      nickname: entry.nickname,
      xp: entry.xp,
      badgeCount: entry.badgeCount,
      // **`null` quando nao ha posicao anterior**, e nao zero: zero diz "nao
      // mudou", e "ainda nao sei" e outra afirmacao. A tela nao desenha selo
      // nenhum no primeiro dia do membro no placar.
      positionChange:
        entry.previousPosition !== null && entry.currentPosition !== null
          ? entry.previousPosition - entry.currentPosition
          : null,
    };
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined || Number.isNaN(limit)) {
      return DEFAULT_LIMIT;
    }

    return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  }

  /**
   * O cursor e opaco de proposito.
   *
   * A tela devolve o que recebeu e nao monta um. Expor `?afterXp=&afterUid=`
   * publicaria a forma da ordenacao na URL, e o dia em que o desempate mudasse
   * quebraria o "Carregar mais" de toda aba aberta.
   */
  private encodeCursor(cursor: RankingCursor): string {
    return Buffer.from(`${cursor.xp}:${cursor.uid}`, 'utf8').toString(
      'base64url',
    );
  }

  private decodeCursor(after?: string): RankingCursor | undefined {
    if (!after) {
      return undefined;
    }

    const raw = Buffer.from(after, 'base64url').toString('utf8');
    const separator = raw.indexOf(':');
    const xp = Number(raw.slice(0, separator));

    // Cursor quebrado e um 400, e nao "comeca do zero em silencio": voltar ao
    // topo no meio da rolagem parece a lista se duplicando na tela.
    if (separator === -1 || Number.isNaN(xp) || raw.length === separator + 1) {
      throw new BadRequestException('Cursor de paginação inválido.');
    }

    return { xp, uid: raw.slice(separator + 1) };
  }
}
