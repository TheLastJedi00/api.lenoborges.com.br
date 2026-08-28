import { Test, TestingModule } from '@nestjs/testing';
import { MembersController } from './members.controller';
import { ProfileService } from './profile.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';

describe('MembersController', () => {
  let controller: MembersController;
  let service: { findPublicMember: jest.Mock };

  beforeEach(async () => {
    service = {
      findPublicMember: jest.fn().mockResolvedValue({
        id: 'uid-2',
        name: 'Ana Prado',
        bio: 'Migrando de suporte para dev.',
        grade: 3,
        xp: 340,
        linkedin: null,
        instagram: null,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembersController],
      providers: [{ provide: ProfileService, useValue: service }],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MembersController>(MembersController);
  });

  it('devolve o cartao do membro pedido', async () => {
    const cartao = await controller.findMember('uid-2');

    expect(service.findPublicMember).toHaveBeenCalledWith('uid-2');
    expect(cartao.name).toBe('Ana Prado');
  });

  /**
   * **Ler o cartao e ler o perfil de outra pessoa.** A landing nao precisa
   * disto, e uma rota publica com `uid` na URL seria uma base de nomes e bios
   * enumeravel por quem tivesse a lista de uids.
   */
  it('teste-trava: a rota exige sessao', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      MembersController,
    ) as unknown[];

    expect(guards).toContain(FirebaseAuthGuard);
  });

  /**
   * O controller nao filtra, nao esconde e nao decide nada: quem corta as redes
   * pelo interruptor e o service (decisao 9), porque o corte precisa acontecer
   * antes de o dado sair do servidor.
   */
  it('nao acrescenta nem remove campo nenhum da resposta do service', async () => {
    const cartao = await controller.findMember('uid-2');

    expect(Object.keys(cartao).sort()).toEqual([
      'bio',
      'grade',
      'id',
      'instagram',
      'linkedin',
      'name',
      'xp',
    ]);
  });
});
