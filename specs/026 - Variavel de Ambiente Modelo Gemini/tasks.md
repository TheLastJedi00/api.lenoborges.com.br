# Spec 026 (back): Variável de Ambiente para Modelo Gemini — Tasks

> Regras do repositório que valem em toda task: MVC simples, **TDD nos services** (teste antes da
> lógica), Prettier com aspas simples rodando como regra do ESLint, imports relativos, e o
> `README.md` documentando o que a API consome.
> Uma branch `feat/` por fase, um commit por task, um push por fase. Ao fim, `release/` unindo as
> fases, merge em `dev` e PR contra a `main`.
> O par no front é a spec 026 de lá, **e ela é vazia**: nenhuma tela muda, nenhum contrato muda.

---

# Fase 01: A variável [x]

Ao fim desta fase a variável existe, é validada no boot e está documentada. Nenhum serviço a lê
ainda.

- [x] Task 01: `src/config/env.validation.ts` — `GEMINI_MODEL?: string` com `@IsString()` e
  `@IsOptional()`, logo abaixo da `GEMINI_API_KEY`, com o comentário dizendo por que ela **não** entra
  na exigência de produção: sem a chave a geração responde `503` e o admin só descobre depois de
  escrever o prompt; sem o modelo há um padrão embutido que funciona, e derrubar o boot por uma
  variável com default cria um problema onde não havia.
- [x] Task 02: `.env.example` — a linha comentada `# GEMINI_MODEL="gemini-2.0-flash"` ao lado da
  `GEMINI_API_KEY`, dizendo que ausente significa o padrão do código.
- [x] Task 03: `README.md` — nova linha na tabela de variáveis de ambiente: `GEMINI_MODEL`, nunca
  obrigatória, "sem ela a geração usa `gemini-2.0-flash`; nada quebra". Fica ao lado da linha da
  `GEMINI_API_KEY`, que descreve o `503`.

---

# Fase 02: Os dois serviços do Gemini [ ]

Ao fim desta fase o modelo sai da constante e vem da configuração, nos dois serviços, sem que
nenhuma rota mude de contrato.

- [ ] Task 01: `src/games/gemini.service.spec.ts` — **teste antes**. O dublê do `ConfigService` passa a
  responder também `GEMINI_MODEL`. Três casos: sem a variável a URL do `fetch` contém
  `models/gemini-2.0-flash:generateContent`; com a variável, contém o modelo configurado; e em
  nenhum dos dois a URL contém `undefined`. **O terceiro é o teste-trava desta spec**: o dublê ignora
  o segundo argumento de `config.get`, então a forma `get(chave, padrão)` produziria
  `models/undefined:generateContent` com a suíte verde, porque nada hoje afirma o modelo na URL.
- [ ] Task 02: `src/games/gemini.service.ts` — a constante de módulo `GEMINI_ENDPOINT` dá lugar a
  `DEFAULT_GEMINI_MODEL` mais `endpointFor(model)`. O `generate` lê
  `this.config.get<string>('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL` junto da chave e **passa o modelo
  ao `ask`**, como já faz com a chave — uma leitura só por chamada.
- [ ] Task 03: `src/training/gemini.service.spec.ts` — os mesmos três casos. **O teste é repetido e não
  extraído**: são dois serviços de módulos diferentes, e um helper compartilhado de teste acoplaria
  as duas suítes pela parte que menos muda.
- [ ] Task 04: `src/training/gemini.service.ts` — a mesma troca da task 02. As três linhas são
  **duplicadas de propósito** nos dois serviços, como o `DIFFICULTY_LABEL` e o `MAX_HINTS` já são.

---

# Fase 03: Fechamento [ ]

- [ ] Task 01: `npm test` limpo e `npm run lint` sem erro (o Prettier roda como regra do ESLint e
  reprova formatação).
- [ ] Task 02: `npm run test:e2e` — o contrato das duas rotas de geração não muda, inclusive o `503`
  sem `GEMINI_API_KEY`, que é o que o e2e trava.
- [ ] Task 03: Conferir a variável nos **dois ambientes da Vercel** (Preview e Production) — nos dois
  ou em nenhum. A ausência é o padrão e é segura; o que engana é configurar só um, porque aí o
  preview responde com um modelo e a produção com outro, sem nada na tela dizendo isso, e o teste
  feito em preview não vale para produção. É a mesma classe de defeito dos índices compostos e da
  action URL.
