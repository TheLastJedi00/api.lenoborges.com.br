import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LegalService } from './legal.service';
import { LegalDocumentDto } from './dto/legal-document.dto';
import { LegalDocumentSummaryDto } from './dto/legal-document-summary.dto';

/**
 * Os documentos legais, **em rota publica** (spec 018, decisao 4).
 *
 * Sem `FirebaseAuthGuard`, de proposito: o rodape da landing aponta para ca, e
 * quem le ali ainda nao tem conta. **Exigir login para ler o contrato e exigir
 * que a pessoa concorde antes de poder ler.** E a mesma razao pela qual
 * `/descadastro` e publica (spec 014, decisao 11) -- a pagina existe justamente
 * para quem esta de fora.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get('documents')
  @ApiOperation({
    summary: 'Listar os documentos legais vigentes',
    description:
      'Devolve apenas identidade e versão — sem o texto. Mandar o documento ' +
      'inteiro aqui seriam dezenas de KB em todo carregamento de rodapé.',
  })
  @ApiResponse({ status: 200, type: [LegalDocumentSummaryDto] })
  list(): LegalDocumentSummaryDto[] {
    return this.legalService.list();
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Obter o texto de um documento legal' })
  @ApiResponse({ status: 200, type: LegalDocumentDto })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  findOne(@Param('id') id: string): LegalDocumentDto {
    const { contentHash, ...document } = this.legalService.findById(id);
    // O `contentHash` e mecanismo interno de revisao (decisao 3) e nao vai para
    // a rede: ele nao diz nada a quem le o contrato e viraria um campo que
    // alguem tentaria conferir do lado de fora.
    void contentHash;

    return document;
  }
}
