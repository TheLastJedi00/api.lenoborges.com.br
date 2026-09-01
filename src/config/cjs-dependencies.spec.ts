import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * **O teste-trava do boot na Vercel, e ele existe porque nada mais pega isto.**
 *
 * O `nest build` emite CommonJS, e a function da Vercel carrega esse bundle com
 * um `require` proprio. Uma dependencia transitiva que so publique ESM derruba a
 * function **no boot**, com `ERR_REQUIRE_ESM`, antes de qualquer rota existir --
 * e o sintoma e a API inteira respondendo `500`, inclusive na raiz.
 *
 * Aconteceu em 2026-09-01, no bump do `firebase-admin` para a 14:
 *
 *   13.x -> jwks-rsa@3.2.2 -> jose@4.15.9   (tem build CJS)
 *   14.x -> jwks-rsa@4.1.0 -> jose@^6       (**so ESM**)
 *
 * E o `jwks-rsa@4.1.0` continua sendo CommonJS: a primeira linha do `utils.js`
 * dele e `require('jose')`. A combinacao so funciona onde o `require()` de ESM e
 * permitido -- Node 22.12+ fora de bundler --, e e por isso que **o build passou,
 * os 984 testes passaram e a maquina de desenvolvimento nao reclamou**: o Node
 * daqui aceita. O carregador da Vercel nao.
 *
 * Conferir "o pacote existe" nao serviria: ele existe nas duas versoes. O que
 * separa uma da outra e o `exports` do proprio pacote declarar a condicao
 * `require` -- e e isso que este teste le. O conserto e um `overrides` no
 * `package.json`, prendendo o `jose` na 5, que e dupla.
 *
 * **A resolucao parte do consumidor, e nao deste arquivo**, e isso ja custou um
 * verde falso na primeira versao deste teste: de `src/config` o Node subiu ate
 * `C:\Users\<usuario>\node_modules\jose` -- uma copia solta, de fora do
 * projeto, que passava enquanto a que o `jwks-rsa` carrega estava quebrada. A
 * pergunta certa nao e "existe um jose com CJS em algum lugar", e sim "o jose
 * que ESTE pacote vai carregar tem CJS".
 */
describe('dependencias que precisam ter build CommonJS', () => {
  /**
   * `[quem carrega, o que e carregado]`. Entrar aqui e barato; descobrir em
   * producao custou a API de preview fora do ar.
   */
  const PARES: [consumidor: string, pacote: string][] = [['jwks-rsa', 'jose']];

  it.each(PARES)(
    'o %s que o %s carrega expoe a condicao "require"',
    (consumidor, pacote) => {
      const daqui = createRequire(__filename);
      const doConsumidor = createRequire(
        daqui.resolve(`${consumidor}/package.json`),
      );

      const manifesto = doConsumidor.resolve(`${pacote}/package.json`);
      const { version, exports: mapa } = JSON.parse(
        readFileSync(manifesto, 'utf8'),
      ) as { version: string; exports?: Record<string, unknown> };

      const raiz = mapa?.['.'] as Record<string, unknown> | undefined;

      // A versao entra na asserticao porque quem chegar aqui vai chegar por um
      // `npm install` de outra coisa, e vai precisar saber o que subiu.
      expect({
        pacote,
        version,
        temRequire: typeof raiz?.require === 'string',
      }).toEqual({ pacote, version, temRequire: true });
    },
  );
});
