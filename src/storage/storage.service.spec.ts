import { FirebaseService } from '../auth/firebase.service';
import { StorageService } from './storage.service';

const BUCKET = 'dev-liga-dev.firebasestorage.app';

/**
 * Duble do bucket, no molde do `fake-firestore`: o emulador de Storage nao esta
 * no `firebase.json` e esta spec nao o adiciona, entao quem cobre o caminho e
 * este objeto. Ele guarda o que foi escrito para os testes poderem afirmar
 * **conteudo e tipo**, e nao apenas que um jest.fn foi chamado.
 */
function fakeBucket() {
  const saved = new Map<string, { buffer: Buffer; contentType: string }>();
  const publicados = new Set<string>();
  const apagados: string[] = [];
  let erroAoApagar: Error | null = null;

  const file = (path: string) => ({
    save: jest.fn(
      async (buffer: Buffer, opts: { contentType: string }): Promise<void> => {
        saved.set(path, { buffer, contentType: opts.contentType });
      },
    ),
    makePublic: jest.fn(async (): Promise<void> => {
      publicados.add(path);
    }),
    delete: jest.fn(async (): Promise<void> => {
      if (erroAoApagar) {
        throw erroAoApagar;
      }
      apagados.push(path);
    }),
  });

  return {
    saved,
    publicados,
    apagados,
    falharAoApagarCom: (e: Error) => {
      erroAoApagar = e;
    },
    bucket: { name: BUCKET, file: jest.fn(file) },
  };
}

function build(fake: ReturnType<typeof fakeBucket>) {
  const firebase = {
    storageBucket: BUCKET,
    storage: { bucket: () => fake.bucket },
  } as unknown as FirebaseService;

  return new StorageService(firebase);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('StorageService', () => {
  describe('upload', () => {
    it('grava o arquivo com o tipo e o torna publico', async () => {
      const fake = fakeBucket();
      const service = build(fake);

      await service.upload('avatars/uid-1', PNG, 'image/png');

      expect(fake.saved.get('avatars/uid-1')).toEqual({
        buffer: PNG,
        contentType: 'image/png',
      });
      expect(fake.publicados.has('avatars/uid-1')).toBe(true);
    });

    it('devolve a URL publica com o ?v= que derruba o cache', async () => {
      // **O ?v= e o que faz a foto nova aparecer.** O caminho e fixo para a troca
      // sobrescrever a velha, entao a URL nao muda entre trocas e o navegador
      // serviria a antiga -- a pessoa troca a foto, recarrega, e ve a de antes.
      const fake = fakeBucket();
      const service = build(fake);

      const url = await service.upload('avatars/uid-1', PNG, 'image/png');

      expect(url).toMatch(
        new RegExp(
          `^https://storage\\.googleapis\\.com/${BUCKET.replace('.', '\\.')}/avatars/uid-1\\?v=\\d+$`,
        ),
      );
    });

    it('nao devolve a URL quando a escrita falha', async () => {
      const fake = fakeBucket();
      fake.bucket.file = jest.fn(() => ({
        save: jest.fn(async () => {
          throw new Error('bucket fora do ar');
        }),
        makePublic: jest.fn(),
        delete: jest.fn(),
      })) as unknown as typeof fake.bucket.file;
      const service = build(fake);

      await expect(
        service.upload('avatars/uid-1', PNG, 'image/png'),
      ).rejects.toThrow('bucket fora do ar');
    });
  });

  describe('remove', () => {
    it('apaga o objeto', async () => {
      const fake = fakeBucket();
      const service = build(fake);

      await service.remove('avatars/uid-1');

      expect(fake.apagados).toEqual(['avatars/uid-1']);
    });

    it('engole o "nao existe", porque remover o que nao esta la e o resultado desejado', async () => {
      // Sem isto, "remover a foto" de quem nunca teve uma responderia 500 -- e o
      // estado final pedido (nao ha foto) e exatamente o que ja era verdade.
      const fake = fakeBucket();
      fake.falharAoApagarCom(
        Object.assign(new Error('No such object'), { code: 404 }),
      );
      const service = build(fake);

      await expect(service.remove('avatars/uid-1')).resolves.toBeUndefined();
    });

    it('nao engole o resto', async () => {
      // Um 403 de credencial errada nao e "ja nao estava la": engolir tudo faria
      // uma configuracao quebrada parecer uma remocao bem-sucedida, para sempre.
      const fake = fakeBucket();
      fake.falharAoApagarCom(
        Object.assign(new Error('Forbidden'), { code: 403 }),
      );
      const service = build(fake);

      await expect(service.remove('avatars/uid-1')).rejects.toThrow('Forbidden');
    });
  });

  describe('isOwnUrl', () => {
    const service = build(fakeBucket());
    const nossa = `https://storage.googleapis.com/${BUCKET}/trainings/uid-1/trn-1?v=1`;

    it('aceita a URL que esta API cunhou para aquele caminho', () => {
      expect(service.isOwnUrl(nossa, 'trainings/uid-1/trn-1')).toBe(true);
    });

    it('aceita sem o ?v=', () => {
      expect(
        service.isOwnUrl(
          `https://storage.googleapis.com/${BUCKET}/trainings/uid-1/trn-1`,
          'trainings/uid-1/trn-1',
        ),
      ).toBe(true);
    });

    it('recusa o caminho de outro membro', () => {
      // **E este o teste que fecha a brecha do complete** (decisao 2): a rota de
      // upload barra o tier, mas ela e o complete sao duas chamadas, e sem esta
      // conferencia o membro manda a URL do resultado de outra pessoa.
      expect(service.isOwnUrl(nossa, 'trainings/uid-2/trn-1')).toBe(false);
    });

    it('recusa host de terceiro', () => {
      expect(
        service.isOwnUrl(
          'https://evil.com/trainings/uid-1/trn-1',
          'trainings/uid-1/trn-1',
        ),
      ).toBe(false);
    });

    it('recusa o host de terceiro que carrega o nosso no caminho', () => {
      // O `includes` ingenuo aceitaria: e a mesma armadilha que o isUrlOf de
      // social-url.ts existe para evitar, com o mesmo formato de ataque.
      expect(
        service.isOwnUrl(
          `https://evil.com/?u=storage.googleapis.com/${BUCKET}/trainings/uid-1/trn-1`,
          'trainings/uid-1/trn-1',
        ),
      ).toBe(false);
    });

    it('recusa o bucket de outro projeto', () => {
      expect(
        service.isOwnUrl(
          'https://storage.googleapis.com/outro-projeto.firebasestorage.app/trainings/uid-1/trn-1',
          'trainings/uid-1/trn-1',
        ),
      ).toBe(false);
    });

    it('recusa http e o que nao e URL', () => {
      expect(
        service.isOwnUrl(
          `http://storage.googleapis.com/${BUCKET}/trainings/uid-1/trn-1`,
          'trainings/uid-1/trn-1',
        ),
      ).toBe(false);
      expect(service.isOwnUrl('nao sou url', 'trainings/uid-1/trn-1')).toBe(
        false,
      );
      expect(service.isOwnUrl('', 'trainings/uid-1/trn-1')).toBe(false);
    });

    it('recusa o caminho que apenas comeca igual', () => {
      // `trainings/uid-1/trn-10` nao e `trainings/uid-1/trn-1`, e uma comparacao
      // por prefixo diria que sim.
      expect(
        service.isOwnUrl(
          `https://storage.googleapis.com/${BUCKET}/trainings/uid-1/trn-10`,
          'trainings/uid-1/trn-1',
        ),
      ).toBe(false);
    });
  });
});
