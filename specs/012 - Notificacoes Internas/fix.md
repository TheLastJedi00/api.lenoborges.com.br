# Fix: o deploy quebra no `nest build`, e a suíte verde não avisou

Aberto em 2026-08-25, no primeiro deploy da branch `dev` com a spec 012 (commit `91713bc`, build da
Vercel em `iad1`).

## Sintoma

O build da Vercel falha na compilação, antes de qualquer coisa subir:

```
src/notifications/dto/notification.dto.ts:26:9 - error TS1272: A type referenced in a decorated
signature must be imported with 'import type' or a namespace import when 'isolatedModules' and
'emitDecoratorMetadata' are enabled.

26   kind: NotificationKind;
             ~~~~~~~~~~~~~~~~

  src/notifications/dto/notification.dto.ts:2:10
    2 import { NotificationKind } from '../entities/notification.entity';
    'NotificationKind' was imported here.

Found 1 error(s).
Error: Command "npm run build" exited with 1
```

O `NotificationDto` importa `NotificationKind` com `import` comum e usa o tipo numa propriedade
decorada com `@ApiProperty`. Com `isolatedModules: true` e `emitDecoratorMetadata: true` — os dois
ligados no `tsconfig.json` desde sempre —, o TypeScript não tem como saber, compilando o arquivo
isolado, se aquele símbolo sobrevive ao apagamento de tipos. Ele precisa emitir metadata de decorator
referenciando o valor, e recusa em vez de gerar um `import` que quebraria em runtime.

## Por que a execução da spec não pegou isso

**A Fase 05, Task 04 pedia `npm test` verde e `npm run lint` limpo. Não pedia `npm run build`.** Foi
seguida à risca, e as duas passaram — 242 testes e lint sem apontamento.

O problema é que **nenhuma das duas roda o compilador do jeito que o deploy roda**:

| Comando | O que faz com os tipos | Pega TS1272? |
|---|---|---|
| `npm test` | `ts-jest`, transpila arquivo a arquivo | **Não** |
| `npm run lint` | ESLint type-aware, checa regras de lint | **Não** |
| `npm run build` | `nest build` → `tsc` com o `tsconfig.json` inteiro | **Sim** |

É a mesma forma de falha que este repositório já documentou duas vezes: **o ambiente onde tudo funciona
é o ambiente que não faz a pergunta.** O emulador que não exige índice, o `localhost` que o Firebase
autoriza de fábrica, e agora a suíte que não compila do jeito que o deploy compila.

Vale notar o que **não** é a causa: não é configuração da Vercel, não é cache de build, não é versão de
Node. O `npm run build` local reproduz o erro na primeira tentativa. Ele simplesmente nunca tinha sido
executado nesta spec.

## O conserto

Uma linha, em `src/notifications/dto/notification.dto.ts`:

```ts
import type { NotificationKind } from '../entities/notification.entity';
```

Com o comentário que registra o porquê no arquivo, incluindo que **o `npm test` não pega isso** — sem
essa frase, a próxima pessoa "simplifica" o `import type` de volta para `import` e o deploy quebra de
novo, com a suíte verde de novo.

O idioma já existe no repositório: os controllers importam `CurrentUserData` assim, pelo mesmo motivo.

### A alternativa que foi recusada

`badge-video.dto.ts` resolve o mesmo problema **inlineando a união**:

```ts
kind: 'aula' | 'resposta';
```

Funciona e é o precedente da casa, mas cria uma segunda definição da união, longe da primeira. Quando
um terceiro tipo de notificação existir, a entidade e o DTO passam a poder discordar em silêncio — o
Swagger anunciaria um conjunto de valores e o Firestore guardaria outro. `import type` mantém **um dono
só** para a união e custa uma palavra.

> Fica registrado que `badge-video.dto.ts` tem a duplicação e continua tendo. Consertá-la não é assunto
> deste fix, e trocá-la agora sem teste que a cubra seria mexer em código que funciona por estética.

## O que este fix muda no processo

**A task de verificação das próximas specs deste repositório pede `npm run build` junto com `npm test` e
`npm run lint`.** Os três, e não dois.

O `tasks.md` desta spec foi corrigido na Fase 05, Task 04. Não é zelo: é o único dos três comandos que
roda o compilador do jeito que o deploy roda, e esta spec provou que os outros dois passam verdes com o
build quebrado.

## Aplicação (2026-08-25)

- `import type` no `NotificationDto`, com o comentário do porquê.
- `npm run build` limpo, `npm test` com 242 testes verdes em 31 suítes, `npm run lint` sem apontamento.
- Fase 05, Task 04 do `tasks.md` reescrita para exigir os três comandos.

## O que não fazer

- **Desligar `isolatedModules` ou `emitDecoratorMetadata`.** O segundo é requisito da DI do Nest — sem
  ele o container para de resolver dependências por tipo, e o sintoma seria a aplicação inteira falhando
  no boot. O primeiro é o que mantém a compilação previsível arquivo a arquivo.
- **Adicionar um `npm run build` ao script de teste.** Faria toda rodada de teste pagar a compilação
  inteira, e a suíte unitária é rodada dezenas de vezes por hora durante a execução de uma spec. O lugar
  certo é a task de verificação da fase, uma vez por fase.
