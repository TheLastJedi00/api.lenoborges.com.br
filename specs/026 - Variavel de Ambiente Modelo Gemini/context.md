# Spec 026: Variável de Ambiente para Modelo Gemini

## Objetivo
O objetivo desta spec é remover o modelo hardcoded do Gemini (`gemini-2.0-flash` ou similar) nos serviços de integração (como `src/games/gemini.service.ts` e `src/training/gemini.service.ts`, implementados nas specs **022** e **025** respectivamente) e passá-lo a ser lido de uma variável de ambiente, tipicamente nomeada `GEMINI_MODEL`.
Isso vai permitir testar facilmente novos modelos ou fazer trocas sem precisar de um novo deploy alterando código fonte.

O par desta spec no front é a **026**, porém ela é vazia no front-end por ser uma alteração estritamente de backend.

---

## Decisões

### 1. Criação da Variável de Ambiente
A aplicação backend passará a consumir a variável de ambiente `GEMINI_MODEL`.
- No arquivo `.env.example`, a variável entra **comentada e com o valor de hoje** (`# GEMINI_MODEL="gemini-2.0-flash"`), ao lado da `GEMINI_API_KEY`, com a linha dizendo que ausente significa o padrão.
- No `src/config/env.validation.ts`, ela entra como `@IsString() @IsOptional() GEMINI_MODEL?: string`, no molde da `GEMINI_API_KEY` logo acima — **e não ganha a exigência de produção que a chave tem**. São coisas diferentes: sem a chave a geração responde `503` e o admin só descobre depois de escrever o prompt, por isso o boot falha; sem o modelo existe um padrão embutido que funciona, e derrubar o boot de toda máquina por uma variável que tem default seria trocar um problema que não existe por um que existe.
- **Não há validação de valor.** O nome do modelo é catálogo do Google, muda sem avisar, e uma lista fechada aqui bloquearia exatamente o que esta spec quer permitir: testar o modelo novo sem deploy. Um nome errado aparece como `404` da API do Gemini, e os dois serviços já traduzem qualquer resposta não-ok em `503` com a mensagem genérica, registrando o corpo do Google no log — que é onde o nome errado vai aparecer para quem for procurar. 

### 2. Refatoração nos Serviços do Gemini
Hoje a URL é uma constante de módulo, e ela existe duas vezes — `src/games/gemini.service.ts` (spec 022) e `src/training/gemini.service.ts` (spec 025):

```ts
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
```

A constante **não pode mais ser de módulo**, porque o modelo só é conhecido com o `ConfigService` na mão. Ela vira um padrão mais uma função, resolvida dentro do método que faz o `fetch`:

```ts
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// no generate(), junto da leitura da chave, e passado ao `ask` como ela:
const model = this.config.get<string>('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
```

O `ask` privado, que é quem chama o `fetch`, passa a receber o modelo do mesmo jeito que já recebe a chave — **lê-lo de novo lá dentro seria uma segunda leitura da mesma configuração na mesma chamada**, e é assim que as duas metades de um serviço acabam falando com modelos diferentes no dia em que alguém trocar só uma.

**É `?? DEFAULT_GEMINI_MODEL` e não `config.get('GEMINI_MODEL', 'gemini-2.0-flash')`, e essa é a decisão que custa caro errar.** Os dois `gemini.service.spec.ts` não usam o `ConfigService` de verdade: eles injetam um dublê cujo `get` é um `jest.fn((key) => key === 'GEMINI_API_KEY' ? ... : undefined)`, que **ignora o segundo argumento**. Com a forma de dois parâmetros, o modelo viria `undefined` nos testes, a URL viraria `.../models/undefined:generateContent` — e **as duas suítes passariam verdes**, porque nenhuma delas afirma o modelo na URL; a única asserção sobre a URL hoje é que ela **não** carrega a chave. O `??` funciona igual no dublê e no `ConfigService` real.

**A duplicação das três linhas nos dois serviços é deliberada**, e é a mesma escolha que a spec 025 já fez com o `DIFFICULTY_LABEL` e com o `MAX_HINTS`: são dois serviços com o mesmo nome de classe em módulos diferentes, que falam de formatos de rascunho diferentes, e um módulo compartilhado só para o endereço do Gemini acoplaria os dois pela parte que menos muda.

Como se trata apenas de uma refatoração interna, nenhum comportamento do sistema será alterado, desde que a API do Gemini mantenha o padrão de contratos entre os modelos suportados.

### 3. O que fica provado por teste
O defeito desta spec é silencioso por natureza — URL errada, suíte verde —, então o teste é a entrega e vem antes (`clauderc`, TDD nos services). Em cada um dos dois `gemini.service.spec.ts`:
- sem `GEMINI_MODEL`, a URL contém `models/gemini-2.0-flash:generateContent`;
- com `GEMINI_MODEL` no dublê, a URL contém o modelo configurado;
- **em nenhum dos dois casos a URL contém `undefined`** — é o teste-trava contra a forma de dois parâmetros voltar.

### 4. Documentação
A tabela de variáveis de ambiente do `README.md` ganha a linha da `GEMINI_MODEL` dizendo o que acontece sem ela ("usa `gemini-2.0-flash`; nada quebra"), ao lado da linha da `GEMINI_API_KEY`, que descreve o `503`. É a regra do `clauderc` de documentar no README o que a API consome.

---

## Endpoints Modificados e Novos

- **Nenhum**. As rotas existentes (`/admin/badges/:badgeId/trainings/generate` e similares) mantêm os mesmos contratos.
