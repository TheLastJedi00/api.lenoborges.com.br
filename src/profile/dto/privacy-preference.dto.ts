import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * O interruptor das redes sociais (spec 019, decisao 9).
 *
 * DTO proprio e rota propria (`PATCH /me/privacy`), e **nao um campo a mais em
 * `PATCH /me/profile`**: aquele exige nome, telefone e bio, e e ele que carimba
 * `completedAt` -- um interruptor que exige reenviar o cadastro inteiro e um
 * interruptor que ninguem liga.
 */
export class PrivacyPreferenceDto {
  @ApiProperty({
    example: true,
    description:
      'Se `linkedin` e `instagram` aparecem no cartão que os outros membros ' +
      'abrem. **Nasce desligado** — quem preencheu os links antes desta spec o ' +
      'fez num formulário que só a administração lia, e publicá-los no dia do ' +
      'deploy divulgaria um vínculo que ninguém foi chamado a autorizar.\n\n' +
      '**Não esconde nada da administração** (`GET /admin/users/:uid` continua ' +
      'trazendo os dois), e o rótulo na tela diz isso: "visível para os outros ' +
      'membros", nunca "privado".',
  })
  @IsBoolean({ message: 'socialLinksPublic deve ser true ou false' })
  socialLinksPublic: boolean;
}
