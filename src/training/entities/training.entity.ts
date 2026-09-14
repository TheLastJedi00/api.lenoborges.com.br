import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadgeId } from '../../track/track.constants';
import { DEFAULT_TRAINING_XP } from '../training.constants';

/**
 * Um desafio prático da Arena de Treinamento, dentro de uma insígnia (spec 023).
 *
 * **A coleção é de primeiro nível, e não uma subcoleção de `badge_videos`.**
 * Treinamento e vídeo são vizinhos na tela e nada além disso: o vínculo é com a
 * insígnia, por `badgeId`, exatamente como o de `gym_questions`. Pendurá-lo
 * embaixo de um vídeo amarraria o desafio à vida daquele vídeo -- e o vídeo é a
 * peça que mais muda na trilha, republicado, trocado e removido, enquanto o
 * exercício sobrevive a todas essas trocas.
 *
 * **O ID é gerado pelo Firestore, e aqui isso é o certo.** Nas outras coleções
 * deste produto o caminho carrega uma garantia -- `waitlist_entries/{email}`,
 * `badge_videos/{badgeId}__{youtubeId}` -- porque havia uma unicidade a
 * defender. Aqui não há: dois treinamentos com o mesmo título na mesma insígnia
 * são um caso legítimo, e um ID composto por título obrigaria a renomear o
 * documento a cada edição do enunciado, que é o mesmo que apagar e recriar.
 *
 * O que **não** pode ser gerado é a posição: ver `position`.
 */
export interface Training {
  id: string;
  badgeId: BadgeId;
  title: string;
  description: string;
  /**
   * O resultado esperado do desafio (spec 025).
   *
   * Separado da `description` de propósito: a descrição conta o cenário, e o
   * objetivo diz onde se chega. Enquanto os dois moravam no mesmo texto, o
   * membro lia um parágrafo e adivinhava qual frase era o alvo.
   */
  objective: string;
  /**
   * As dicas de raciocínio, na ordem em que o pensamento caminha (spec 025).
   *
   * **Não é mais o passo a passo da execução**, que era o que `steps` guardava
   * na spec 023: é a dica que o membro abre quando trava, e **cada uma custa
   * 1 XP** do prêmio do desafio. Por isso a ordem importa mais do que antes --
   * abrir a quinta antes da primeira entrega o final da história.
   *
   * É um array de strings e não um texto único com quebras de linha, porque a
   * tela revela uma de cada vez e o admin edita dica a dica. Um blob de
   * markdown aqui empurraria a revelação para um `split` e a edição para um
   * textarea onde ninguém consegue mover a dica três para cima.
   */
  hints: string[];
  /**
   * O vídeo de apoio, opcional.
   *
   * **É a URL crua, e não o ID do YouTube extraído** -- ao contrário de
   * `badge_videos`, e a diferença é deliberada. Lá o vídeo *é* o conteúdo: a
   * plataforma monta o player, precisa do ID e conhece as seis formas de URL que
   * o `extractYoutubeId` normaliza. Aqui o vídeo é um anexo do enunciado, o
   * admin cola o que tiver na mão, e amarrar o campo ao YouTube fecharia a porta
   * para um vídeo hospedado em qualquer outro lugar por nenhum ganho.
   */
  videoUrl: string | null;
  /**
   * Quanto este desafio paga, uma vez só, na conclusão.
   *
   * Fica **no documento** e não na constante: nasce em `DEFAULT_TRAINING_XP`, e
   * o admin pode escrever outro valor. Ler a constante na hora de pagar faria a
   * edição do campo não mudar nada, silenciosamente.
   */
  xpAmount: number;
  /**
   * Posição dentro da insígnia. Inteiro de 0 a n-1.
   *
   * Renormalizada a cada reordenação e a cada exclusão, num `WriteBatch`
   * atômico -- mesma regra do `order` de `badge_videos` e pelo mesmo motivo: uma
   * atualização por documento deixa dois treinamentos em `position: 3` quando a
   * segunda escrita falha, e essa lista fica errada em silêncio.
   */
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** O que vai para o Firestore: sem `id`, que é o caminho, e com Timestamp. */
interface TrainingDocument extends DocumentData {
  badgeId: BadgeId;
  title: string;
  description: string;
  objective: string;
  hints: string[];
  /**
   * Resquício da spec 023, **só para o lado da leitura tipar o fallback**.
   *
   * Nada escreve neste campo desde a spec 025 -- o `toFirestore` grava apenas
   * `hints`. Ele continua declarado porque documento anterior à spec ainda o
   * tem, e o `fromFirestore` precisa poder lê-lo sem um `as any` no meio.
   */
  steps?: string[];
  videoUrl: string | null;
  xpAmount: number;
  position: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const trainingConverter: FirestoreDataConverter<Training> = {
  toFirestore(training: Training): TrainingDocument {
    return {
      badgeId: training.badgeId,
      title: training.title,
      description: training.description,
      objective: training.objective,
      // Grava **só `hints`**, nunca os dois (spec 025). O documento antigo fica
      // com o `steps` órfão até a primeira edição, que o reescreve inteiro, e
      // um `steps` sobrando não atrapalha ninguém: ele não entra em query
      // nenhuma, ao contrário do `tab` da spec 021, onde o fallback não bastava
      // justamente porque a query não enxerga campo ausente.
      hints: training.hints,
      videoUrl: training.videoUrl,
      xpAmount: training.xpAmount,
      position: training.position,
      createdAt: Timestamp.fromDate(training.createdAt),
      updatedAt: Timestamp.fromDate(training.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): Training {
    const data = snapshot.data() as TrainingDocument;

    return {
      id: snapshot.id,
      badgeId: data.badgeId,
      title: data.title,
      description: data.description ?? '',
      // Documento anterior à spec 025 não tem objetivo, e `undefined` num
      // template vira a palavra "undefined" na tela do membro.
      objective: data.objective ?? '',
      // A migração dos documentos antigos mora inteira nesta linha (spec 025):
      // `hints` não é campo de query -- a listagem filtra por `badgeId` e
      // ordena por `position` --, então o fallback resolve o legado por
      // completo e não há script de migração a rodar. O `?? []` final é o de
      // sempre: sem ele a tela estoura no `.map` e o desafio some inteiro.
      hints: data.hints ?? data.steps ?? [],
      videoUrl: data.videoUrl ?? null,
      // `undefined + xp` é `NaN`, e um `NaN` gravado no perfil contamina o
      // contador para sempre: ele não volta a ser número com nenhuma soma
      // seguinte. O fallback existe para o dia em que um treinamento for criado
      // por um script sem este campo.
      xpAmount: data.xpAmount ?? DEFAULT_TRAINING_XP,
      position: data.position,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
