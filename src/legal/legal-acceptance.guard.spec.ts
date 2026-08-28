import { ExecutionContext } from '@nestjs/common';
import { LegalAcceptanceGuard } from './legal-acceptance.guard';
import { LegalService } from './legal.service';
import { LegalAcceptanceRequiredException } from './legal-acceptance-required.exception';
import { LEGAL_DOCUMENTS } from './legal.documents';

/**
 * A versao vigente sai do proprio registro de documentos, e **nao de um literal**.
 *
 * Bumpar a versao ja custa um novo aceite da base inteira (spec 018, decisao 3);
 * nao pode custar tambem meia duzia de testes vermelhos que nao dizem nada sobre
 * comportamento. Quem guarda o texto contra edicao silenciosa e o teste-trava do
 * hash do texto, em legal.documents.spec.ts, e ele continua sendo o unico.
 */
const VIGENTE = LEGAL_DOCUMENTS['termos-de-uso'].version;

const EM_DIA = {
  'termos-de-uso': { version: VIGENTE, acceptedAt: new Date() },
  'politica-de-privacidade': { version: VIGENTE, acceptedAt: new Date() },
};

describe('LegalAcceptanceGuard', () => {
  let guard: LegalAcceptanceGuard;
  let profileRepository: { findById: jest.Mock };

  /** O servico real: o que se testa aqui e a decisao do guard, nao um dublê. */
  const legalService = new LegalService({} as never);

  function context(
    method: string,
    path: string,
    user: { id: string } | null = { id: 'uid-1' },
  ): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method, path, url: path, user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    profileRepository = { findById: jest.fn() };
    guard = new LegalAcceptanceGuard(legalService, profileRepository as never);
  });

  function perfilCom(legalAcceptances: Record<string, unknown>) {
    profileRepository.findById.mockResolvedValue({
      found: true,
      entry: { id: 'uid-1', legalAcceptances },
    });
  }

  it('perfil sem aceite nenhum e bloqueado', async () => {
    perfilCom({});

    await expect(guard.canActivate(context('GET', '/mural'))).rejects.toThrow(
      LegalAcceptanceRequiredException,
    );
  });

  /**
   * Publicar uma versao nova precisa bloquear quem so aceitou a antiga. Sem
   * isto, versionar nao serve para nada.
   */
  it('teste-trava: versao antiga de um documento bloqueia', async () => {
    perfilCom({
      ...EM_DIA,
      'termos-de-uso': { version: '2026-01-01', acceptedAt: new Date() },
    });

    await expect(guard.canActivate(context('GET', '/mural'))).rejects.toThrow(
      LegalAcceptanceRequiredException,
    );
  });

  it('perfil em dia passa', async () => {
    perfilCom(EM_DIA);

    await expect(guard.canActivate(context('GET', '/mural'))).resolves.toBe(
      true,
    );
  });

  /**
   * **As duas travas sem as quais o bloqueio nao tem saida.** `GET /me` e por
   * onde o front descobre o que falta, e `POST /me/legal-acceptances` e a unica
   * forma de sair -- bloquear qualquer uma das duas tranca todo mundo do lado de
   * fora, para sempre, e o unico conserto e deploy.
   */
  it('teste-trava: GET /me passa mesmo com pendencia', async () => {
    perfilCom({});

    await expect(guard.canActivate(context('GET', '/me'))).resolves.toBe(true);
  });

  it('teste-trava: POST /me/legal-acceptances passa mesmo com pendencia', async () => {
    perfilCom({});

    await expect(
      guard.canActivate(context('POST', '/me/legal-acceptances')),
    ).resolves.toBe(true);
  });

  it('entrar e sair nunca dependem de aceitar nada', async () => {
    perfilCom({});

    await expect(
      guard.canActivate(context('POST', '/auth/login')),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context('POST', '/auth/logout')),
    ).resolves.toBe(true);
  });

  it('descadastrar-se nao depende de concordar com nada', async () => {
    perfilCom({});

    await expect(
      guard.canActivate(context('PATCH', '/me/emails')),
    ).resolves.toBe(true);
  });

  /**
   * **A trava do onboarding, e a que alguem vai "consertar" achando que e
   * engano.** `PATCH /me/profile` e o endpoint que carimba `completedAt`:
   * barrado aqui, quem nao aceitou nao conclui o cadastro. Poe-lo na lista de
   * isencoes abre o onboarding sem aceite, e nada mais no produto avisa.
   */
  it('teste-trava: PATCH /me/profile e bloqueado — e o que trava o onboarding', async () => {
    perfilCom({});

    await expect(
      guard.canActivate(context('PATCH', '/me/profile')),
    ).rejects.toThrow(LegalAcceptanceRequiredException);
  });

  /**
   * Um admin isento seria a unica conta capaz de operar sem concordar com o
   * produto, e a isencao viraria a explicacao de por que ninguem testou o fluxo.
   */
  it('teste-trava: admin e bloqueado como qualquer um', async () => {
    profileRepository.findById.mockResolvedValue({
      found: true,
      entry: { id: 'uid-1', legalAcceptances: {} },
    });

    await expect(
      guard.canActivate(context('GET', '/admin/users')),
    ).rejects.toThrow(LegalAcceptanceRequiredException);
  });

  it('a query string nao esconde a rota da lista de isencoes', async () => {
    perfilCom({});

    await expect(guard.canActivate(context('GET', '/me?x=1'))).resolves.toBe(
      true,
    );
  });

  it('requisicao sem usuario passa: a rota e publica, ou o auth ja recusou', async () => {
    await expect(
      guard.canActivate(context('GET', '/legal/documents', null)),
    ).resolves.toBe(true);
    expect(profileRepository.findById).not.toHaveBeenCalled();
  });

  it('quem ainda nao tem perfil nao e bloqueado por aceite', async () => {
    // O 404 do proprio endpoint diz isso melhor do que um 428 diria.
    profileRepository.findById.mockResolvedValue({ found: false, entry: null });

    await expect(guard.canActivate(context('GET', '/mural'))).resolves.toBe(
      true,
    );
  });

  it('o corpo do 428 lista o que falta', async () => {
    perfilCom({
      'termos-de-uso': { version: VIGENTE, acceptedAt: new Date() },
    });

    await expect(
      guard.canActivate(context('GET', '/mural')),
    ).rejects.toMatchObject({
      response: {
        error: 'legal_acceptance_required',
        pending: [
          {
            id: 'politica-de-privacidade',
            title: 'Política de Privacidade',
            version: VIGENTE,
          },
        ],
      },
    });
  });
});
