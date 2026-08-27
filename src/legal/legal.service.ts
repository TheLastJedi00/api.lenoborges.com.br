import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LegalDocument,
  LegalDocumentSummary,
  toSummary,
} from './entities/legal-document.entity';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_LIST } from './legal.documents';
import { LegalAcceptanceRepository } from './legal-acceptance.repository';
import { AcceptLegalDto } from './dto/accept-legal.dto';
import type { LegalAcceptance } from '../profile/entities/profile.entity';

@Injectable()
export class LegalService {
  constructor(private readonly repository: LegalAcceptanceRepository) {}

  list(): LegalDocumentSummary[] {
    return LEGAL_DOCUMENT_LIST.map(toSummary);
  }

  findById(id: string): LegalDocument {
    const document = LEGAL_DOCUMENTS[id];

    if (!document) {
      throw new NotFoundException('Documento não encontrado.');
    }

    return document;
  }

  /**
   * O que ainda falta esta pessoa aceitar (spec 018, decisao 8).
   *
   * **E o unico lugar do projeto que sabe o que "estar em dia" significa**, e
   * tem tres chamadores: o `LegalAcceptanceGuard`, o `GET /me` e o proprio
   * aceite. Duas implementacoes disto divergem no dia em que um documento for
   * descontinuado -- e a divergencia seria silenciosa dos dois lados: o guard
   * bloqueando quem o `GET /me` diz estar em dia, ou o contrario.
   *
   * A comparacao e por **versao exata**, e nao "aceitou alguma vez": aceitar a
   * versao de marco nao vale para a de agosto, que e o proposito inteiro de
   * versionar.
   */
  pendingFor(
    acceptances: Record<string, LegalAcceptance> | undefined,
  ): LegalDocumentSummary[] {
    const accepted = acceptances ?? {};

    return LEGAL_DOCUMENT_LIST.filter(
      (document) => accepted[document.id]?.version !== document.version,
    ).map(toSummary);
  }

  /**
   * Registra o aceite de **um** documento.
   *
   * Idempotente: aceitar de novo a mesma versao responde 204 e **nao reescreve a
   * data**. Versao diferente da vigente e `409` com a atual no corpo -- e nao um
   * aceite gravado com o numero errado, que e o que faria a aba aberta desde
   * antes do deploy registrar concordancia com um texto que ninguem mais ve.
   */
  async accept(uid: string, dto: AcceptLegalDto): Promise<void> {
    // `findById` primeiro: id desconhecido e 404 antes de qualquer escrita.
    const document = this.findById(dto.documentId);

    if (dto.version !== document.version) {
      throw new ConflictException({
        statusCode: 409,
        error: 'stale_version',
        message: 'Este documento foi atualizado. Leia a versão vigente.',
        current: document.version,
      });
    }

    await this.repository.record(
      uid,
      document.id,
      document.version,
      new Date(),
    );
  }
}
