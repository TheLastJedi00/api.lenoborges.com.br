import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * **O grafo de modulos fecha, e a aplicacao sobe.**
 *
 * Este arquivo existe por causa de um boot quebrado na spec 019, e a licao vale
 * mais que o caso: o `TrackModule` passou a importar o `ProfileModule` para
 * reler um campo, fechando o ciclo de arquivos
 * `ProfileModule -> TrackModule -> EmailsModule -> ProfileModule`. O sintoma foi
 * `UndefinedModuleException` no `EmailsModule` -- um `import` circular de ES
 * entregando `undefined` no meio da carga --, e **a suite inteira, com 593
 * testes verdes, nao viu nada**: nenhum deles montava o `AppModule`.
 *
 * O e2e teria pego, e nao rodou porque falta Java no PATH desta maquina. Este
 * teste e a rede que nao depende disso: ele nao toca em Firestore, nao abre
 * porta e nao faz requisicao -- so pede ao Nest que resolva o grafo inteiro, que
 * e exatamente o que quebrou.
 *
 * `forwardRef` esquecido, provider nao exportado, modulo faltando na lista:
 * todos aparecem aqui, e todos custam o boot em producao.
 */
describe('AppModule', () => {
  it('teste-trava: o grafo de dependencias resolve por inteiro', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();

    await moduleRef.close();
  }, 30000);
});
