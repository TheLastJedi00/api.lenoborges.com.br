# Fix 016: o Mural que abria em branco no celular

**Data:** 27/08/2026
**Rotas:** `GET /mural`, `GET /mural/perguntas`, `GET /mural/vencedoras`

---

## O sintoma

O Mural abria em branco num celular. No PC, o mesmo usuário, o mesmo endpoint, no mesmo minuto:
funcionava. Limpar o cache do browser no celular resolveu na hora — e é esse detalhe, mais do que
qualquer outro, que aponta para a causa.

## O que o log da Vercel dizia, e o que ele não dizia

O evento das 10:45:55 (13:45:55 UTC) aparecia marcado como erro:

```
### 13:45:55 GET /mural/perguntas 304 [error/serverless]
    (node:4) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized...
```

**Esse "erro" é ruído e não tem relação com o bug.** A Vercel promove qualquer escrita em stderr para
`level: error`, e o Node emite esse `DEP0169` uma vez por instância nova — ele carimba o primeiro
request de cada cold start. O warning vem de dentro de uma dependência; `url.parse()` não aparece em
`src/`. Os outros três eventos marcados como erro naquela janela eram byte a byte o mesmo warning.

O que o log realmente disse, agregando 24h por status code, foi mais útil:

| statusCode | count |
|---|---|
| 204 | 26 |
| 304 | 24 |
| 200 | 8 |
| 401 | 3 |

**Nenhum 5xx em 24 horas.** O servidor não falhou; a requisição do celular chegou e foi respondida
normalmente, com 304. E 304 sendo o modo dominante da API — 24 contra 8 respostas com corpo — é o
segundo indício.

A lição para a próxima investigação: um evento `level: error` na Vercel não é um erro da aplicação, e
um bug que não deixa 5xx no log não é um bug do backend olhado por esse ângulo.

## A causa

Nenhum dos dois lados pedia cache, e mesmo assim havia cache. Conferido no ar:

```
$ curl -D - https://api.lenoborges.com.br/billing/tiers
Cache-Control: public, max-age=0, must-revalidate   <- default da Vercel
Etag: W/"63-tK/erk7dcTO0eZqAy0eJChakM2g"            <- default do Express
Vary: Origin
```

O `main.ts` nunca desligou o ETag do Express, e a Vercel preenche o `Cache-Control` quando a função
não manda um. Juntos, os dois ensinam o browser a guardar o par (validador, corpo) e a revalidar com
`If-None-Match`. A API então responde **304 sem corpo**.

Quase sempre isso é transparente: o browser recebe o 304 e serve o corpo do próprio cache, e a
aplicação enxerga um 200 com dados. O caso que quebra é o desencontro — **o corpo é despejado do cache
e o validador sobrevive**. Aí o 304 vazio chega na aplicação e a tela não tem o que renderizar. É um
cenário conhecido no Safari iOS sob pressão de memória, o que explica por que só no celular. E explica
por que limpar o cache resolveu: apagou o validador órfão.

Havia um segundo defeito no mesmo header, independente do primeiro: **`public` numa rota atrás do
`FirebaseAuthGuard`**. Isso autoriza cache compartilhado a guardar o mural de um membro específico. O
`max-age=0, must-revalidate` mitiga na prática, e o `Vary` não inclui `Authorization`, o que piora.
Não causou incidente, mas a semântica estava errada.

## A correção

`@Header('Cache-Control', 'no-store')` nos três GET do `MuralController`. O browser não guarda a
resposta, então nunca manda `If-None-Match`, então nunca recebe 304 — e o `no-store` também derruba o
`public`, fechando o segundo defeito de quebra.

### O que esta correção não faz

**`no-store` não desliga o ETag.** Conferido no Express 5.2.1 com cliente HTTP cru: a resposta continua
trazendo `Etag`, e um cliente que mande `If-None-Match` na mão continua recebendo 304. A defesa aqui é
o browser nunca guardar o validador — não o servidor recusar a revalidação.

(Cuidado ao verificar isso: o `fetch` do Node mascara o comportamento e devolve 200 nos dois casos. É
preciso `node:http` cru, ou supertest, para ver o 304.)

Na prática basta, porque nenhum cliente nosso fabrica `If-None-Match` sozinho. Se o sintoma voltar, o
próximo passo é `app.set('etag', false)` no `main.ts` — aí o 304 deixa de ser alcançável por qualquer
caminho. O custo é perder economia de banda em toda GET, o que é irrelevante no volume atual.

### Escopo

Deliberadamente só o Mural, por ora. As outras rotas autenticadas — `/me`, `/notificacoes`,
`/billing/tiers` — têm exatamente o mesmo `public` + ETag e o mesmo risco latente, e nenhuma foi
tocada. A generalização natural é um middleware aplicando `no-store` a tudo que passa pelo
`FirebaseAuthGuard`, deixando de fora as rotas públicas de fato (`/waitlist`, `/track`), que são as que
ganham algo em ser cacheáveis na CDN.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `src/mural/mural.controller.ts` | `@Header('Cache-Control', 'no-store')` nos três GET, com o porquê no lugar |
| `test/mural.e2e-spec.ts` | Teste tabelado sobre as três rotas travando o header |

## Estado da verificação

- **Passou:** `tsc --noEmit`, `nest build`.
- **Passou:** o mecanismo do `@Header` num app Nest mínimo — sai `cache-control: no-store`, e o `etag`
  continua presente, que é o que a ressalva acima descreve.
- **Não rodou:** o e2e do Mural. `npm run test:e2e` precisa do emulador do Firestore, que precisa de
  Java, que não está instalado nesta máquina. **O teste novo foi escrito mas nunca executou** — rodar
  numa máquina com Java é o passo que falta.
- **Não verificado em produção:** o header depois do deploy. Confirmar com
  `curl -D - https://api.lenoborges.com.br/mural -H "Authorization: Bearer <token>"`.
