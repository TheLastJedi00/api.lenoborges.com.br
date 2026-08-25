import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AudienceFilterDto } from './audience-filter.dto';

/**
 * O que o admin escreve (spec 014, decisão 11).
 *
 * **`body` é texto simples com quebras de linha, e nunca HTML.** O template —
 * cabeçalho, tipografia, rodapé com o descadastro — é do código, e é o mesmo nos
 * dois disparos. Aceitar HTML significaria aceitar que um erro de marcação
 * quebre a renderização em cinco clientes de e-mail diferentes, e sanitizar
 * entrada que vira documento enviado para fora. O `renderEmail` escapa o que
 * chega aqui, então marcação digitada sai como texto.
 */
export class CreateCampaignDto extends AudienceFilterDto {
  @ApiProperty({
    example: 'Vídeo novo na insígnia Lógica',
    minLength: 3,
    maxLength: 150,
    description: 'O assunto do e-mail',
  })
  @IsString({ message: 'O assunto deve ser um texto' })
  @IsNotEmpty({ message: 'O assunto é obrigatório' })
  @MinLength(3, { message: 'O assunto deve ter no mínimo 3 caracteres' })
  @MaxLength(150, { message: 'O assunto deve ter no máximo 150 caracteres' })
  subject: string;

  @ApiProperty({
    example: 'Saiu um vídeo novo.\n\nEle responde a pergunta mais votada.',
    minLength: 10,
    maxLength: 5000,
    description:
      'O corpo, em TEXTO SIMPLES. Linha em branco separa parágrafos. Marcação ' +
      'digitada aqui sai como texto: o template escapa tudo',
  })
  @IsString({ message: 'O corpo deve ser um texto' })
  @IsNotEmpty({ message: 'O corpo é obrigatório' })
  @MinLength(10, { message: 'O corpo deve ter no mínimo 10 caracteres' })
  @MaxLength(5000, { message: 'O corpo deve ter no máximo 5000 caracteres' })
  body: string;

  @ApiPropertyOptional({
    example: 'Ver na trilha',
    maxLength: 40,
    description: 'Rótulo do botão. Exige a URL junto',
  })
  @IsOptional()
  @IsString({ message: 'O rótulo do botão deve ser um texto' })
  @MaxLength(40, {
    message: 'O rótulo do botão deve ter no máximo 40 caracteres',
  })
  ctaLabel?: string;

  // Rótulo sem URL é um botão que não leva a lugar nenhum, e URL sem rótulo é um
  // link invisível. Os dois vêm juntos ou nenhum vem.
  @ApiPropertyOptional({
    example: 'https://edu.lenoborges.com.br/dashboard/trilha/logica',
    description: 'Destino do botão. Exige o rótulo junto',
  })
  @ValidateIf((dto: CreateCampaignDto) => dto.ctaLabel !== undefined)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    {
      message: 'O destino do botão deve ser uma URL https',
    },
  )
  ctaUrl?: string;
}
