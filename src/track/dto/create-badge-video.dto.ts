import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBadgeVideoDto {
  @ApiProperty({
    example: 'Herança e composição, na prática',
    description:
      'Título da PLATAFORMA, obrigatório. Não é o título do YouTube — aquele é ' +
      'escrito para o algoritmo; este diz onde a pessoa está na trilha',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 140)
  title: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'Por que herança não é reuso de código.',
    description: 'Uma linha opcional sob o título',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(0, 300)
  description?: string;

  @ApiProperty({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description:
      'URL do vídeo em qualquer forma (watch?v=, youtu.be, /embed/, com &t= ou ' +
      '?si=), ou o ID cru. A API grava só o ID — a extração é problema nosso',
  })
  @IsString()
  youtubeUrl: string;

  @ApiProperty({
    required: false,
    example: 'aula',
    enum: ['aula', 'resposta'],
    description: 'A aba da insígnia. Sem valor, entra como aula',
  })
  @IsOptional()
  @IsIn(['aula', 'resposta'])
  kind?: 'aula' | 'resposta';

  @ApiProperty({
    required: false,
    example: 'aula',
    enum: ['aula', 'resposta'],
    description:
      'A **lista** em que o vídeo vai viver, que não é a mesma coisa que `kind` ' +
      '— `kind` é a natureza do vídeo, `tab` é o endereço dele.\n\n' +
      '- **Sem valor, `tab = kind`**: quem não conhece esta spec continua ' +
      'publicando como sempre.\n' +
      '- `kind: resposta` com `tab: aula` é a **resposta posicionada na ' +
      'trilha** — ela mantém a pergunta, o balão e o `retrato`, e passa a ' +
      'aparecer na sequência das aulas.\n' +
      '- `kind: aula` com `tab: resposta` é **400**: a aba de respostas é a ' +
      'lista das perguntas respondidas, e uma aula ali é um vídeo sem balão ' +
      'numa lista de balões.',
  })
  @IsOptional()
  @IsIn(['aula', 'resposta'])
  tab?: 'aula' | 'resposta';

  @ApiProperty({
    required: false,
    example: '2026-08-09__9b1deb4d',
    description:
      'A pergunta do Mural que este vídeo responde. **Só é aceito com ' +
      '`kind: resposta`** — aula com pergunta e resposta sem pergunta são os ' +
      'dois estados incoerentes',
  })
  @IsOptional()
  @IsString()
  questionId?: string;

  @ApiProperty({
    required: false,
    example: false,
    description:
      'Libera o vídeo para todo mundo, mesmo numa insígnia adiantada. Nasce ' +
      'aqui, no cadastro, porque marcar durante é grátis e voltar depois em cem ' +
      'vídeos não é',
  })
  @IsOptional()
  @IsBoolean()
  devTierFree?: boolean;
}
