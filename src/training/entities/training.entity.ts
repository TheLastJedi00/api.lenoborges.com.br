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
   * Os passos a executar no código, na ordem, um por item.
   *
   * É um array de strings e não um texto único com quebras de linha, porque a
   * tela desenha um `<ol>` semântico e o admin edita passo a passo. Um blob de
   * markdown aqui empurraria a numeração para o CSS e a edição para um textarea
   * onde ninguém consegue mover o passo três para cima.
   */
  steps: string[];
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
  steps: string[];
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
      steps: training.steps,
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
      // Sem o `?? []`, um documento escrito por um caminho que ninguém previu
      // chega com `steps` indefinido e a tela estoura no `.map` -- o desafio
      // some inteiro por causa de um campo que ninguém preencheu.
      steps: data.steps ?? [],
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
