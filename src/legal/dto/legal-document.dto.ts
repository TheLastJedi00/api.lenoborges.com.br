import { ApiProperty } from '@nestjs/swagger';

export class LegalSectionDto {
  @ApiProperty({
    example: '4. Assinatura, pagamento e ausência de reembolso',
    description: 'Título da seção. Texto puro, sem marcação',
  })
  heading: string;

  @ApiProperty({
    type: [String],
    example: ['Não há reembolso. Nem parcial, nem proporcional...'],
    description:
      'Parágrafos da seção, em texto puro. NUNCA HTML nem markdown: o front ' +
      'renderiza com interpolação, e uma string de marcação aqui o obrigaria a ' +
      'um bypassSecurityTrustHtml que não sai mais do código (spec 018, decisão 2)',
  })
  paragraphs: string[];
}

export class LegalDocumentDto {
  @ApiProperty({
    example: 'termos-de-uso',
    description:
      'Identificador estável. É também o prefixo do caminho do aceite no ' +
      'Firestore, então é kebab-case, sem acento e sem barra',
  })
  id: string;

  @ApiProperty({ example: 'Termos de Uso' })
  title: string;

  @ApiProperty({
    example: '2026-08-27',
    description:
      'Data da versão vigente. É o valor que o aceite precisa devolver no ' +
      'corpo do POST /me/legal-acceptances — versão diferente é 409',
  })
  version: string;

  @ApiProperty({ example: '2026-08-27' })
  updatedAt: string;

  @ApiProperty({ type: [LegalSectionDto] })
  sections: LegalSectionDto[];
}
