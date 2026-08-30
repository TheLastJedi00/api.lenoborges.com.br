import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DIFFICULTIES } from '../games.constants';
import type { Difficulty } from '../games.constants';
import { trim, trimEach } from './trim';

/**
 * Edita uma questao ja cadastrada.
 *
 * **O `badgeId` nao esta aqui de proposito**, pela mesma razao do `youtubeId` no
 * `UpdateBadgeVideoDto`: mudar a insignia de uma questao nao e editar esta
 * questao, e criar outra. A rota carrega o `badgeId` no caminho e o usa para
 * conferir que a questao pertence mesmo aquela insignia.
 *
 * **Editar uma questao ja respondida vale para as proximas rodadas**, e as
 * respostas passadas ficam como estao (fora de escopo, na spec). O `active_round`
 * de quem esta jogando agora ja tem a foto do enunciado, entao ninguem ve o texto
 * mudar debaixo do dedo.
 *
 * Os quatro campos sao opcionais, mas `alternatives` e `correctIndex` andam
 * juntos na pratica: mexer numa lista sem mexer no indice e como o service
 * descobre que a certa mudou de lugar. A validacao cruzada mora la, e nao aqui,
 * porque ela precisa do valor **atual** do que nao foi enviado.
 */
export class UpdateQuestionDto {
  @ApiProperty({ required: false, enum: DIFFICULTIES, example: 'medium' })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: Difficulty;

  @ApiProperty({ required: false, example: 'O que um laço `for` controla?' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(10, 1000)
  question?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  @Transform(trimEach)
  alternatives?: string[];

  @ApiProperty({ required: false, minimum: 0, maximum: 3, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  correctIndex?: number;
}
