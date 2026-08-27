import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LegalService } from './legal.service';
import { LegalAcceptanceRepository } from './legal-acceptance.repository';

describe('LegalService', () => {
  let service: LegalService;
  let repository: { record: jest.Mock };

  beforeEach(async () => {
    repository = { record: jest.fn().mockResolvedValue({ created: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalService,
        { provide: LegalAcceptanceRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(LegalService);
  });

  describe('list e findById', () => {
    it('a listagem devolve identidade e versao, sem o texto', () => {
      // Mandar o documento inteiro na listagem seriam dezenas de KB em todo
      // carregamento de rodape, para uma tela que so precisa do titulo.
      const lista = service.list();

      expect(lista).toHaveLength(2);
      expect(lista[0]).toEqual({
        id: 'termos-de-uso',
        title: 'Termos de Uso',
        version: '2026-08-27',
      });
      expect(lista[0]).not.toHaveProperty('sections');
    });

    it('id desconhecido e 404', () => {
      expect(() => service.findById('contrato-inexistente')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('pendingFor', () => {
    it('perfil sem aceite nenhum deve os dois documentos', () => {
      expect(service.pendingFor({}).map((d) => d.id)).toEqual([
        'termos-de-uso',
        'politica-de-privacidade',
      ]);
    });

    /**
     * O caso do documento antigo, e o motivo de a assinatura aceitar
     * `undefined`: no dia em que a spec sobe, todo perfil esta assim.
     */
    it('teste-trava: mapa ausente e tratado como nenhum aceite, e nao estoura', () => {
      expect(service.pendingFor(undefined)).toHaveLength(2);
    });

    it('perfil em dia nao deve nada', () => {
      const pending = service.pendingFor({
        'termos-de-uso': { version: '2026-08-27', acceptedAt: new Date() },
        'politica-de-privacidade': {
          version: '2026-08-27',
          acceptedAt: new Date(),
        },
      });

      expect(pending).toEqual([]);
    });

    /**
     * **A comparacao e por versao exata, e nao "aceitou alguma vez".** Aceitar a
     * versao de marco nao vale para a de agosto -- que e o proposito inteiro de
     * versionar. Um `documentId in accepted` no lugar desta comparacao faria a
     * publicacao de uma versao nova nao pedir aceite de ninguem, em silencio.
     */
    it('teste-trava: versao antiga de um documento ainda e pendencia', () => {
      const pending = service.pendingFor({
        'termos-de-uso': { version: '2026-01-01', acceptedAt: new Date() },
        'politica-de-privacidade': {
          version: '2026-08-27',
          acceptedAt: new Date(),
        },
      });

      expect(pending.map((d) => d.id)).toEqual(['termos-de-uso']);
    });
  });

  describe('accept', () => {
    it('grava o aceite da versao vigente', async () => {
      await service.accept('uid-1', {
        documentId: 'termos-de-uso',
        version: '2026-08-27',
      });

      expect(repository.record).toHaveBeenCalledWith(
        'uid-1',
        'termos-de-uso',
        '2026-08-27',
        expect.any(Date),
      );
    });

    /**
     * Aba aberta desde antes do deploy: o aceite dela e de um texto que nao e
     * mais o texto. **Nada e gravado** -- gravar com o numero errado registraria
     * concordancia com uma clausula que ninguem mais ve.
     */
    it('teste-trava: versao velha e 409 e NAO grava nada', async () => {
      await expect(
        service.accept('uid-1', {
          documentId: 'termos-de-uso',
          version: '2026-01-01',
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.record).not.toHaveBeenCalled();
    });

    it('o 409 diz qual e a versao vigente, para o front recarregar', async () => {
      await expect(
        service.accept('uid-1', {
          documentId: 'termos-de-uso',
          version: '2026-01-01',
        }),
      ).rejects.toMatchObject({
        response: { error: 'stale_version', current: '2026-08-27' },
      });
    });

    it('teste-trava: id desconhecido e 404 ANTES de qualquer escrita', async () => {
      await expect(
        service.accept('uid-1', {
          documentId: 'contrato-inexistente',
          version: '2026-08-27',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repository.record).not.toHaveBeenCalled();
    });

    it('aceite repetido e sucesso: o repositorio decide, e ninguem estoura', async () => {
      repository.record.mockResolvedValue({ created: false });

      await expect(
        service.accept('uid-1', {
          documentId: 'termos-de-uso',
          version: '2026-08-27',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
