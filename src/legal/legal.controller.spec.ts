import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { LegalAcceptanceRepository } from './legal-acceptance.repository';

describe('LegalController', () => {
  let controller: LegalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LegalController],
      providers: [
        LegalService,
        { provide: LegalAcceptanceRepository, useValue: { record: jest.fn() } },
      ],
    }).compile();

    controller = module.get(LegalController);
  });

  /**
   * Mandar o documento inteiro na listagem sao dezenas de KB em todo
   * carregamento de rodape da landing, para uma tela que so precisa do titulo.
   */
  it('teste-trava: a listagem nao carrega o texto', () => {
    for (const item of controller.list()) {
      expect(item).not.toHaveProperty('sections');
      expect(Object.keys(item).sort()).toEqual(['id', 'title', 'version']);
    }
  });

  it('o documento vem em secoes de texto puro', () => {
    const documento = controller.findOne('termos-de-uso');

    expect(documento.title).toBe('Termos de Uso');
    expect(documento.sections.length).toBeGreaterThan(0);
    for (const section of documento.sections) {
      for (const paragraph of section.paragraphs) {
        // Sem tag nenhuma: e o que permite o front renderizar por interpolacao
        // e nunca precisar de um bypassSecurityTrustHtml (decisao 2).
        expect(paragraph).not.toMatch(/<[a-z/]/i);
      }
    }
  });

  /**
   * O `contentHash` e mecanismo interno de revisao. Ele nao diz nada a quem le o
   * contrato, e exposto viraria um campo que alguem tentaria conferir de fora.
   */
  it('o contentHash nao vai para a rede', () => {
    expect(controller.findOne('termos-de-uso')).not.toHaveProperty(
      'contentHash',
    );
  });

  it('id desconhecido e 404', () => {
    expect(() => controller.findOne('contrato-inexistente')).toThrow(
      NotFoundException,
    );
  });
});
